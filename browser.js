#!/usr/bin/env node

/**
 * browser.js - Optimized CLI to control Chrome via CDP
 *
 * Single file. One CDP connection per invocation. Chainable commands.
 * Smart element finding by text. JSON output for agents.
 *
 * Launch Chrome first:  chrome --remote-debugging-port=9222
 *
 * Commands:
 *   list                              List all open tabs
 *   select <tab-index>                Switch active tab for subsequent commands
 *   open <url>                        Navigate to URL (waits for load)
 *   elements                          List all clickable elements
 *   click <index>                     Click element by index
 *   click-text <text>                 Find and click element by text content (skips elements)
 *   click-selector <css>              Click element by CSS selector
 *   content                           Get page text content
 *   screenshot [filename]             Capture screenshot
 *   type <text> [selector]            Type into focused/selected element
 *   fill <selector> <value>           Focus element + type value (form helper)
 *   scroll <up|down> [amount]         Scroll the page
 *   wait <selector> [timeout-ms]      Wait for element to appear
 *   evaluate <js>                     Execute JS in page context
 *   new-tab [url]                      Open a new tab (via CDP, no popup blocker)
 *   close [tab-index]                 Close a tab
 *   html [selector]                   Get outer HTML (default: body)
 *
 * Chain commands:    node browser.js open https://hn.com then elements
 * JSON output:       node browser.js --json list
 * Target tab:        node browser.js --tab 1 content
 * Custom port:       node browser.js --port 9333 list
 */

const CDP = require("chrome-remote-interface");

// ─── State ──────────────────────────────────────────────────────────────────

let client = null;
let currentTab = 0;
let port = 9222;
let host = "127.0.0.1";
let jsonMode = false;
let targets = [];

// ─── Output helpers ─────────────────────────────────────────────────────────

function out(data) {
  if (jsonMode) {
    console.log(JSON.stringify(data));
  } else if (typeof data === "string") {
    console.log(data);
  } else if (Array.isArray(data)) {
    data.forEach((item, i) => {
      const parts = Object.entries(item)
        .map(([k, v]) => (v ? `${k}=${v}` : ""))
        .filter(Boolean)
        .join(" ");
      console.log(`  [${i}] ${parts}`);
    });
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ─── CDP connection (single, reused across chained commands) ────────────────

let connectedTab = -1;

async function connect(tabIdx) {
  const idx = tabIdx !== undefined ? tabIdx : currentTab;

  // Reuse existing connection if same tab
  if (client && connectedTab === idx) {
    return client;
  }

  targets = await CDP.List({ host, port });
  targets = targets.filter((t) => t.type === "page");

  if (targets.length === 0) {
    throw new Error("No browser tabs found. Is Chrome open?");
  }

  if (!targets[idx]) {
    throw new Error(`Tab [${idx}] not found. ${targets.length} tab(s) open.`);
  }

  if (client) {
    try { await client.close(); } catch (_) {}
  }

  client = await CDP({ host, port, target: targets[idx] });
  await client.Page.enable();
  await client.Runtime.enable();
  connectedTab = idx;
  return client;
}

// ─── Evaluate JS in page ────────────────────────────────────────────────────

async function evalJS(expression) {
  const { result, exceptionDetails } = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    // Extract the actual error message, strip stack trace
    let msg =
      exceptionDetails.exception?.description ||
      exceptionDetails.exception?.value ||
      exceptionDetails.text ||
      "JS evaluation error";
    // Keep only the first line (error message without stack)
    msg = msg.split("\n")[0].replace(/^Error:\s*/, "");
    throw new Error(msg);
  }
  return result.value;
}

// ─── Shadow DOM helper (injected into page) ────────────────────────────────

const QUERY_ALL_DEEP = `
function deepQueryAll(selector, root = document) {
  const results = [];
  results.push(...root.querySelectorAll(selector));
  // Traverse shadow roots
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) {
      results.push(...deepQueryAll(selector, el.shadowRoot));
    }
  });
  return results;
}
`;

const CLICKABLE_SELECTOR = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]';

// ─── Commands ───────────────────────────────────────────────────────────────

