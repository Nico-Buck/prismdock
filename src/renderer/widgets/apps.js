import { icon, esc, fmtBytes, fmtDate, fmtTimeShort } from '../shared/ui.js';

const base = (p = '') => p.split('\\').pop().replace(/\.(exe|lnk|url)$/i, '');
const lc = (s) => (s || '').toLowerCase();
const P = (ctx, n) => Math.round(n * ctx.u);
// Windows 11 style logo: four panes with a soft blue gradient
const WIN_LOGO = (id) => `<svg viewBox="0 0 24 24"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6cd3ff"/><stop offset="1" stop-color="#0a6cff"/></linearGradient></defs><rect x="2.2" y="2.2" width="9.2" height="9.2" rx="1.3" fill="url(#${id})"/><rect x="12.6" y="2.2" width="9.2" height="9.2" rx="1.3" fill="url(#${id})"/><rect x="2.2" y="12.6" width="9.2" height="9.2" rx="1.3" fill="url(#${id})"/><rect x="12.6" y="12.6" width="9.2" height="9.2" rx="1.3" fill="url(#${id})"/></svg>`;
const startButton = (ctx) => `<button class="start-btn" data-a="start" data-tip="Start">${WIN_LOGO('wg-' + ctx.inst.uid)}</button>`;
const openStart = async (ctx) => { ctx.closePanel(); await ctx.act('start'); };

// Resolve .lnk targets once so pinned shortcuts can be matched to running windows.
const targets = new Map();
async function targetOf(ctx, p) {
  if (!/\.lnk$/i.test(p)) return p;
  if (targets.has(p)) return targets.get(p);
  targets.set(p, p);
  try { const r = await ctx.act('resolve', { path: p }); if (r?.target) targets.set(p, r.target); ctx.rerender(); } catch { /* keep lnk */ }
  return targets.get(p);
}

async function defaultPins(ctx) {
  const apps = await ctx.api.startApps();
  const want = ['Microsoft Edge', 'Google Chrome', 'Firefox', 'Visual Studio Code', 'Spotify', 'Discord', 'Steam', 'Terminal', 'Notepad', 'Editor'];
  const pins = [{ path: 'C:\\Windows\\explorer.exe', name: 'File Explorer' }];
  for (const w of want) {
    const a = apps.find((x) => lc(x.name) === lc(w));
    if (a && !pins.some((p) => lc(p.name) === lc(a.name)) && pins.length < 7) pins.push({ path: a.path, name: a.name });
  }
  return pins;
}

function appButton(ctx, { key, img, name, running, active, count, action = 'app' }) {
  return `<button class="ico-btn ${running ? 'running' : ''} ${active ? 'active' : ''}" data-a="${action}" data-v="${esc(key)}" data-tip="${esc(name)}" data-ctx="app">
    ${img ? `<img class="app-ic" src="${img}">` : `<span class="app-ic" style="display:flex;align-items:center;justify-content:center;border-radius:calc(9px*var(--u));background:var(--fill-2)">${icon('window', P(ctx, 18))}</span>`}
    ${running ? `<span class="dot"></span>` : ''}${count > 1 ? `<span class="badge" style="background:var(--fill-3);color:var(--text)">${count}</span>` : ''}</button>`;
}

function iconFor(ctx, p) {
  const c = ctx.icons.get(p);
  if (c !== undefined) return c;
  ctx.icons.set(p, null);
  const retry = () => setTimeout(() => { if (ctx.icons.get(p) === null) ctx.icons.delete(p); }, 15000); // helper busy: ask again later
  ctx.api.icon(p, 96).then((url) => { if (!url) return retry(); ctx.icons.set(p, url); ctx.rerender(); }, retry);
  return null;
}

