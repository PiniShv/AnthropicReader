// A small headless Chrome driver over the DevTools protocol (CDP), shared by the dev scripts
// (screenshots, snapshot, a11y, security, robustness). No dependencies: Node 22+ has a global WebSocket.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CHROME = process.env.CHROME ||
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Starts Chrome with a throwaway profile. Always call close() (use try/finally).
// args: more command-line switches (the security check uses them to cut off the network).
export async function launchChrome(path = DEFAULT_CHROME, { args = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'cer-chrome-'));
  const chrome = spawn(path, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, ...args, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(r => { chrome.once('exit', r); chrome.once('error', r); });
  const removeProfile = async () => {
    // Chrome keeps writing to its profile while it shuts down: wait before deleting it.
    if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await exited; }
    // A helper process (crash reporter) can outlive Chrome and keep stderr open, which
    // would keep Node running for minutes.
    chrome.stderr.destroy();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };

  let browser;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      chrome.stderr.on('data', d => {
        if (buf === null) return;   // keep draining the pipe, so Chrome never blocks on it
        buf += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) { buf = null; resolve(m[1]); }
      });
      const fail = why => reject(new Error('Chrome did not start (' + why + '). Pass its path as the first argument or in CHROME.'));
      chrome.on('error', e => fail(e.code || e.message));
      chrome.on('exit', code => fail('exit code ' + code));
    });
    browser = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      browser.addEventListener('open', resolve, { once: true });
      browser.addEventListener('error', () => reject(new Error('Could not connect to Chrome')), { once: true });
    });
  } catch (err) {
    await removeProfile();
    throw err;
  }

  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  browser.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(method + ': ' + msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, method });
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });

  // A new tab. page.send() talks to it; page.on() gets its events ({ method, params }).
  async function openPage() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = {
      send: (method, params) => send(method, params, sessionId),
      on(fn) { listeners.add(msg => { if (msg.sessionId === sessionId) fn(msg); }); },
      // Runs an expression in the page (awaiting promises) and returns its JSON value. Given a
      // function, it calls it in the page with args, which go as JSON values, not as code.
      async evaluate(expr, ...args) {
        let r;
        if (typeof expr === 'function') {
          // The call needs an object in the page to run on: its global object.
          const { result } = await page.send('Runtime.evaluate', { expression: 'globalThis' });
          r = await page.send('Runtime.callFunctionOn', { objectId: result.objectId, functionDeclaration: String(expr),
            arguments: args.map(value => ({ value })), awaitPromise: true, returnByValue: true });
        } else {
          r = await page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        }
        if (r.exceptionDetails) {
          const ex = r.exceptionDetails.exception;
          throw new Error('Page script failed: ' + ((ex && ex.description) || r.exceptionDetails.text));
        }
        return r.result.value;
      },
      async waitFor(expr, ms = 15000) {
        for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
          if (await page.evaluate(expr)) return;
        }
        throw new Error('Timed out waiting for: ' + expr);
      },
    };
    return page;
  }

  async function close() {
    browser.close();
    await removeProfile();
  }

  // send() and on() talk to the whole browser, for sessions that are not a page (frames).
  return { openPage, close, send, on: fn => listeners.add(fn) };
}
