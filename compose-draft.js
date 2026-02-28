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
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const to = process.argv[2];
  const subject = process.argv[3];
  const body = process.argv[4];

  if (!to || !subject || !body) {
    console.error("Usage: node compose-draft.js <to> <subject> <body>");
    process.exit(1);
  }

  // Find any Gmail tab (u/0, u/1, etc.)
  const targets = (await CDP.List({ host, port })).filter((t) => t.type === "page");
  const gmailTab = targets.findIndex((t) => t.url.includes("mail.google.com/mail/"));

  if (gmailTab === -1) {
    console.error("Gmail tab not found");
    process.exit(1);
  }

  const client = await CDP({ host, port, target: targets[gmailTab] });
  await client.Page.enable();
  await client.Runtime.enable();

  async function evalJS(expr) {
    const { result, exceptionDetails } = await client.Runtime.evaluate({
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  }

  async function pressTab() {
    await client.Input.dispatchKeyEvent({
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await client.Input.dispatchKeyEvent({
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
  }

  try {
    // Click compose button
    await evalJS(`
      (() => {
        const selectors = [
          '[gh="cm"]',
          '.T-I.T-I-KE.L3',
          '[aria-label="Compose"]',
          '[aria-label="Opstellen"]',
          '[aria-label="Nieuw bericht"]'
        ];
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el) { el.click(); return 'clicked'; }
        }
        return 'not found';
      })()
    `);
    await sleep(2000);

    // Fill To field
    await evalJS(`
      (() => {
        const selectors = [
          'input[name="to"]',
          'textarea[name="to"]',
          '[aria-label="To recipients"]',
          '[aria-label*="Aan"]',
          '[aria-label*="To"]'
        ];
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el) {
            el.focus();
            el.value = ${JSON.stringify(to)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return 'filled';
          }
        }
        return 'not found';
      })()
    `);
    await sleep(400);

    // Confirm recipient chip
    await pressTab();
    await sleep(400);

    // Fill Subject field
    await evalJS(`
      (() => {
        const subj = document.querySelector('input[name="subjectbox"]');
        if (!subj) return 'not found';
        subj.focus();
        subj.value = ${JSON.stringify(subject)};
        subj.dispatchEvent(new Event('input', { bubbles: true }));
        return 'filled';
      })()
    `);
    await sleep(400);

    // Fill message body
    const bodyHtml = body.replace(/\n/g, "<br>");
    await evalJS(`
      (() => {
        const selectors = [
          'div.Am.Al.editable[role="textbox"]',
          'div[aria-label="Message Body"]',
          'div[aria-label*="Berichttekst"]',
          'div[role="textbox"][g_editable="true"]'
        ];
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el) {
            el.focus();
            el.innerHTML = ${JSON.stringify(bodyHtml)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return 'filled';
          }
        }
        return 'not found';
      })()
    `);
    await sleep(800);

    // Close compose and keep as draft
    await evalJS(`
      (() => {
        const selectors = [
          '[aria-label="Save & close"]',
          '[aria-label="Opslaan en sluiten"]',
          'img[aria-label="Save & close"]',
          'img[aria-label="Opslaan en sluiten"]'
        ];
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el) { el.click(); return 'closed'; }
        }
        return 'not found';
      })()
    `);

    console.log(`Draft created: ${subject}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    try {
      await client.close();
    } catch (_) {}
  }
}

main();