function groups(ctx, windows) {
  const pins = ctx.s.pins || [];
  const byExe = new Map();
  for (const w of windows || []) { const k = lc(w.exe); if (!byExe.has(k)) byExe.set(k, []); byExe.get(k).push(w); }
  const items = pins.map((p) => {
    const t = targets.get(p.path) || (/\.lnk$/i.test(p.path) ? (targetOf(ctx, p.path), p.path) : p.path);
    // exact exe match first; launcher shortcuts (e.g. Update.exe --processStart) fall back to the app name
    const key = byExe.has(lc(t)) ? lc(t) : [...byExe.keys()].find((k) => lc(base(k)) === lc(base(t)) || lc(base(k)) === lc(p.name));
    const ws = (key && byExe.get(key)) || [];
    if (key) byExe.delete(key);
    return { key: 'pin:' + p.path, path: p.path, name: p.name || base(p.path), wins: ws, pinned: true };
  });
  const running = [...byExe.entries()].map(([exe, ws]) => ({ key: 'run:' + exe, path: ws[0].exe, name: ws[0].title, wins: ws, pinned: false }));
  return { items, running };
}

async function activate(ctx, g) {
  if (!g) return;
  if (!g.wins.length) { await ctx.act('open', { target: g.path }); setTimeout(() => ctx.hub.refresh('windows'), 1200); return; }
  const active = g.wins.find((w) => w.active);
  if (active && g.wins.length > 1) {
    const i = g.wins.indexOf(active); await ctx.act('focusWindow', { hwnd: g.wins[(i + 1) % g.wins.length].hwnd });
  } else await ctx.act('focusWindow', { hwnd: (active || g.wins[0]).hwnd, toggle: true });
  setTimeout(() => ctx.hub.refresh('windows'), 300);
}
const findGroup = (ctx, key) => { const { items, running } = groups(ctx, ctx.hub.peek('windows')); return [...items, ...running].find((g) => g.key === key); };

function launcherPanel(ctx, all, query) {
  const q = lc(query || '');
  const list = (all || []).filter((a) => !q || lc(a.name).includes(q)).slice(0, q ? 40 : 60);
  return `<div class="pn"><div class="pn-head"><h3>${icon('grid', 18)} Apps</h3><span class="sub">${all ? all.length : '…'}</span></div>
    <input class="inp" placeholder="Search apps …" data-input="q" data-enter="launchFirst" value="${esc(query || '')}" autofocus>
    <div class="pn-list" style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;max-height:330px">${list.map((a) => `<button class="btn" data-a="launch" data-v="${esc(a.path)}" style="height:78px;flex-direction:column;gap:6px;background:transparent;padding:4px;font-weight:500;font-size:11px;white-space:normal;line-height:1.15;text-align:center"><img data-icon="${esc(a.path)}" style="width:34px;height:34px;object-fit:contain"><span style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(a.name)}</span></button>`).join('') || '<div class="empty" style="grid-column:1/-1">No matches.</div>'}</div></div>`;
}

