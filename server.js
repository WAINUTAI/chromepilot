/**
 * server.js — Persistent HTTP server for browser-js
 *
 * Exposes browser control over HTTP on 127.0.0.1:9223 (default).
 * Chrome must be reachable on 127.0.0.1:9222 (CDP debug endpoint).
 * One fresh CDP connection per request; the HTTP server itself is long-lived.
 *
 * Portions of this file (the /recon, /dismiss, /captcha page-injection
 * scripts, the /fill date-input + key-by-key typing strategy, the /read
 * structured-sections extractor, and the /dispatch React-handler inspector)
 * are adapted from MIT-licensed work by AllAboutAI-YT. See NOTICE for the
 * copyright notice and full MIT license text.
 */

const http = require("http");
const CDP = require("chrome-remote-interface");

// ─── Tiny HTTP helpers ──────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ─── CDP helpers ────────────────────────────────────────────────────────────

async function listPageTargets(cdpHost, cdpPort) {
  const all = await CDP.List({ host: cdpHost, port: cdpPort });
  return all.filter((t) => t.type === "page");
}

// Accepts a numeric index ("0", 0), a URL/title substring, or undefined (→ tab 0).
async function resolveTarget(tabSpec, cdpHost, cdpPort) {
  const tabs = await listPageTargets(cdpHost, cdpPort);
  if (tabs.length === 0) throw new Error("No browser tabs found. Is Chrome open?");

  if (tabSpec === undefined || tabSpec === null || tabSpec === "") {
    return { target: tabs[0], index: 0 };
  }
  const asNum = typeof tabSpec === "number" ? tabSpec : parseInt(tabSpec, 10);
  if (!isNaN(asNum) && String(asNum) === String(tabSpec).trim()) {
    if (!tabs[asNum]) throw new Error(`Tab [${asNum}] not found. ${tabs.length} tab(s) open.`);
    return { target: tabs[asNum], index: asNum };
  }
  const needle = String(tabSpec).toLowerCase();
  const hitIdx = tabs.findIndex(
    (t) => (t.url || "").toLowerCase().includes(needle) || (t.title || "").toLowerCase().includes(needle)
  );
  if (hitIdx === -1) throw new Error(`No tab matches "${tabSpec}"`);
  return { target: tabs[hitIdx], index: hitIdx };
}

async function withClient(tabSpec, cdpHost, cdpPort, fn) {
  const { target, index } = await resolveTarget(tabSpec, cdpHost, cdpPort);
  const client = await CDP({ host: cdpHost, port: cdpPort, target });
  try {
    await client.Page.enable();
    await client.Runtime.enable();
    await applyNotificationBlocker(client);
    return await fn(client, target, index);
  } finally {
    try { await client.close(); } catch (_) {}
  }
}

// Blocks desktop-notification and push-subscription prompts. Runs before any
// page script on new documents (via Page.addScriptToEvaluateOnNewDocument) and
// also re-applied against the current document. Idempotent — re-defining a
// non-configurable property throws silently and is caught.
const NOTIFICATION_BLOCKER_JS = `
(() => {
  try {
    if (window.Notification) {
      try {
        Object.defineProperty(Notification, 'requestPermission', {
          value: function() { return Promise.resolve('denied'); },
          writable: false, configurable: false,
        });
      } catch(_) {}
      try {
        Object.defineProperty(Notification, 'permission', {
          get: function() { return 'denied'; },
          configurable: false,
        });
      } catch(_) {}
    }
    if (window.PushManager && PushManager.prototype) {
      try {
        PushManager.prototype.subscribe = function() {
          return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        };
      } catch(_) {}
    }
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const orig = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = function(desc) {
          if (desc && (desc.name === 'notifications' || desc.name === 'push')) {
            return Promise.resolve({ state: 'denied', onchange: null });
          }
          return orig(desc);
        };
      } catch(_) {}
    }
  } catch(_) {}
})();
`;

async function applyNotificationBlocker(client) {
  try {
    await client.Page.addScriptToEvaluateOnNewDocument({ source: NOTIFICATION_BLOCKER_JS });
  } catch (_) {}
  try {
    await client.Runtime.evaluate({ expression: NOTIFICATION_BLOCKER_JS, returnByValue: true });
  } catch (_) {}
}

async function evalJS(client, expression) {
  const { result, exceptionDetails } = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    let msg =
      exceptionDetails.exception?.description ||
      exceptionDetails.exception?.value ||
      exceptionDetails.text ||
      "JS evaluation error";
    msg = msg.split("\n")[0].replace(/^Error:\s*/, "");
    throw new Error(msg);
  }
  return result.value;
}

// ─── Shared page-injected JS ────────────────────────────────────────────────
// These strings are concatenated into a single IIFE before being passed to
// Runtime.evaluate. Helper functions are shared across recon/click/dismiss.

