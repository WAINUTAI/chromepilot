#!/usr/bin/env node
/**
 * compose-draft.js - Compose a Gmail draft via CDP
 * Usage: node compose-draft.js <to> <subject> <body>
 * Body uses \n for newlines
 */

const CDP = require("chrome-remote-interface");

const port = 9222;
const host = "127.0.0.1";

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const to = process.argv[2];
  const subject = process.argv[3];
  const body = process.argv[4];

  if (!to || !subject || !body) {
    console.error("Usage: node compose-draft.js <to> <subject> <body>");
    process.exit(1);
  }

  // Find the Gmail tab
  const targets = (await CDP.List({ host, port })).filter(t => t.type === "page");
  const gmailTab = targets.findIndex(t => t.url.includes("mail.google.com/mail/u/1"));

  if (gmailTab === -1) {
    console.error("Gmail tab not found");
    process.exit(1);
  }

  const client = await CDP({ host, port, target: targets[gmailTab] });
  await client.Page.enable();
  await client.Runtime.enable();

  async function evalJS(expr) {
    const { result, exceptionDetails } = await client.Runtime.evaluate({
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  }

  async function typeText(text) {
    for (const char of text) {
      await client.Input.dispatchKeyEvent({ type: "keyDown", text: char });
      await client.Input.dispatchKeyEvent({ type: "keyUp", text: char });
    }
  }

  async function pressKey(key) {
    await client.Input.dispatchKeyEvent({ type: "rawKeyDown", windowsVirtualKeyCode: key, nativeVirtualKeyCode: key });
    await client.Input.dispatchKeyEvent({ type: "keyUp", windowsVirtualKeyCode: key, nativeVirtualKeyCode: key });
  }

  try {
    // Click Compose button
    await evalJS(`
      (() => {
        const btn = document.querySelector('[gh="cm"]') || document.querySelector('.T-I.T-I-KE.L3');
        if (btn) { btn.click(); return 'clicked'; }
        return 'not found';
      })()
    `);
    await sleep(2000);

    // Fill To field
    await evalJS(`
      (() => {
        const toInput = document.querySelector('input[name="to"], textarea[name="to"], [aria-label*="Aan"]');
        if (toInput) { toInput.focus(); toInput.value = ${JSON.stringify(to)}; toInput.dispatchEvent(new Event('input', {bubbles:true})); return 'filled'; }
        return 'not found';
      })()
    `);
    await sleep(500);

    // Press Tab to confirm the To field
    await pressKey(9); // Tab
    await sleep(500);

    // Fill Subject field
    await evalJS(`
      (() => {
        const subj = document.querySelector('input[name="subjectbox"]');
        if (subj) { subj.focus(); subj.value = ${JSON.stringify(subject)}; subj.dispatchEvent(new Event('input', {bubbles:true})); return 'filled'; }
        return 'not found';
      })()
    `);
    await sleep(500);

    // Fill body - use the contenteditable div
    const bodyHtml = body.replace(/\n/g, '<br>');
    await evalJS(`
      (() => {
        const bodyEl = document.querySelector('[role="textbox"][aria-label*="Berichttekst"], div[aria-label*="Berichttekst"], div.Am.Al.editable');
        if (bodyEl) {
          bodyEl.focus();
          bodyEl.innerHTML = ${JSON.stringify(bodyHtml)};
          bodyEl.dispatchEvent(new Event('input', {bubbles:true}));
          return 'filled';
        }
        return 'not found';
      })()
    `);
    await sleep(1000);

    // Close compose window (saves as draft) - click the X button
    await evalJS(`
      (() => {
        const closeBtn = document.querySelector('[aria-label="Opslaan en sluiten"], img[aria-label="Opslaan en sluiten"]');
        if (closeBtn) { closeBtn.click(); return 'closed'; }
        // Try clicking the close/minimize button on compose
        const saveBtns = document.querySelectorAll('.Ha img, .Ha .Hm img');
        for (const btn of saveBtns) {
          if (btn.getAttribute('aria-label')?.includes('sluit') || btn.getAttribute('aria-label')?.includes('Opslaan')) {
            btn.click();
            return 'closed';
          }
        }
        return 'not found';
      })()
    `);
    await sleep(1000);

    console.log(`Draft created: ${subject}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    try { await client.close(); } catch (_) {}
  }
}

main();
