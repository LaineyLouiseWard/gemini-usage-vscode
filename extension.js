// Gemini Usage for VS Code: your Google AI plan's weekly limits in Antigravity CLI, in a small sidebar card.
// It runs `agy -p /usage --output-format json`, which reads the quotas and calls no model.
'use strict';
const vscode = require('vscode');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WIN = process.platform === 'win32';

// --------------------------------------------------------------------- agy ----

function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

// The settings path, then PATH, then the installer's default folder (VS Code started from the dock may not see it).
function findAgy() {
  const set = vscode.workspace.getConfiguration('geminiUsage').get('agyPath');
  if (set && isFile(set)) return set;
  const names = WIN ? ['agy.exe'] : ['agy'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) for (const n of names) if (dir && isFile(path.join(dir, n))) return path.join(dir, n);
  const home = path.join(os.homedir(), '.local', 'bin', WIN ? 'agy.exe' : 'agy');
  return isFile(home) ? home : null;
}

function readAgyUsage(exe) {
  return new Promise((resolve) => {
    cp.execFile(exe, ['-p', '/usage', '--output-format', 'json'],
      { cwd: os.tmpdir(), timeout: 60000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err && !stdout ? null : String(stdout || '')));
  });
}

// One JSON line carries command.data.groups; each group has a weekly bucket with remaining_fraction and reset_time.
function parseAgyUsage(text) {
  for (const line of String(text || '').split('\n').reverse()) {
    if (!line.trim().startsWith('{')) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    const groups = m && m.command && m.command.data && m.command.data.groups;
    if (!Array.isArray(groups)) continue;
    const out = [];
    for (const g of groups) {
      const b = (g.buckets || []).find((x) => typeof x.remaining_fraction === 'number');
      if (!b) continue;
      const reset = Date.parse(b.reset_time);
      out.push({
        name: String(g.name || '').replace(/\s+models$/i, '').toUpperCase(),
        used: Math.round((1 - b.remaining_fraction) * 100),
        reset: Number.isNaN(reset) ? null : reset,
      });
    }
    if (out.length) return { groups: out };
  }
  return null;
}

// ----------------------------------------------------------------- the view ----

class UsageView {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.state = { usage: null, note: 'loading...' };
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((msg) => { if (msg.type === 'ready') this.post(); });
    view.onDidDispose(() => { this.view = null; });
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const src = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${src('style.css')}"></head><body>
<div id="card">
  <div class="lim top"><span class="lbl" id="name">GEMINI</span><span id="reset" class="val">loading...</span></div>
  <div class="row"><div class="pct"><span id="pct">--</span><span class="sign">%</span></div><div class="bar"><div id="barS"></div></div></div>
  <div id="others"></div>
</div>
<script nonce="${nonce}" src="${src('main.js')}"></script>
</body></html>`;
  }

  post() {
    if (!this.view) return;
    this.view.webview.postMessage(Object.assign({ type: 'state', config: config() }, this.state));
  }
}

function config() {
  const c = vscode.workspace.getConfiguration('geminiUsage');
  return { warnPercent: c.get('warnPercent'), critPercent: c.get('critPercent') };
}

// ------------------------------------------------------------------ activate ----

function activate(context) {
  const view = new UsageView(context);
  let probing = false;

  // A failed read keeps the last numbers.
  async function refresh() {
    if (probing) return;
    const exe = findAgy();
    if (!exe) { view.state.note = 'agy not found: set geminiUsage.agyPath'; view.post(); return; }
    probing = true;
    const u = parseAgyUsage(await readAgyUsage(exe));
    probing = false;
    if (u) { view.state.usage = u; view.state.note = ''; }
    else view.state.note = 'no limits from agy (run agy once to sign in)';
    view.post();
  }

  let timer = null;
  function schedule() {
    clearInterval(timer);
    const secs = Math.max(60, vscode.workspace.getConfiguration('geminiUsage').get('refreshSeconds') || 300);
    timer = setInterval(refresh, secs * 1000);
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('geminiUsage.view', view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('geminiUsage.refresh', refresh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('geminiUsage')) return;
      if (e.affectsConfiguration('geminiUsage.refreshSeconds')) schedule();
      if (e.affectsConfiguration('geminiUsage.agyPath')) refresh();
      view.post();
    }),
    { dispose: () => clearInterval(timer) },
  );
  schedule();
  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate, parseAgyUsage };
