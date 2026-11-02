// Runs the extension against a fake `vscode` module: `node test/test.js`. Uses the real agy unless AGY_STUB is set.
'use strict';
const Module = require('module');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const settings = { refreshSeconds: 300, warnPercent: 60, critPercent: 85, agyPath: process.env.AGY_STUB || '' };
const registered = {};
const fakeVscode = {
  workspace: { getConfiguration: () => ({ get: (k) => settings[k] }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  window: { registerWebviewViewProvider: (id, p) => { registered.view = p; return { dispose() {} }; } },
  commands: { registerCommand: (id, fn) => { registered[id] = fn; return { dispose() {} }; } },
  Uri: { joinPath: (...p) => p.join('/') },
};
const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? fakeVscode : load(req, ...rest));
const ext = require('../extension.js');

(async () => {
  // Parsing: a JSON line among log lines, junk, and a group without a usable bucket.
  const sample = 'ERROR: logging before google.Init\n' + JSON.stringify({ command: { data: { groups: [
    { name: 'Gemini Models', buckets: [{ remaining_fraction: 0.25, reset_time: '2026-11-09T11:59:14Z' }] },
    { name: 'Claude and GPT models', buckets: [{ remaining_fraction: 1, reset_time: 'not a date' }] },
    { name: 'Empty', buckets: [] },
  ] } } });
  const p = ext.parseAgyUsage(sample);
  assert.deepStrictEqual(p.groups.map((g) => [g.name, g.used]), [['GEMINI', 75], ['CLAUDE AND GPT', 0]]);
  assert.strictEqual(p.groups[0].reset, Date.parse('2026-11-09T11:59:14Z'));
  assert.strictEqual(p.groups[1].reset, null);
  assert.strictEqual(ext.parseAgyUsage('not json'), null);
  assert.strictEqual(ext.parseAgyUsage(''), null);

  // The whole path: activate, open the view, refresh, read what the card is sent.
  const posted = [];
  const ctx = { subscriptions: [], extensionUri: '/ext' };
  ext.activate(ctx);
  registered.view.resolveWebviewView({
    webview: { options: {}, asWebviewUri: (u) => u, cspSource: 'x', onDidReceiveMessage: () => {}, postMessage: (m) => posted.push(m), html: '' },
    onDidDispose: () => {},
  });
  for (let t = 0; t < 600 && !posted.length; t++) await new Promise((r) => setTimeout(r, 100)); // the start-up refresh
  assert.ok(posted.length, 'nothing was sent to the card within 60 s');
  const last = posted[posted.length - 1];
  console.log(JSON.stringify({ usage: last.usage, note: last.note }));
  ctx.subscriptions.forEach((s) => s.dispose && s.dispose());
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