const HELPERS_JS = `
function cssAttr(v) {
  return '"' + String(v).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"';
}
function buildSelector(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) { try { return '#' + CSS.escape(el.id); } catch(_) { return '#' + el.id; } }
  const tag = el.tagName.toLowerCase();
  const aria = el.getAttribute('aria-label');
  if (aria) return tag + '[aria-label=' + cssAttr(aria) + ']';
  const testid = el.getAttribute('data-testid');
  if (testid) return '[data-testid=' + cssAttr(testid) + ']';
  const name = el.getAttribute('name');
  if (name) {
    const base = tag + '[name=' + cssAttr(name) + ']';
    if ((el.type === 'radio' || el.type === 'checkbox') && el.value) return base + '[value=' + cssAttr(el.value) + ']';
    return base;
  }
  const parent = el.parentElement;
  if (!parent || parent === document.documentElement) return tag;
  const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
  if (siblings.length === 1) return buildSelector(parent) + ' > ' + tag;
  const idx = siblings.indexOf(el) + 1;
  return buildSelector(parent) + ' > ' + tag + ':nth-of-type(' + idx + ')';
}
function isVisible(el) {
  if (!el || el.nodeType !== 1) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function getElText(el) {
  return (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().substring(0, 200);
}
function isClickable(el) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (['button','a','input','textarea','select'].includes(tag)) return true;
  if (['button','link','tab','menuitem','option','listitem','treeitem','checkbox','radio','switch'].includes(role)) return true;
  if (el.onclick !== null || el.getAttribute('onclick')) return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== '-1') return true;
  if (window.getComputedStyle(el).cursor === 'pointer') return true;
  return false;
}
function deepAll(selector, root) {
  root = root || document;
  const results = [];
  results.push(...root.querySelectorAll(selector));
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) results.push(...deepAll(selector, el.shadowRoot));
  });
  return results;
}
`;

// Recon: returns the full page snapshot.
// Adapted from MIT-licensed work by AllAboutAI-YT — see NOTICE.
const RECON_JS = `
(() => {
  ${HELPERS_JS}
  const t0 = performance.now();

  // Meta
  const metaGet = (name) => {
    const m = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
    return m ? m.getAttribute('content') : null;
  };
  const jsonLd = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try { jsonLd.push(JSON.parse(s.textContent)); } catch(_) {}
  });
  const meta = {
    description: metaGet('description'),
    ogTitle: metaGet('og:title'),
    ogDescription: metaGet('og:description'),
    jsonLd,
  };

  // Headings
  const headings = [];
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
    if (!isVisible(h)) return;
    const text = (h.innerText || '').trim();
    if (text) headings.push({ level: parseInt(h.tagName.substring(1), 10), text: text.substring(0, 200) });
  });

  // Navigation links (inside <nav>, header, or role=navigation)
  const navigation = [];
  document.querySelectorAll('nav a, header a, [role="navigation"] a').forEach(a => {
    if (!isVisible(a)) return;
    const text = (a.innerText || a.textContent || '').trim();
    if (!text || !a.href) return;
    navigation.push({ text: text.substring(0, 100), href: a.href, section: a.closest('nav,header,[role="navigation"]')?.tagName?.toLowerCase() || null });
  });

  // Landmarks
  const landmarks = [];
  document.querySelectorAll('header, nav, main, footer, aside, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"]').forEach(el => {
    if (!isVisible(el)) return;
    landmarks.push({
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      label: el.getAttribute('aria-label') || null,
      tag: el.tagName.toLowerCase(),
    });
  });

  // Interactive elements
  const elements = [];
  const seen = new Set();
  function collect(root, depth) {
    if (depth > 8 || elements.length >= 200) return;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) collect(el.shadowRoot, depth + 1);
      if (!isVisible(el) || !isClickable(el)) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      const sel = buildSelector(el);
      elements.push({
        tag: el.tagName,
        text: getElText(el),
        type: el.type || null,
        href: el.href || null,
        id: el.id || null,
        selector: sel,
        role: el.getAttribute('role') || null,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        data: {
          testid: el.getAttribute('data-testid') || null,
        },
      });
      if (elements.length >= 200) break;
    }
  }
  collect(document, 0);
  try {
    for (const iframe of document.querySelectorAll('iframe')) {
      if (iframe.contentDocument) collect(iframe.contentDocument, 0);
    }
  } catch(_) {}

  // Forms
  const forms = [];
  document.querySelectorAll('form').forEach(f => {
    if (!isVisible(f)) return;
    const fields = [];
    f.querySelectorAll('input, select, textarea').forEach(field => {
      const id = field.id || '';
      let label = null;
      if (id) {
        const lab = document.querySelector('label[for=' + cssAttr(id) + ']');
        if (lab) label = (lab.innerText || lab.textContent || '').trim();
      }
      if (!label) {
        const parentLabel = field.closest('label');
        if (parentLabel) label = (parentLabel.innerText || parentLabel.textContent || '').trim();
      }
      if (!label) label = field.getAttribute('aria-label') || null;
      let options = null;
      if (field.tagName.toLowerCase() === 'select') {
        options = Array.from(field.options).map(o => ({ value: o.value, text: (o.text || '').trim() }));
      }
      fields.push({
        tag: field.tagName.toLowerCase(),
        type: field.type || null,
        name: field.name || null,
        id: field.id || null,
        label: label ? label.substring(0, 120) : null,
        placeholder: field.placeholder || null,
        required: !!field.required,
        options,
        selector: buildSelector(field),
      });
    });
    forms.push({
      action: f.getAttribute('action') || null,
      method: (f.getAttribute('method') || 'get').toLowerCase(),
      id: f.id || null,
      fields,
    });
  });

  // Overlays — three-tier detection
  const overlays = [];
  const overlayEls = new Set();
  const pushOverlay = (el, type) => {
    if (!el || overlayEls.has(el)) return;
    overlayEls.add(el);
    overlays.push({
      type,
      text: (el.innerText || '').trim().substring(0, 200),
      selector: buildSelector(el),
    });
  };
  // Tier 1: semantic dialogs
  document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], .modal, [data-overlay], [aria-modal="true"]').forEach(el => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width > 100 && r.height > 50) pushOverlay(el, 'dialog');
  });
  // Tier 2: cookie / consent patterns
  document.querySelectorAll('[class*="cookie" i], [class*="consent" i], [class*="banner" i], [id*="cookie" i], [id*="consent" i]').forEach(el => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width > 200) pushOverlay(el, 'cookie/consent');
  });
  // Tier 3: fixed/absolute high-z-index full-screen blankets
  document.querySelectorAll('body > div, body > aside, body > section').forEach(el => {
    if (!isVisible(el)) return;
    const s = window.getComputedStyle(el);
    if ((s.position === 'fixed' || s.position === 'absolute') && parseFloat(s.zIndex) > 999) {
      const r = el.getBoundingClientRect();
      if (r.width > window.innerWidth * 0.5 && r.height > window.innerHeight * 0.3) pushOverlay(el, 'overlay');
    }
  });
  // Dedup: drop nested overlays (keep outermost)
  const overlayElArr = Array.from(overlayEls);
  const dedupOverlays = overlays.filter((_, i) => {
    const el = overlayElArr[i];
    return !overlayElArr.some((other, j) => i !== j && other !== el && other.contains(el));
  });

  // Captchas
  const captchas = [];
  for (const iframe of document.querySelectorAll('iframe')) {
    const src = iframe.src || '';
    let type = null;
    if (src.includes('arkoselabs') || src.includes('funcaptcha')) type = 'arkose';
    else if (src.includes('recaptcha') || src.includes('google.com/recaptcha')) type = 'recaptcha';
    else if (src.includes('hcaptcha')) type = 'hcaptcha';
    else if (src.includes('octocaptcha')) type = 'octocaptcha';
    else if (src.includes('captcha')) type = 'unknown-captcha';
    if (type) {
      const rect = iframe.getBoundingClientRect();
      captchas.push({
        type,
        src: src.substring(0, 200),
        id: iframe.id || null,
        visible: rect.width > 0 && rect.height > 0,
      });
    }
  }

  // Content summary
  const body = document.body;
  const contentSummary = body ? (body.innerText || '').replace(/\\s+/g, ' ').trim().substring(0, 500) : '';

  return {
    url: location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    meta,
    headings,
    navigation,
    landmarks,
    elements,
    totalElements: elements.length,
    forms,
    overlays: dedupOverlays,
    captchas,
    contentSummary,
    _reconMs: Math.round(performance.now() - t0),
  };
})()
`;