const COMMANDS = [
  ['Windows Settings', 'gear', 'ms-settings:'], ['Lock screen', 'lock', '@lock'], ['Screenshot (region)', 'camera', '@snip'],
  ['Task Manager', 'chart', 'C:\\Windows\\System32\\Taskmgr.exe'], ['File Explorer', 'folder', 'C:\\Windows\\explorer.exe'], ['Downloads', 'folder', '@downloads'],
  ['Control Panel', 'gear', 'C:\\Windows\\System32\\control.exe'], ['Terminal', 'terminal', 'wt.exe'], ['PrismDock settings', 'sparkles', '@prism'], ['Edit dock layout', 'edit', '@editor'],
];
async function runCommand(ctx, target) {
  if (target === '@lock') return ctx.act('lock');
  if (target === '@snip') return ctx.act('screenshot', { mode: 'region' });
  if (target === '@prism') return ctx.openSettings();
  if (target === '@editor') return ctx.openEditor();
  // Windows Terminal ships with Windows 11 22H2+ only; elsewhere fall back to PowerShell
  if (target === 'wt.exe') return (await ctx.act('open', { target }).catch(() => false)) || ctx.act('open', { target: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' });
  return ctx.act('open', { target });
}

function searchResults(ctx, q, all) {
  const out = [];
  const s = (q || '').trim();
  if (!s) return out;
  if (/^[a-z]:\\|^\\\\|^%/i.test(s)) out.push({ label: `Open path: ${s}`, icon: 'folder', run: () => ctx.act('open', { target: s }) });
  if (/^https?:\/\/|^[\w-]+\.[a-z]{2,}(\/|$)/i.test(s)) out.push({ label: `Open: ${s}`, icon: 'globe', run: () => ctx.act('open', { target: /^https?:/.test(s) ? s : 'https://' + s }) });
  for (const [label, ic, target] of COMMANDS) if (lc(label).includes(lc(s))) out.push({ label, icon: ic, run: () => runCommand(ctx, target) });
  for (const a of (all || []).filter((x) => lc(x.name).includes(lc(s))).slice(0, 7)) out.push({ label: a.name, img: a.path, run: () => ctx.act('open', { target: a.path }) });
  out.push({ label: `Search the web for “${s}”`, icon: 'search', run: () => ctx.act('open', { target: (ctx.s.engine || 'https://www.google.com/search?q=') + encodeURIComponent(s) }) });
  out.push({ label: `Windows search for “${s}”`, icon: 'window', run: () => ctx.act('open', { target: 'search-ms:query=' + encodeURIComponent(s) }) });
  return out;
}

export default [
  {
    type: 'winkey', name: 'Start', cat: 'apps', icon: 'winlogo', desc: 'The Windows key as a button: opens the Start menu, just like the taskbar’s Start button.',
    sizes: ['s'], size: 's', topics: [], noPanel: true, tileClass: 'start-tile',
    tile(ctx) { return `<div class="tin sq">${startButton(ctx)}</div>`; },
    onClick: async (ctx, ev) => { await openStart(ctx, ev.target); return true; },
    on: { start: (ctx, el) => openStart(ctx, el) },
  },
  {
    type: 'apps', name: 'Apps', cat: 'apps', icon: 'grid', desc: 'Your pinned apps and every open window, with running indicators.',
    sizes: ['m'], size: 'm', topics: ['windows'], bare: true, noPanel: true,
    settings: [{ key: 'showStart', label: 'Built-in Start button', type: 'toggle', default: false }, { key: 'showRunning', label: 'Show open apps that are not pinned', type: 'toggle', default: true }, { key: 'pins', type: 'pins', label: 'Pinned apps' }],
    async init(ctx) { if (!ctx.s.pins) ctx.saveSettings({ pins: await defaultPins(ctx) }); },
    tile(ctx, { windows }) {
      const { items, running } = groups(ctx, windows);
      const btn = (g) => appButton(ctx, { key: g.key, img: iconFor(ctx, g.path), name: g.pinned ? g.name : g.wins[0].title, running: g.wins.length > 0, active: g.wins.some((w) => w.active), count: g.wins.length });
      return `<div class="tin" style="padding:0 calc(2px*var(--u));gap:calc(2px*var(--u))">
        ${ctx.s.showStart ? startButton(ctx) : ''}
        ${items.map(btn).join('')}
        ${ctx.s.showRunning && running.length ? `<span style="width:1px;height:calc(26px*var(--u));background:var(--tile-border);margin:0 calc(4px*var(--u))"></span>${running.map(btn).join('')}` : ''}
      </div>`;
    },
    contextMenu(ctx, el) {
      const key = el.dataset.v; const g = findGroup(ctx, key); if (!g) return [];
      const pins = ctx.s.pins || [];
      const items = [{ label: g.wins.length ? 'New window' : 'Open', icon: 'external', run: () => ctx.act('open', { target: g.path }) }];
      if (g.pinned) items.push({ label: 'Unpin from dock', icon: 'pin', run: () => ctx.saveSettings({ pins: pins.filter((p) => 'pin:' + p.path !== key) }) });
      else items.push({ label: 'Pin to dock', icon: 'pin', run: () => ctx.saveSettings({ pins: [...pins, { path: g.path, name: base(g.path) }] }) });
      if (g.wins.length) items.push({ label: g.wins.length > 1 ? `Close all ${g.wins.length} windows` : 'Close window', icon: 'close', run: async () => { for (const w of g.wins) await ctx.act('closeWindow', { hwnd: w.hwnd }); setTimeout(() => ctx.hub.refresh('windows'), 500); } });
      items.push({ label: 'Open file location', icon: 'folder', run: () => ctx.act('reveal', { target: g.path }) });
      if (g.wins.length > 1) items.unshift(...g.wins.map((w) => ({ label: w.title.slice(0, 44), icon: 'window', run: () => ctx.act('focusWindow', { hwnd: w.hwnd }) })), { sep: true });
      return items;
    },
    on: {
      start: (ctx, el) => openStart(ctx, el),
      app: (ctx, el) => activate(ctx, findGroup(ctx, el.dataset.v)),
    },
  },
  {
    type: 'appshortcut', name: 'App Shortcut', cat: 'apps', icon: 'external', desc: 'A single app as its own tile.',
    sizes: ['s'], size: 's', topics: ['windows'], noPanel: true,
    settings: [{ key: 'path', label: 'Program', type: 'file', default: '' }],
    tile(ctx, { windows }) {
      if (!ctx.s.path) return `<div class="tin sq"><button class="ico-btn" data-a="pick" data-tip="Choose an app">${icon('plus', P(ctx, 20))}</button></div>`;
      const t = targets.get(ctx.s.path) || (targetOf(ctx, ctx.s.path), ctx.s.path);
      const wins = (windows || []).filter((w) => lc(w.exe) === lc(t));
      return `<div class="tin sq">${appButton(ctx, { key: 'x', img: iconFor(ctx, ctx.s.path), name: base(ctx.s.path), running: wins.length > 0, active: wins.some((w) => w.active), count: wins.length, action: 'go' })}</div>`;
    },
    on: {
      pick: async (ctx) => { const p = await ctx.act('pickApp'); if (p) ctx.saveSettings({ path: p }); },
      go: (ctx) => { const t = targets.get(ctx.s.path) || ctx.s.path; activate(ctx, { path: ctx.s.path, wins: (ctx.hub.peek('windows') || []).filter((w) => lc(w.exe) === lc(t)) }); },
    },
  },
  {
    type: 'launcher', name: 'App Launcher', cat: 'apps', icon: 'grid', desc: 'Every installed app from the Start menu, searchable.',
    sizes: ['s'], size: 's', topics: [], panelTopics: ['startApps'],
    tile() { return `<div class="tin sq"><span class="glyph-tile" style="background:linear-gradient(135deg,#5e5ce6,#bf5af2);color:#fff">${icon('grid')}</span></div>`; },
    panel(ctx, { startApps }) { return launcherPanel(ctx, startApps, ctx.state.q); },
    panelWidth: 420,
    on: {
      q: (ctx, el) => { ctx.state.q = el.value; ctx.rerender(true); const i = ctx.panelEl()?.querySelector('[data-input=q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
      launch: (ctx, el) => { ctx.act('open', { target: el.dataset.v }); ctx.closePanel(); },
      launchFirst: (ctx) => { const b = ctx.panelEl()?.querySelector('[data-a=launch]'); if (b) { ctx.act('open', { target: b.dataset.v }); ctx.closePanel(); } },
    },
  },
  {
    type: 'recent', name: 'Recently Opened', cat: 'apps', icon: 'file', desc: 'The files and folders you opened last.',
    sizes: ['s', 'm'], size: 's', topics: ['recent'],
    tile(ctx, { recent }) {
      const n = recent?.[0];
      if (ctx.size === 'm' && n) return `<div class="tin"><img data-icon="${esc(n.path)}" style="width:calc(30px*var(--u));height:calc(30px*var(--u))"><div class="col" style="max-width:calc(130px*var(--u));gap:calc(6px*var(--u))"><span class="t-title">${esc(n.name)}</span><span class="t-sub">Recently opened</span></div></div>`;
      return `<div class="tin sq"><span class="glyph-tile">${icon('clock')}</span></div>`;
    },
    panel(ctx, { recent }) {
      return `<div class="pn"><div class="pn-head"><h3>${icon('clock', 18)} Recently opened</h3></div><div class="pn-list">${(recent || []).map((f) => `<div class="pn-item" data-a="open" data-v="${esc(f.path)}"><img data-icon="${esc(f.path)}"><div class="grow"><b>${esc(f.name)}</b><span>${fmtDate(new Date(f.mtime), { month: 'short', day: 'numeric' })} ${fmtTimeShort(new Date(f.mtime), ctx.cfg.behavior.clock24)}}</span></div></div>`).join('') || '<div class="empty">Nothing here yet.</div>'}</div></div>`;
    },
    panelWidth: 340,
    on: { open: (ctx, el) => { ctx.act('open', { target: el.dataset.v }); ctx.closePanel(); } },
  },
  {
    type: 'folder', name: 'Folder', cat: 'apps', icon: 'folder', desc: 'A folder of your choice – click to see what is inside.',
    sizes: ['s', 'm'], size: 's', topics: [],
    settings: [{ key: 'path', label: 'Folder', type: 'folder', default: '' }, { key: 'label', label: 'Name', type: 'text', default: '' }],
    tile(ctx) {
      const name = ctx.s.label || base(ctx.s.path) || 'Folder';
      const g = `<span class="glyph-tile" style="background:linear-gradient(#ffcf5c,#f5a524);color:#7a4b00" data-tip="${esc(name)}">${icon('folder')}</span>`;
      if (ctx.size === 'm') return `<div class="tin">${g}<div class="col" style="gap:calc(6px*var(--u))"><span class="t-title">${esc(name)}</span><span class="t-sub">${ctx.s.path ? 'Folder' : 'Click to choose'}</span></div></div>`;
      return `<div class="tin sq">${g}</div>`;
    },
    async onClick(ctx) { if (!ctx.s.path) { const p = await ctx.act('pickFolder'); if (p) ctx.saveSettings({ path: p }); return true; } return false; },
    async panelLoad(ctx) { ctx.state.entries = await ctx.act('listDir', { path: ctx.s.path }).catch(() => []); },
    panel(ctx) {
      const e = ctx.state.entries;
      return `<div class="pn"><div class="pn-head"><h3>${icon('folder', 18)} ${esc(ctx.s.label || base(ctx.s.path))}</h3><button class="btn" data-a="openRoot">${icon('external', 13)} Open</button></div>
        <div class="pn-list">${e ? e.map((x) => `<div class="pn-item" data-a="open" data-v="${esc(x.path)}"><img data-icon="${esc(x.path)}"><div class="grow"><b>${esc(x.name)}</b><span>${x.dir ? 'Folder' : fmtBytes(x.size)}</span></div></div>`).join('') || '<div class="empty">Empty.</div>' : '<div class="empty">Loading…</div>'}</div></div>`;
    },
    panelWidth: 340,
    on: { open: (ctx, el) => { ctx.act('open', { target: el.dataset.v }); ctx.closePanel(); }, openRoot: (ctx) => { ctx.act('open', { target: ctx.s.path }); ctx.closePanel(); } },
  },
  {
    type: 'search', name: 'Search & Commands', cat: 'apps', icon: 'search', desc: 'Apps, commands, paths and the web – type and press Enter.',
    sizes: ['s', 'm'], size: 'm', topics: [], panelTopics: ['startApps'],
    settings: [{ key: 'engine', label: 'Search engine', type: 'select', options: [['https://www.google.com/search?q=', 'Google'], ['https://duckduckgo.com/?q=', 'DuckDuckGo'], ['https://www.bing.com/search?q=', 'Bing'], ['https://www.ecosia.org/search?q=', 'Ecosia']], default: 'https://www.google.com/search?q=' }],
    tile(ctx) {
      if (ctx.size === 's') return `<div class="tin sq"><span style="display:flex">${icon('search', P(ctx, 22))}</span></div>`;
      return `<div class="tin" style="width:calc(168px*var(--u))"><span class="dim" style="display:flex">${icon('search', P(ctx, 17))}</span><span class="t-sub" style="font-size:calc(12px*var(--fu))">Search …</span></div>`;
    },
    panel(ctx, { startApps }) {
      const res = searchResults(ctx, ctx.state.q, startApps);
      ctx.state.results = res;
      return `<div class="pn"><input class="inp" style="height:42px;font-size:15px" placeholder="Apps, commands, paths, web …" data-input="q" data-enter="go" value="${esc(ctx.state.q || '')}" autofocus>
        <div class="pn-list">${res.map((r, i) => `<div class="pn-item" data-a="run" data-v="${i}" style="${i === 0 ? 'background:var(--fill-1)' : ''}">${r.img ? `<img data-icon="${esc(r.img)}">` : `<span class="dim" style="display:flex">${icon(r.icon, 18)}</span>`}<div class="grow"><b>${esc(r.label)}</b></div>${i === 0 ? '<span class="kbd">Enter</span>' : ''}</div>`).join('') || `<div class="pn-sec"><h4>Commands</h4>${COMMANDS.slice(0, 7).map(([l, ic], i) => `<div class="pn-item" data-a="cmd" data-v="${i}"><span class="dim" style="display:flex">${icon(ic, 17)}</span><div class="grow"><b>${l}</b></div></div>`).join('')}</div>`}</div></div>`;
    },
    panelWidth: 400,
    on: {
      q: (ctx, el) => { ctx.state.q = el.value; ctx.rerender(true); const i = ctx.panelEl()?.querySelector('[data-input=q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
      go: (ctx) => { ctx.state.results?.[0]?.run(); ctx.state.q = ''; ctx.closePanel(); },
      run: (ctx, el) => { ctx.state.results?.[Number(el.dataset.v)]?.run(); ctx.state.q = ''; ctx.closePanel(); },
      cmd: (ctx, el) => { runCommand(ctx, COMMANDS[Number(el.dataset.v)][2]); ctx.closePanel(); },
    },
  },
  {
    type: 'screenshot', name: 'Screenshot', cat: 'apps', icon: 'camera', desc: 'Capture the whole screen or snip a region or window.',
    sizes: ['s'], size: 's', topics: [],
    tile(ctx) { return `<div class="tin sq"><span style="display:flex">${icon('camera', P(ctx, 22))}</span></div>`; },
    panel(ctx) {
      return `<div class="pn"><div class="pn-head"><h3>${icon('camera', 18)} Screenshot</h3></div>
        <div class="pn-grid c2"><button class="btn" data-a="full" style="height:72px;flex-direction:column">${icon('screen', 22)}Full screen</button><button class="btn" data-a="region" style="height:72px;flex-direction:column">${icon('layers', 22)}Region / window</button></div>
        ${ctx.state.last ? `<div class="pn-item" data-a="openLast"><span class="dim" style="display:flex">${icon('file', 17)}</span><div class="grow"><b>Last capture</b><span>${esc(ctx.state.last)}</span></div></div>` : '<div class="pn-muted">Full-screen captures are saved to Pictures\\Screenshots and copied to the clipboard. “Region / window” opens the Windows Snipping Tool.</div>'}</div>`;
    },
    on: {
      full: async (ctx) => { ctx.closePanel(); await new Promise((r) => setTimeout(r, 250)); const r = await ctx.act('screenshot', { mode: 'full' }); if (r?.file) { ctx.state.last = r.file; ctx.toast('Screenshot saved and copied'); } },
      region: (ctx) => { ctx.closePanel(); ctx.act('screenshot', { mode: 'region' }); },
      openLast: (ctx) => ctx.act('open', { target: ctx.state.last }),
    },
  },
  {
    type: 'quickactions', name: 'Quick Actions', cat: 'apps', icon: 'bolt', desc: 'Lock, Settings and notifications in one click.',
    sizes: ['m'], size: 'm', topics: [], noPanel: true,
    tile(ctx) {
      const s = P(ctx, 40);
      return `<div class="tin tight">${[['lock', 'lock', 'Lock'], ['settings', 'gear', 'Settings'], ['center', 'layers', 'Notifications']].map(([a, ic, tip]) => `<button class="ico-btn" data-a="${a}" data-tip="${tip}" style="width:${s}px;height:${s}px">${icon(ic, P(ctx, 19))}</button>`).join('')}</div>`;
    },
    on: { lock: (ctx) => ctx.act('lock'), settings: (ctx) => ctx.act('open', { target: 'ms-settings:' }), center: (ctx) => ctx.act('open', { target: 'ms-actioncenter:' }) },
  },
];