const commands = {
  async list() {
    const tabs = (await CDP.List({ host, port })).filter((t) => t.type === "page");
    const data = tabs.map((t, i) => ({ tab: i, title: t.title, url: t.url }));
    if (!jsonMode) {
      console.log(`${tabs.length} tab(s):\n`);
      data.forEach((t) => console.log(`  [${t.tab}] ${t.title}\n      ${t.url}`));
    } else {
      out(data);
    }
    return data;
  },

  async select(args) {
    const idx = parseInt(args[0], 10);
    if (isNaN(idx)) throw new Error("Usage: select <tab-index>");
    currentTab = idx;
    await connect(idx);
    out(`Switched to tab [${idx}]: ${targets[idx].title}`);
  },

  async open(args) {
    let url = args[0];
    if (!url) throw new Error("Usage: open <url>");
    if (!/^https?:\/\//.test(url)) url = "https://" + url;

    const hasHash = url.includes("#");
    await connect();
    await client.Page.navigate({ url });
    await client.Page.loadEventFired();

    // Wait for JS-heavy pages; hash-based routing needs extra time
    const waitMs = hasHash ? 2000 : 500;
    await evalJS(`new Promise(r => setTimeout(r, ${waitMs}))`);

    const title = await evalJS("document.title");
    out(jsonMode ? { url, title } : `Navigated to: ${url} — "${title}"`);

    // Force reconnect on next command since page context changed
    connectedTab = -1;
  },

  async elements() {
    await connect();
    const items = await evalJS(`
      (() => {
        ${QUERY_ALL_DEEP}
        const els = deepQueryAll('${CLICKABLE_SELECTOR}');
        return els.map((el, i) => {
          const tag = el.tagName.toLowerCase();
          const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().substring(0, 100);
          const href = el.href || '';
          const type = el.type || '';
          return { i, tag, type: type || undefined, text: text || undefined, href: href || undefined };
        }).filter(e => e.text || e.href);
      })()
    `);

    if (!jsonMode) {
      console.log(`${items.length} clickable element(s):\n`);
      items.forEach((el) => {
        const parts = [`  [${el.i}] <${el.tag}>`];
        if (el.text) parts.push(`"${el.text}"`);
        if (el.href) parts.push(`-> ${el.href}`);
        console.log(parts.join(" "));
      });
    } else {
      out(items);
    }
    return items;
  },

  async click(args) {
    const idx = parseInt(args[0], 10);
    if (isNaN(idx)) throw new Error("Usage: click <element-index>");

    await connect();
    const res = await evalJS(`
      (() => {
        ${QUERY_ALL_DEEP}
        const els = deepQueryAll('${CLICKABLE_SELECTOR}');
        const el = els[${idx}];
        if (!el) return { error: 'Element not found at index ${idx}' };
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().substring(0, 100);
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { clicked: ${idx}, tag: el.tagName.toLowerCase(), text };
      })()
    `);

    if (res.error) throw new Error(res.error);
    await evalJS("new Promise(r => setTimeout(r, 800))");
    out(jsonMode ? res : `Clicked [${res.clicked}] <${res.tag}> "${res.text}"`);
    connectedTab = -1; // click may trigger navigation
  },

  async "click-text"(args) {
    const searchText = args[0];
    if (!searchText) throw new Error("Usage: click-text <text>");

    await connect();
    const res = await evalJS(`
      (() => {
        ${QUERY_ALL_DEEP}
        const search = ${JSON.stringify(searchText)}.toLowerCase();
        const els = deepQueryAll('${CLICKABLE_SELECTOR}');

        // Pass 1: exact match (trimmed text equals search)
        for (const el of els) {
          const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
          if (text.toLowerCase() === search) {
            el.scrollIntoView({ block: 'center' });
            el.click();
            return { clicked: text.substring(0, 100), tag: el.tagName.toLowerCase(), match: 'exact' };
          }
        }
        // Pass 2: partial match (text contains search)
        for (const el of els) {
          const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
          if (text.toLowerCase().includes(search)) {
            el.scrollIntoView({ block: 'center' });
            el.click();
            return { clicked: text.substring(0, 100), tag: el.tagName.toLowerCase(), match: 'partial' };
          }
        }
        // Pass 3: fallback — any leaf element containing the text (including shadow DOM)
        const all = deepQueryAll('*');
        for (const el of all) {
          if (el.children.length === 0 && el.innerText && el.innerText.trim().toLowerCase().includes(search)) {
            el.scrollIntoView({ block: 'center' });
            el.click();
            return { clicked: el.innerText.trim().substring(0, 100), tag: el.tagName.toLowerCase(), match: 'fallback' };
          }
        }
        return { error: 'No element found containing "' + search + '"' };
      })()
    `);

    if (res.error) throw new Error(res.error);
    await evalJS("new Promise(r => setTimeout(r, 800))");
    out(jsonMode ? res : `Clicked <${res.tag}> "${res.clicked}"`);
    connectedTab = -1; // click may trigger navigation
  },

  async "click-selector"(args) {
    const selector = args[0];
    if (!selector) throw new Error("Usage: click-selector <css-selector>");

    await connect();
    const safeSelector = JSON.stringify(selector);
    const res = await evalJS(`
      (() => {
        const sel = ${safeSelector};
        const el = document.querySelector(sel);
        if (!el) return { error: 'No element matches selector: ' + sel };
        const text = (el.innerText || el.value || '').trim().substring(0, 100);
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { clicked: text, tag: el.tagName.toLowerCase(), selector: sel };
      })()
    `);

    if (res.error) throw new Error(res.error);
    await evalJS("new Promise(r => setTimeout(r, 800))");
    out(jsonMode ? res : `Clicked <${res.tag}> "${res.clicked}"`);
    connectedTab = -1; // click may trigger navigation
  },

  async content() {
    await connect();
    const text = await evalJS(`
      (() => {
        function getTextDeep(root) {
          let text = '';
          // For regular elements, clone and strip scripts
          if (root.cloneNode && !(root instanceof ShadowRoot)) {
            const clone = root.cloneNode(true);
            clone.querySelectorAll('script, style, noscript, svg, iframe').forEach(el => el.remove());
            text += (clone.innerText || '');
          } else {
            // For shadow roots, collect text from children directly
            root.querySelectorAll('*').forEach(el => {
              if (el.children.length === 0 && !['SCRIPT','STYLE','SVG','NOSCRIPT'].includes(el.tagName)) {
                const t = (el.innerText || el.textContent || '').trim();
                if (t) text += t + '\\n';
              }
            });
          }
          // Recurse into shadow roots
          root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
              text += '\\n' + getTextDeep(el.shadowRoot);
            }
          });
          return text;
        }
        return getTextDeep(document.body).replace(/\\n{3,}/g, '\\n\\n').trim().substring(0, 15000);
      })()
    `);

    const title = await evalJS("document.title");
    const url = await evalJS("window.location.href");

    if (jsonMode) {
      out({ title, url, content: text });
    } else {
      console.log(`[${title}] ${url}\n`);
      console.log(text);
    }
    return text;
  },

  async screenshot(args) {
    const filename = args[0] || `screenshot-${Date.now()}.png`;
    await connect();
    const { data } = await client.Page.captureScreenshot({ format: "png" });
    const path = require("path");
    const fs = require("fs");
    const filepath = path.resolve(filename);
    fs.writeFileSync(filepath, Buffer.from(data, "base64"));
    out(jsonMode ? { file: filepath } : `Screenshot saved: ${filepath}`);
  },

  async type(args) {
    const text = args[0];
    if (!text) throw new Error("Usage: type <text> [css-selector]");
    const selector = args[1];

    await connect();
    if (selector) {
      const found = await evalJS(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        return true;
      })()`);
      if (!found) throw new Error(`Element not found: ${selector}`);
    }

    for (const char of text) {
      await client.Input.dispatchKeyEvent({ type: "keyDown", text: char });
      await client.Input.dispatchKeyEvent({ type: "keyUp", text: char });
    }

    out(jsonMode ? { typed: text, selector } : `Typed: "${text}"`);
  },

  async fill(args) {
    const selector = args[0];
    const value = args[1];
    if (!selector || !value) throw new Error("Usage: fill <css-selector> <value>");

    await connect();
    const safeSelector = JSON.stringify(selector);
    const safeValue = JSON.stringify(value);
    await evalJS(`
      (() => {
        const sel = ${safeSelector};
        const el = document.querySelector(sel);
        if (!el) throw new Error('Element not found: ' + sel);
        el.focus();
        el.value = ${safeValue};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);

    out(jsonMode ? { filled: selector, value } : `Filled "${selector}" with "${value}"`);
  },

  async scroll(args) {
    const direction = args[0] || "down";
    const amount = parseInt(args[1], 10) || 500;

    await connect();
    const dy = direction === "up" ? -amount : amount;
    await evalJS(`window.scrollBy(0, ${dy})`);
    out(jsonMode ? { scrolled: direction, amount } : `Scrolled ${direction} ${amount}px`);
  },

  async wait(args) {
    const selector = args[0];
    const timeout = parseInt(args[1], 10) || 5000;
    if (!selector) throw new Error("Usage: wait <css-selector> [timeout-ms]");

    await connect();
    const safeSelector = JSON.stringify(selector);
    const found = await evalJS(`
      new Promise((resolve) => {
        const sel = ${safeSelector};
        if (document.querySelector(sel)) return resolve(true);
        const observer = new MutationObserver(() => {
          if (document.querySelector(sel)) {
            observer.disconnect();
            resolve(true);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve(false); }, ${timeout});
      })
    `);

    if (!found) throw new Error(`Timeout: "${selector}" not found within ${timeout}ms`);
    out(jsonMode ? { found: selector } : `Found: ${selector}`);
  },

  async evaluate(args) {
    const expr = args[0];
    if (!expr) throw new Error("Usage: evaluate <js-expression>");

    await connect();
    const result = await evalJS(expr);
    out(jsonMode ? { result } : (result !== undefined ? result : "(undefined)"));
    return result;
  },

  async "new-tab"(args) {
    const url = args[0] || "about:blank";
    const target = await CDP.New({ host, port, url: /^https?:\/\//.test(url) ? url : "https://" + url });
    // Invalidate connection so next command connects to new tab
    if (client) { try { await client.close(); } catch (_) {} }
    client = null;
    connectedTab = -1;
    // Refresh targets and find the new tab's index
    const tabs = (await CDP.List({ host, port })).filter((t) => t.type === "page");
    const idx = tabs.findIndex((t) => t.id === target.id);
    if (idx !== -1) currentTab = idx;
    out(jsonMode ? { tab: idx, title: target.title || "", url: target.url } : `New tab [${idx}]: ${target.url}`);
  },

  async close(args) {
    const idx = parseInt(args[0] ?? currentTab, 10);
    const tabs = (await CDP.List({ host, port })).filter((t) => t.type === "page");
    if (!tabs[idx]) throw new Error(`Tab [${idx}] not found.`);
    const title = tabs[idx].title;
    await CDP.Close({ host, port, id: tabs[idx].id });
    // Invalidate connection since tab is gone
    if (client) { try { await client.close(); } catch (_) {} }
    client = null;
    connectedTab = -1;
    // Wait for Chrome to process the close
    await new Promise((r) => setTimeout(r, 500));
    out(jsonMode ? { closed: idx, title } : `Closed tab [${idx}]: ${title}`);
  },

  async html(args) {
    const selector = args[0] || "body";
    await connect();
    const safeSelector = JSON.stringify(selector);
    const html = await evalJS(`
      (() => {
        const el = document.querySelector(${safeSelector});
        return el ? el.outerHTML.substring(0, 20000) : null;
      })()
    `);
    if (!html) throw new Error(`Element not found: ${selector}`);
    out(jsonMode ? { selector, html } : html);
  },
};

// ─── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const chains = [];
  let current = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--json") {
      jsonMode = true;
    } else if (arg === "--tab" && argv[i + 1]) {
      currentTab = parseInt(argv[++i], 10);
    } else if (arg === "--port" && argv[i + 1]) {
      port = parseInt(argv[++i], 10);
    } else if (arg === "then") {
      // Chain separator
      current = null;
    } else if (!current) {
      current = { cmd: arg, args: [] };
      chains.push(current);
    } else {
      current.args.push(arg);
    }
  }

  return chains;
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
browser.js — Control Chrome via CDP (optimized single-file CLI)

Usage:  node browser.js [flags] <command> [args] [then <command> [args] ...]

Commands:
  list                              List all open tabs
  select <tab-index>                Switch active tab
  open <url>                        Navigate to URL (waits for load)
  elements                          List all clickable elements
  click <index>                     Click element by index
  click-text <text>                 Click first element matching text (no elements needed)
  click-selector <css>              Click element by CSS selector
  content                           Get page text content
  screenshot [filename]             Capture page screenshot
  type <text> [selector]            Type into element
  fill <selector> <value>           Set input value directly
  scroll <up|down> [px]             Scroll the page (default: 500px)
  wait <selector> [timeout]         Wait for element to appear
  evaluate <js>                     Run JavaScript in page
  html [selector]                   Get HTML (default: body)
  new-tab [url]                     Open a new tab (via CDP, no popup blocker)
  close [tab-index]                 Close a tab

Flags:
  --json          Output JSON (for agent parsing)
  --tab <index>   Target tab (default: 0)
  --port <port>   CDP port (default: 9222)

Chain commands with "then":
  node browser.js open https://hn.com then content
  node browser.js open https://hn.com then elements then click 5
  node browser.js --json open https://hn.com then elements

Smart click (no need to run elements first):
  node browser.js click-text "Sign In"
  node browser.js click-selector "#submit-btn"
`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const chains = parseArgs(process.argv.slice(2));

  if (chains.length === 0 || chains[0].cmd === "help" || chains[0].cmd === "--help") {
    printHelp();
    return;
  }

  try {
    for (const { cmd, args } of chains) {
      const handler = commands[cmd];
      if (!handler) {
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exit(1);
      }
      await handler(args);
    }
  } catch (err) {
    if (err.message?.includes("ECONNREFUSED")) {
      console.error("Cannot connect to Chrome. Launch it with: chrome --remote-debugging-port=9222");
    } else {
      console.error(jsonMode ? JSON.stringify({ error: err.message }) : `Error: ${err.message}`);
    }
    process.exit(1);
  } finally {
    if (client) {
      try { await client.close(); } catch (_) {}
    }
  }
}

main();