// Dismiss: click cookie/consent/modal close buttons.
// Adapted from MIT-licensed work by AllAboutAI-YT — see NOTICE.
const DISMISS_JS = `
(() => {
  ${HELPERS_JS}
  const dismissed = [];
  const consentPatterns = [
    'reject all', 'reject', 'decline', 'deny',
    'accept all', 'accept', 'agree', 'got it',
    'godta alle', 'godta', 'alle ablehnen', 'ablehnen',
    'tout refuser', 'refuser', 'tout accepter', 'accepter',
    'rechazar todo', 'rechazar', 'aceptar todo', 'aceptar',
    'rifiuta tutto', 'rifiuta', 'accetta tutto', 'accetta',
    'bare nødvendige', 'only necessary', 'nur notwendige',
    'manage preferences', 'cookie settings',
    'alles akzeptieren', 'alles erlauben',
    'alles weigeren', 'alles accepteren', 'akkoord',
  ];
  const matchesPattern = (text, pattern) => {
    if (text === pattern) return true;
    const re = new RegExp('\\\\b' + pattern.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\b', 'i');
    return re.test(text);
  };
  for (const btn of deepAll('button, a[role="button"], [role="button"], a[href="#"]')) {
    if (!isVisible(btn)) continue;
    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    if (text.length > 60 || text.length < 2) continue;
    for (const pattern of consentPatterns) {
      if (matchesPattern(text, pattern)) {
        btn.click();
        dismissed.push({ type: 'cookie', text: text.substring(0, 40), pattern });
        break;
      }
    }
    if (dismissed.length) break;
  }
  if (!dismissed.length) {
    const closeBtns = deepAll(
      '[aria-label*="Close" i], [aria-label*="Dismiss" i], [aria-label*="Lukk" i], ' +
      '[aria-label*="Schließen" i], [aria-label*="Fermer" i], [aria-label*="Sluit" i], ' +
      '[aria-label*="Cerrar" i], [aria-label*="Chiudi" i]'
    );
    for (const btn of closeBtns) {
      if (!isVisible(btn)) continue;
      const dialog = btn.closest('[role="dialog"], [role="alertdialog"], .modal, [data-overlay], [aria-modal="true"]');
      if (dialog) {
        btn.click();
        dismissed.push({ type: 'dialog', text: btn.getAttribute('aria-label') || 'close' });
        break;
      }
    }
  }
  return { dismissed, count: dismissed.length };
})()
`;

