// The Gemini Usage card: the first quota group large, any others as thin rows, from the extension's messages.
'use strict';
(function () {
  const vscode = acquireVsCodeApi();
  const COL = { warn: '#FBBF24', crit: '#F87171' };
  const $ = (id) => document.getElementById(id);
  let cfg = { warnPercent: 60, critPercent: 85 };
  let usage = null, note = 'loading...';

  function level(p) { return p >= cfg.critPercent ? 'crit' : p >= cfg.warnPercent ? 'warn' : 'ok'; }

  function span(ms) {
    const secs = (ms - Date.now()) / 1000;
    if (!(secs > 0)) return null;
    const mins = Math.floor(secs / 60), h = Math.floor(mins / 60), mm = mins % 60;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h >= 1) return `${h}h ${String(mm).padStart(2, '0')}m`;
    return `${mm}m`;
  }

  // Google's Gemini gradient on the bars; only a filling Gemini week takes the warning colours.
  function render() {
    const gs = usage && usage.groups ? usage.groups : [];
    const g = gs[0];
    $('name').textContent = g ? g.name : 'GEMINI';
    if (!g) {
      $('pct').textContent = '--';
      $('pct').style.color = '';
      $('barS').style.width = '0';
      $('reset').textContent = note;
    } else {
      const lv = level(g.used);
      $('pct').textContent = String(g.used);
      $('pct').style.color = lv === 'ok' ? '' : COL[lv];
      $('barS').style.width = `${Math.min(100, g.used)}%`;
      $('barS').style.background = lv === 'ok' ? '' : COL[lv];
      const s = g.reset ? span(g.reset) : null;
      $('reset').textContent = s ? `week resets in ${s}` : 'this week';
    }
    const others = $('others');
    others.textContent = '';
    for (const o of gs.slice(1)) {
      const s = o.reset ? span(o.reset) : null;
      const lim = document.createElement('div');
      lim.className = 'lim';
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = o.name;
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = `${o.used}%` + (s ? `  ·  ${s}` : '');
      lim.append(lbl, val);
      const bar = document.createElement('div');
      bar.className = 'bar thin';
      const fill = document.createElement('div');
      fill.style.width = `${Math.min(100, o.used)}%`;
      bar.append(fill);
      others.append(lim, bar);
    }
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type !== 'state') return;
    if (msg.config) cfg = Object.assign(cfg, msg.config);
    if ('usage' in msg) usage = msg.usage;
    if ('note' in msg) note = msg.note;
    render();
  });

  setInterval(render, 60000); // reset countdowns
  render();
  vscode.postMessage({ type: 'ready' });
})();