// Structured /read — sections + notifications + plain text fallback.
// Adapted from MIT-licensed work by AllAboutAI-YT — see NOTICE.
const READ_JS = `
(() => {
  ${HELPERS_JS}
  const root = document.querySelector('main, article, [role="main"]') || document.body;
  const sections = [];
  const seen = new Set();
  function walk(el) {
    if (!el || seen.has(el) || !isVisible(el)) return;
    seen.add(el);
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (['script','style','noscript','svg','nav','header','footer'].includes(tag)) return;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return;
    if (/^h[1-6]$/.test(tag)) {
      const text = (el.innerText || '').trim();
      if (text) sections.push({ type: 'heading', level: parseInt(tag.substring(1), 10), text: text.substring(0, 300) });
      return;
    }
    if (tag === 'table') {
      const rows = Array.from(el.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('th,td')).map(c => (c.innerText || '').trim().substring(0, 200))
      ).filter(r => r.length);
      if (rows.length) sections.push({ type: 'table', rows });
      return;
    }
    if (tag === 'pre' || tag === 'code') {
      const text = (el.innerText || '').trim();
      if (text) sections.push({ type: 'code', text: text.substring(0, 5000) });
      return;
    }
    if (tag === 'p' || tag === 'blockquote') {
      const text = (el.innerText || '').trim();
      if (text) sections.push({ type: tag, text: text.substring(0, 1000) });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.querySelectorAll(':scope > li')).map(li => (li.innerText || '').trim().substring(0, 500)).filter(Boolean);
      if (items.length) sections.push({ type: 'list', ordered: tag === 'ol', items });
      return;
    }
    for (const child of el.children) walk(child);
  }
  walk(root);

  // Notifications
  const notifications = [];
  document.querySelectorAll('[role="alert"], [role="status"], .toast, .notification').forEach(el => {
    if (!isVisible(el)) return;
    const text = (el.innerText || '').trim();
    if (text) notifications.push(text.substring(0, 300));
  });

  // Special result zones
  let resultText = null;
  const resultEl = document.querySelector('[class*="result" i], [class*="output" i], [data-testid*="result" i], .cm-content');
  if (resultEl && isVisible(resultEl)) {
    resultText = (resultEl.innerText || '').trim().substring(0, 5000);
  }

  // Plain text fallback via shadow-DOM-aware walker (reused from browser.js content)
  function getTextDeep(r) {
    let text = '';
    if (r.cloneNode && !(r instanceof ShadowRoot)) {
      const clone = r.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, svg, iframe').forEach(e => e.remove());
      text += (clone.innerText || '');
    } else {
      r.querySelectorAll('*').forEach(e => {
        if (e.children.length === 0 && !['SCRIPT','STYLE','SVG','NOSCRIPT'].includes(e.tagName)) {
          const t = (e.innerText || e.textContent || '').trim();
          if (t) text += t + '\\n';
        }
      });
    }
    r.querySelectorAll('*').forEach(e => { if (e.shadowRoot) text += '\\n' + getTextDeep(e.shadowRoot); });
    return text;
  }
  const plainText = getTextDeep(document.body).replace(/\\n{3,}/g, '\\n\\n').trim().substring(0, 15000);

  return {
    title: document.title,
    url: location.href,
    sections,
    notifications,
    resultText,
    plainText,
  };
})()
`;

// ─── /fill helper (mix of JS-side + CDP-side actions) ───────────────────────

async function fillOneField(client, selector, value) {
  const info = await evalJS(client, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: 'Element not found: ${selector.replace(/'/g, "\\'")}' };
      const t = (el.type || '').toLowerCase();
      const tag = el.tagName.toLowerCase();
      return {
        tag,
        type: t,
        isContentEditable: !!el.isContentEditable,
        isDateLike: ['date','time','datetime-local','month','week','color','range'].includes(t),
        isCheckable: t === 'checkbox' || t === 'radio',
        isSelect: tag === 'select',
      };
    })()
  `);
  if (info.error) throw new Error(info.error);

  // Checkboxes / radios: just set checked + dispatch change.
  if (info.isCheckable) {
    await evalJS(client, `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const want = ${JSON.stringify(value)} === true || ${JSON.stringify(value)} === 'true' || ${JSON.stringify(value)} === 'on' || ${JSON.stringify(value)} === '1';
        el.checked = want;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    return;
  }

  // <select>: set value + change.
  if (info.isSelect) {
    await evalJS(client, `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    return;
  }

  // Date / time / color / range: native setter.
  if (info.isDateLike) {
    await evalJS(client, `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, ${JSON.stringify(String(value))});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    return;
  }

  // Text-like: focus + clear via native value setter, then type characters
  // via CDP. Clearing in JS (rather than Ctrl+A/Backspace keystrokes) keeps
  // /fill platform-agnostic — Ctrl+A selects-all on Windows/Linux but moves
  // the caret to line-start on macOS. Native setter also works for React-
  // controlled inputs that would otherwise ignore a plain `el.value = ''`.
  await evalJS(client, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (typeof el.click === 'function') el.click();
      if (el.isContentEditable) {
        el.innerHTML = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if ('value' in el) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (setter) setter.call(el, ''); else el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (typeof el.select === 'function') { try { el.select(); } catch(_) {} }
    })()
  `);

  const str = String(value);
  for (const char of str) {
    if (char === "\n") {
      await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter" });
      await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter" });
    } else if (char === "\t") {
      await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Tab", code: "Tab" });
      await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Tab", code: "Tab" });
    } else if (char.charCodeAt(0) < 128) {
      // ASCII — use keyboard events so site listeners (autocomplete, live validation) fire
      await client.Input.dispatchKeyEvent({ type: "keyDown", text: char });
      await client.Input.dispatchKeyEvent({ type: "keyUp", text: char });
    } else {
      // Non-ASCII (smart quotes, em-dash, accented chars, emoji, CJK) — dispatchKeyEvent
      // mangles these; insertText puts them in the focused element intact
      await client.Input.insertText({ text: char });
    }
  }
}

async function runSubmit(client, submitSpec, firstSelector) {
  if (!submitSpec) return false;
  if (submitSpec === "enter") {
    await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter" });
    await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter" });
    return true;
  }
  if (submitSpec === "form") {
    const ok = await evalJS(client, `
      (() => {
        const el = document.querySelector(${JSON.stringify(firstSelector || "form")});
        if (!el) return false;
        const form = el.tagName.toLowerCase() === 'form' ? el : el.closest('form');
        if (!form) return false;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        if (typeof form.requestSubmit === 'function') { try { form.requestSubmit(); } catch(_) {} }
        else { try { form.submit(); } catch(_) {} }
        return true;
      })()
    `);
    return !!ok;
  }
  if (submitSpec === "auto") {
    const ok = await evalJS(client, `
      (() => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="image"]'))
          .find(b => b.type === 'submit' || b.type === 'image');
        if (!btn) return false;
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return true;
      })()
    `);
    return !!ok;
  }
  // Treat as CSS selector
  const ok = await evalJS(client, `
    (() => {
      const btn = document.querySelector(${JSON.stringify(submitSpec)});
      if (!btn) return false;
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return true;
    })()
  `);
  return !!ok;
}

// ─── Endpoint handlers ──────────────────────────────────────────────────────

function makeHandlers(opts) {
  const { cdpHost, cdpPort } = opts;

  return {
    "GET /health": async () => {
      try {
        const tabs = await listPageTargets(cdpHost, cdpPort);
        return { status: "ok", cdpConnected: true, tabCount: tabs.length };
      } catch (err) {
        return { status: "error", cdpConnected: false, error: err.message };
      }
    },

    "GET /tabs": async () => {
      const tabs = await listPageTargets(cdpHost, cdpPort);
      return {
        tabs: tabs.map((t, i) => ({ index: i, id: t.id, title: t.title, url: t.url })),
      };
    },

    "POST /focus": async (body) => {
      return withClient(body.tab, cdpHost, cdpPort, async (client, target) => {
        try { await client.Page.bringToFront(); } catch (_) {}
        return { id: target.id, title: target.title, url: target.url };
      });
    },

    "POST /navigate": async (body) => {
      const { tab, url, back, forward, waitMs = 2000 } = body;
      if (url) {
        if (/^(javascript|vbscript|data):/i.test(url)) throw new Error("Scheme not allowed");
      }
      const finalUrl = url && !/^https?:\/\//i.test(url) ? "https://" + url : url;
      return withClient(tab, cdpHost, cdpPort, async (client) => {
        try { await client.Page.bringToFront(); } catch (_) {}
        if (back) {
          await evalJS(client, "window.history.back()");
        } else if (forward) {
          await evalJS(client, "window.history.forward()");
        } else if (finalUrl) {
          await client.Page.navigate({ url: finalUrl });
          await Promise.race([
            client.Page.loadEventFired(),
            new Promise((r) => setTimeout(r, 30000)),
          ]);
        } else {
          throw new Error("Provide url, back, or forward");
        }
        await evalJS(client, `new Promise(r => setTimeout(r, ${Math.max(0, parseInt(waitMs, 10) || 0)}))`);
        const pageUrl = await evalJS(client, "location.href");
        const pageTitle = await evalJS(client, "document.title");
        return { url: pageUrl, title: pageTitle };
      });
    },

    "POST /eval": async (body) => {
      const { tab, expression } = body;
      if (!expression) throw new Error("Missing 'expression'");
      return withClient(tab, cdpHost, cdpPort, async (client) => {
        try {
          const result = await evalJS(client, expression);
          return { result };
        } catch (err) {
          return { result: null, error: err.message };
        }
      });
    },

    "POST /recon": async (body) => {
      const { url, tab, waitMs = 2000, keepTab = false } = body;
      if (url && tab !== undefined) throw new Error("Pass either 'url' or 'tab', not both");

      // If url → open new tab, analyze, optionally close.
      if (url) {
        const finalUrl = /^https?:\/\//i.test(url) ? url : "https://" + url;
        const target = await CDP.New({ host: cdpHost, port: cdpPort, url: finalUrl });
        const client = await CDP({ host: cdpHost, port: cdpPort, target });
        try {
          await client.Page.enable();
          await client.Runtime.enable();
          await applyNotificationBlocker(client);
          await Promise.race([
            client.Page.loadEventFired(),
            new Promise((r) => setTimeout(r, 30000)),
          ]);
          await evalJS(client, `new Promise(r => setTimeout(r, ${Math.max(0, parseInt(waitMs, 10) || 0)}))`);
          const result = await evalJS(client, RECON_JS);
          result.tabId = target.id;
          return result;
        } finally {
          try { await client.close(); } catch (_) {}
          if (!keepTab) {
            try { await CDP.Close({ host: cdpHost, port: cdpPort, id: target.id }); } catch (_) {}
          }
        }
      }

      return withClient(tab, cdpHost, cdpPort, async (client, target) => {
        const result = await evalJS(client, RECON_JS);
        result.tabId = target.id;
        return result;
      });
    },

    "POST /click": async (body) => {
      const { tab, selector, text, index, waitAfter = 800 } = body;
      if (selector === undefined && text === undefined && index === undefined)
        throw new Error("Provide 'selector', 'text', or 'index'");

      return withClient(tab, cdpHost, cdpPort, async (client) => {
        let expr;
        if (selector !== undefined) {
          expr = `
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return { error: 'No element matches selector: ${String(selector).replace(/'/g, "\\'")}' };
              if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { error: 'Element is disabled' };
              if (el.getAttribute('target') === '_blank') el.removeAttribute('target');
              el.scrollIntoView({ block: 'center' });
              el.click();
              return { clicked: ((el.innerText || el.value || '').trim().substring(0, 100)), tag: el.tagName, mode: 'selector' };
            })()
          `;
        } else if (text !== undefined) {
          expr = `
            (() => {
              ${HELPERS_JS}
              const needle = ${JSON.stringify(String(text).toLowerCase())};
              const candidates = deepAll('a, button, input[type="submit"], [role="button"], [role="option"], [role="menuitem"], [role="tab"], [role="link"], li[aria-label], [onclick], label');
              let best = null, bestScore = Infinity;
              for (const el of candidates) {
                if (el.disabled) continue;
                const t = (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
                const tl = t.toLowerCase();
                if (!tl.includes(needle)) continue;
                let score;
                if (tl === needle) score = 0;
                else if (tl.startsWith(needle)) score = 1;
                else score = 2 + t.length;
                if (score < bestScore) { best = el; bestScore = score; }
                if (score === 0) break;
              }
              if (!best) return { error: 'No element matches text: ' + needle };
              if (best.getAttribute('target') === '_blank') best.removeAttribute('target');
              best.scrollIntoView({ block: 'center' });
              best.click();
              return { clicked: ((best.innerText || best.value || '').trim().substring(0, 100)), tag: best.tagName, mode: 'text' };
            })()
          `;
        } else {
          const idx = parseInt(index, 10);
          expr = `
            (() => {
              ${HELPERS_JS}
              const els = deepAll('a, button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]');
              const el = els[${idx}];
              if (!el) return { error: 'No element at index ${idx}' };
              el.scrollIntoView({ block: 'center' });
              el.click();
              return { clicked: ((el.innerText || el.value || '').trim().substring(0, 100)), tag: el.tagName, mode: 'index' };
            })()
          `;
        }
        const res = await evalJS(client, expr);
        if (res.error) return { success: false, error: res.error };
        const w = Math.max(0, parseInt(waitAfter, 10) || 0);
        if (w) await evalJS(client, `new Promise(r => setTimeout(r, ${w}))`);
        return { success: true, clicked: `${res.tag}: ${res.clicked}`, mode: res.mode };
      });
    },

    "POST /fill": async (body) => {
      const { tab, fields, submit } = body;
      if (!Array.isArray(fields) || fields.length === 0) throw new Error("Missing 'fields' array");
      const t0 = Date.now();
      return withClient(tab, cdpHost, cdpPort, async (client) => {
        const filled = [];
        for (const f of fields) {
          try {
            await fillOneField(client, f.selector, f.value);
            filled.push({ selector: f.selector, success: true, error: null });
          } catch (err) {
            filled.push({ selector: f.selector, success: false, error: err.message });
          }
        }
        let submitted = false;
        if (submit) submitted = await runSubmit(client, submit, fields[0]?.selector);
        return { filled, submitted, _fillMs: Date.now() - t0 };
      });
    },

    "POST /read": async (body) => {
      const { tab, selector } = body;
      return withClient(tab, cdpHost, cdpPort, async (client) => {
        if (selector) {
          const res = await evalJS(client, `
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return { error: 'No element matches selector' };
              return {
                tag: el.tagName.toLowerCase(),
                innerText: (el.innerText || '').substring(0, 5000),
                innerHTML: (el.innerHTML || '').substring(0, 10000),
              };
            })()
          `);
          if (res.error) throw new Error(res.error);
          return { title: await evalJS(client, "document.title"), url: await evalJS(client, "location.href"), ...res };
        }
        return await evalJS(client, READ_JS);
      });
    },

    "POST /dismiss": async (body) => {
      // Consent-manager iframe URL patterns worth probing when same-origin dismiss finds nothing.
      const CONSENT_IFRAME_RE = /(privacy-mgmt|cookielaw|consensu|onetrust|didomi|trustarc|iubenda|cookiebot|usercentrics|sourcepoint|quantcast|evidon|cmp\.|\/cmp|consent|cookie)/i;

      return withClient(body.tab, cdpHost, cdpPort, async (client) => {
        const mainResult = await evalJS(client, DISMISS_JS);
        const combined = { dismissed: [...mainResult.dismissed], count: mainResult.count, frames: [] };

        // If the main page dismissed something, we're done — most sites only have one banner.
        if (combined.count > 0) return combined;

        // Walk cross-origin iframe targets that look like consent managers.
        let allTargets;
        try {
          allTargets = await CDP.List({ host: cdpHost, port: cdpPort });
        } catch (_) {
          return combined;
        }
        const frames = allTargets.filter(
          (t) => t.type === "iframe" && CONSENT_IFRAME_RE.test(t.url || "")
        );

        for (const frame of frames) {
          let fc;
          try {
            fc = await CDP({ host: cdpHost, port: cdpPort, target: frame });
            await fc.Runtime.enable();
            const frameResult = await evalJS(fc, DISMISS_JS);
            if (frameResult.count > 0) {
              combined.dismissed.push(...frameResult.dismissed);
              combined.count += frameResult.count;
              combined.frames.push(frame.url.substring(0, 150));
              break; // first success wins
            }
          } catch (_) {
            /* try next frame */
          } finally {
            if (fc) { try { await fc.close(); } catch (_) {} }
          }
        }

        return combined;
      });
    },

    "POST /scroll": async (body) => {
      const { tab, direction = "down", amount = 800 } = body;
      const dy = direction === "up" ? -Math.abs(parseInt(amount, 10) || 0) : Math.abs(parseInt(amount, 10) || 0);
      return withClient(tab, cdpHost, cdpPort, async (client) => {
        return await evalJS(client, `
          (() => {
            window.scrollBy(0, ${dy});
            const sy = window.scrollY;
            const sh = document.documentElement.scrollHeight;
            const vh = window.innerHeight;
            let preview = '';
            const candidates = document.querySelectorAll('main, article, [role="main"], body');
            const base = candidates[0] || document.body;
            preview = (base.innerText || '').substring(0, 500).replace(/\\s+/g, ' ').trim();
            return { scrollY: sy, scrollHeight: sh, viewportHeight: vh, atBottom: sy + vh >= sh - 4, contentPreview: preview };
          })()
        `);
      });
    },

    "POST /type": async (body) => {
      const { tab, keys, submit } = body;
      if (typeof keys !== "string") throw new Error("Missing 'keys' string");
      return withClient(tab, cdpHost, cdpPort, async (client) => {
        for (const char of keys) {
          if (char === "\n") {
            await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter" });
            await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter" });
          } else if (char === "\t") {
            await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Tab", code: "Tab" });
            await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Tab", code: "Tab" });
          } else if (char.charCodeAt(0) < 128) {
            await client.Input.dispatchKeyEvent({ type: "keyDown", text: char });
            await client.Input.dispatchKeyEvent({ type: "keyUp", text: char });
          } else {
            await client.Input.insertText({ text: char });
          }
        }
        let submitted = false;
        if (submit === "enter") {
          await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter" });
          await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter" });
          submitted = true;
        } else if (submit === "tab") {
          await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Tab", code: "Tab" });
          await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Tab", code: "Tab" });
          submitted = true;
        }
        return { typed: keys.length, submitted };
      });
    },

    "POST /dispatch": async (body) => {
      const { tab, selector, event, bubbles = true, cancelable = true, eventInit = {}, reactDebug = false } = body;
      if (!selector || !event) throw new Error("Missing 'selector' or 'event'");
      return withClient(tab, cdpHost, cdpPort, async (client) => {
        const res = await evalJS(client, `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { error: 'No element matches selector' };
            const evName = ${JSON.stringify(event)};
            const init = Object.assign({ bubbles: ${!!bubbles}, cancelable: ${!!cancelable} }, ${JSON.stringify(eventInit)});
            let ev;
            if (['click','mousedown','mouseup','dblclick'].includes(evName)) ev = new MouseEvent(evName, init);
            else if (['keydown','keyup','keypress'].includes(evName)) ev = new KeyboardEvent(evName, init);
            else if (['pointerdown','pointerup','pointermove'].includes(evName)) ev = new PointerEvent(evName, init);
            else if (['input','change','submit','focus','blur'].includes(evName)) ev = new Event(evName, init);
            else ev = new CustomEvent(evName, init);
            el.dispatchEvent(ev);
            let reactHandlers = null;
            if (${reactDebug ? "true" : "false"}) {
              reactHandlers = [];
              let c = el;
              while (c && c !== document.documentElement) {
                const propKey = Object.keys(c).find(k => k.startsWith('__reactProps'));
                if (propKey) {
                  const props = c[propKey] || {};
                  const handlers = Object.keys(props).filter(k => typeof props[k] === 'function' && k.startsWith('on'));
                  if (handlers.length) {
                    reactHandlers.push({
                      tag: c.tagName,
                      role: c.getAttribute('role'),
                      testid: c.getAttribute('data-testid'),
                      className: String(c.className || '').substring(0, 60),
                      handlers,
                    });
                  }
                }
                c = c.parentElement;
              }
            }
            return { dispatched: evName + ' on ' + el.tagName, reactHandlers };
          })()
        `);
        if (res.error) throw new Error(res.error);
        const out = { success: true, dispatched: res.dispatched };
        if (reactDebug) out.reactHandlers = res.reactHandlers;
        return out;
      });
    },

    "POST /captcha": async (body) => {
      const { tab, action = "detect" } = body;

      if (action === "detect") {
        return withClient(tab, cdpHost, cdpPort, async (client) => {
          return await evalJS(client, `
            (() => {
              const captchas = [];
              for (const iframe of document.querySelectorAll('iframe')) {
                const src = iframe.src || '';
                let type = null;
                if (src.includes('arkoselabs') || src.includes('funcaptcha')) type = 'arkose';
                else if (src.includes('recaptcha') || src.includes('google.com/recaptcha')) type = 'recaptcha';
                else if (src.includes('hcaptcha')) type = 'hcaptcha';
                else if (src.includes('octocaptcha')) type = 'octocaptcha';
                else if (src.includes('captcha')) type = 'unknown-captcha';
                if (type) {
                  const r = iframe.getBoundingClientRect();
                  captchas.push({ type, src: src.substring(0, 200), id: iframe.id || null, visible: r.width > 0 && r.height > 0 });
                }
              }
              return { captchas };
            })()
          `);
        });
      }

      // Interaction — iterate captcha iframe targets in priority order and
      // run findGameDoc inside each to locate the frame holding Audio/Restart/
      // Submit controls. Prefer results where a game doc was found. Script
      // shape adapted from MIT-licensed work by AllAboutAI-YT — see NOTICE.
      const allTargets = await CDP.List({ host: cdpHost, port: cdpPort });
      const iframeTargets = allTargets.filter((t) => t.type === "iframe");
      // Priority: Arkose > reCAPTCHA bframe (challenge) > reCAPTCHA anchor
      //           > hCaptcha > octocaptcha > generic.
      const bucket = (url) => {
        const u = url || "";
        if (u.includes("arkoselabs") || u.includes("funcaptcha")) return 0;
        if (u.includes("recaptcha") && u.includes("bframe")) return 1;
        if (u.includes("recaptcha") || u.includes("hcaptcha")) return 2;
        if (u.includes("octocaptcha")) return 3;
        if (u.includes("captcha")) return 4;
        return 99;
      };
      const candidates = iframeTargets
        .filter((t) => bucket(t.url) < 99)
        .sort((a, b) => bucket(a.url) - bucket(b.url));

      if (candidates.length === 0) return { found: false, error: "No captcha iframe found in CDP targets" };

      const runInFrame = async (target) => {
        const gc = await CDP({ host: cdpHost, port: cdpPort, target });
        try {
          await gc.Runtime.enable();
          return await evalJS(gc, captchaScript(action));
        } finally {
          try { await gc.close(); } catch (_) {}
        }
      };

      let lastResult = null;
      for (const target of candidates) {
        try {
          const result = await runInFrame(target);
          const found = result && (result.clicked === true || (Array.isArray(result.buttons) && result.buttons.length > 0) || (result.instructions && result.instructions.length > 0));
          if (found) return { ...result, frame: (target.url || "").substring(0, 150) };
          lastResult = { ...result, frame: (target.url || "").substring(0, 150) };
        } catch (_) {
          /* try next candidate */
        }
      }
      return lastResult || { found: false, error: "No captcha frame responded to action" };
    },
  };
}

// Injected inside a captcha iframe. Walks nested same-origin sub-iframes up
// to depth 5 to find the frame that actually holds Audio/Restart/Submit
// controls, then runs the requested action. Frame-discovery + Arkose/hCaptcha
// aria-label selectors adapted from MIT-licensed work by AllAboutAI-YT — see
// NOTICE. reCAPTCHA ID selectors (#recaptcha-*-button) added by browser-js.
function captchaScript(action) {
  return `
    (function(action) {
      // Markers that indicate the document holds interactive challenge controls.
      // Covers Arkose/hCaptcha (aria-label) and reCAPTCHA (#recaptcha-*-button ids).
      const GAME_MARKERS = 'a[aria-label], button[aria-label="Audio"], button[aria-label="Restart"], #recaptcha-verify-button, #recaptcha-audio-button, #recaptcha-reload-button';
      function findGameDoc(root, depth) {
        if (depth > 5) return null;
        if (root.querySelector(GAME_MARKERS) && root !== document) return root;
        const iframes = root.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (!doc) continue;
            const found = findGameDoc(doc, depth + 1);
            if (found) return found;
          } catch(e) { continue; }
        }
        return null;
      }
      let gameDoc = findGameDoc(document, 0);
      if (!gameDoc) gameDoc = document;
      const instructions = gameDoc.querySelector('.challenge-instructions, [class*="instructions"], [class*="prompt"], .rc-imageselect-desc, .rc-imageselect-desc-no-canonical');
      const instructionText = instructions && instructions.innerText ? instructions.innerText.trim() : null;
      const buttons = [];
      for (const el of gameDoc.querySelectorAll('a[aria-label], button[aria-label], button[type="submit"], #submit, .submit, [id^="recaptcha-"][id$="-button"]')) {
        const label = el.getAttribute('aria-label') || (el.innerText || '').trim() || el.id;
        if (label) buttons.push(label);
      }
      if (action === 'read') return { found: true, instructions: instructionText, buttons };
      if (action === 'next' || action === 'right') {
        const btn = gameDoc.querySelector('a[aria-label*="next" i], a[aria-label*="Navigate to next" i]');
        if (btn) { btn.click(); return { found: true, action: 'next', clicked: true }; }
        return { found: true, action: 'next', clicked: false, error: 'Next button not found' };
      }
      if (action === 'prev' || action === 'left') {
        const btn = gameDoc.querySelector('a[aria-label*="previous" i], a[aria-label*="Navigate to previous" i]');
        if (btn) { btn.click(); return { found: true, action: 'prev', clicked: true }; }
        return { found: true, action: 'prev', clicked: false, error: 'Previous button not found' };
      }
      if (action === 'submit') {
        // reCAPTCHA verify button, else generic submit/id fallback.
        const btn = gameDoc.querySelector('#recaptcha-verify-button')
          || gameDoc.querySelector('button[type="submit"], #submit, .submit')
          || Array.from(gameDoc.querySelectorAll('button'))
             .find(b => !(b.getAttribute('aria-label') || '').match(/audio|restart|help|undo/i));
        if (btn) { btn.click(); return { found: true, action: 'submit', clicked: true }; }
        return { found: true, action: 'submit', clicked: false, error: 'Submit button not found' };
      }
      if (action === 'audio') {
        const btn = gameDoc.querySelector('#recaptcha-audio-button, button[aria-label*="Audio" i], button[aria-label*="audio" i]');
        if (btn) { btn.click(); return { found: true, action: 'audio', clicked: true }; }
        return { found: true, action: 'audio', clicked: false };
      }
      if (action === 'restart') {
        const btn = gameDoc.querySelector('#recaptcha-reload-button, button[aria-label*="Restart" i], button[aria-label*="reload" i]');
        if (btn) { btn.click(); return { found: true, action: 'restart', clicked: true }; }
        return { found: true, action: 'restart', clicked: false };
      }
      return { found: true, error: 'Unknown action: ' + action };
    })(${JSON.stringify(action)})
  `;
}

// ─── Server startup ─────────────────────────────────────────────────────────

function startServer({ port = 9223, cdpHost = "127.0.0.1", cdpPort = 9222, bindHost = "127.0.0.1" } = {}) {
  const handlers = makeHandlers({ cdpHost, cdpPort });

  const server = http.createServer(async (req, res) => {
    const key = `${req.method} ${req.url.split("?")[0]}`;
    const handler = handlers[key];

    // CORS (local-only; keep simple)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (!handler) return sendJson(res, 404, { error: `No route for ${key}` });

    try {
      const body = req.method === "POST" ? await readBody(req) : {};
      const result = await handler(body);
      sendJson(res, 200, result);
    } catch (err) {
      const msg = /ECONNREFUSED/.test(err.message)
        ? "Cannot connect to Chrome. Launch it with --remote-debugging-port=" + cdpPort
        : err.message;
      sendJson(res, 500, { error: msg });
    }
  });

  server.listen(port, bindHost, () => {
    console.log(`browser-js HTTP server listening on http://${bindHost}:${port}`);
    console.log(`CDP target: ${cdpHost}:${cdpPort}`);
    console.log(`Endpoints: /recon /click /fill /read /dismiss /navigate /eval /scroll /type /dispatch /captcha /focus /tabs /health`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Pass --http-port <N> to use a different port.`);
      process.exit(1);
    }
    throw err;
  });

  return server;
}

module.exports = { startServer };
