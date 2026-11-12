// Settings dashboard. Every control writes straight into the config (auto-saved by the main
// process) and the dock plus the live preview update immediately.
import { DockView, DataStore } from './shared/dock-view.js';
import { Hub } from './shared/hub.js';
import { THEMES, resolveTheme } from './shared/themes.js';
import { icon, brandTile, esc, fmtBytes, ICON_NAMES } from './shared/ui.js';
import { registry, defaultsFor, CATEGORIES } from './widgets/index.js';
import { morph } from './shared/morph.js';

const api = window.prism;
// no acrylic behind the window on this Windows version (see main.js): solid background instead of translucent
if (new URLSearchParams(location.search).has('solid')) document.documentElement.classList.add('solid');
let cfg = await api.config.get();
let secretKeys = await api.secrets.keys();
const info = await api.appInfo();
const $ = (s, r = document) => r.querySelector(s);
const content = $('#content');
let section = 'overview';
let openWidget = null; // uid whose settings are expanded
let addCat = 'system';
let editCustom = null;
let renaming = null;
let preview = null; // live preview DockView, created once the page is ready

const SECTIONS = [
  ['overview', 'Overview', 'screen'], ['appearance', 'Appearance', 'sparkles'], ['layout', 'Layout', 'layers'], ['behavior', 'Behavior', 'sliders'],
  ['widgets', 'Widgets', 'grid'], ['integrations', 'Integrations', 'link'], ['performance', 'Performance', 'chart'],
  ['backup', 'Data & Backup', 'disk'], ['about', 'About', 'note'],
];
// the live preview is a second dock instance: only shown (and polling) where it helps
const PREVIEW_ON = new Set(['overview', 'appearance', 'layout']);

// ---------------- helpers ----------------
const get = (path, o = cfg) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const nest = (path, v) => path.split('.').reverse().reduce((acc, k) => ({ [k]: acc }), v);
const patchT = {};
function set(path, v, delay = 0) {
  clearTimeout(patchT[path]);
  const run = () => api.config.patch(nest(path, v)).then((c) => { cfg = c; });
  if (delay) patchT[path] = setTimeout(run, delay); else run();
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200); }
const row = (label, hint, ctl, cls = '') => `<div class="srow ${cls}"><div class="lbl"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="ctl">${ctl}</div></div>`;
const toggle = (path, label, hint) => row(label, hint, `<button class="sw ${get(path) ? 'on' : ''}" data-path="${path}" data-kind="bool" aria-label="${esc(label)}"></button>`);
const seg = (path, label, opts, hint) => row(label, hint, `<div class="seg">${opts.map(([v, l]) => `<button class="${String(get(path)) === String(v) ? 'on' : ''}" data-path="${path}" data-v="${v}" data-num="${typeof v === 'number'}">${l}</button>`).join('')}</div>`);
const fmtVal = (v, step) => (step < 1 ? Number(v).toFixed(step < 0.1 ? 2 : 1) : Math.round(v));
const rangeCtl = (attr, value, min, max, step, unit) => { const p = ((value - min) / (max - min)) * 100; return `<div class="range"><input type="range" ${attr} min="${min}" max="${max}" step="${step}" value="${value}" style="--p:${p}%" data-unit="${unit}"><output>${fmtVal(value, step)}${unit}</output></div>`; };
const range = (path, label, min, max, step = 1, unit = '', hint = '') => row(label, hint, rangeCtl(`data-path="${path}" data-kind="num"`, get(path), min, max, step, unit));
const color = (path, label) => row(label, '', `<div class="color"><input type="color" data-path="${path}" value="${get(path)}"><input class="in xs" data-path="${path}" data-kind="text" value="${get(path)}"></div>`);

// ---------------- sidebar ----------------
function renderSide() {
  $('#side').innerHTML = `<div class="brand-row"><img src="assets/icon.png" alt=""><div><b>PrismDock</b><span>Version ${esc(info.version)}</span></div></div>
    ${SECTIONS.map(([k, l, ic]) => `<button class="nav ${section === k ? 'on' : ''}" data-sec="${k}">${icon(ic, 16)}${l}</button>`).join('')}
    <div class="spacer"></div><div class="foot">Everything is stored on this PC.<br>No accounts, no telemetry.</div>`;
}

// ---------------- sections ----------------
const R = {};

R.overview = () => {
  const active = (cfg.profiles || []).find((p) => p.id === cfg.activeProfile);
  const docks = (displays || []).filter((m) => m.active).length;
  const qa = (attr, ic, t, sub) => `<button class="qa" ${attr}><span class="qi">${icon(ic, 16)}</span><span><b>${t}</b><small>${sub}</small></span></button>`;
  return `<h1>Overview</h1><p class="lead">Your dock at a glance. Changes apply instantly to the real dock and the preview above.</p>
    <div class="card stats"><div><b>${docks || '–'}</b><span>Displays with a dock</span></div><div><b>${cfg.widgets.filter((w) => w.enabled).length}</b><span>Widgets on “${esc(active?.name || 'Default')}”</span></div><div><b>${esc(THEMES[cfg.appearance.theme]?.label || 'Custom')}</b><span>Style</span></div><div><b id="ovMem">…</b><span>PrismDock memory</span></div></div>
    <h2>Quick actions</h2><div class="ov-grid">
      ${qa('data-do="editor"', 'edit', 'Edit layout', 'Arrange widgets on the dock')}
      ${qa('data-sec="widgets"', 'plus', 'Add widgets', `${reg.size} widgets in ${CATEGORIES.length} categories`)}
      ${qa('data-sec="appearance"', 'sparkles', 'Change style', 'Glass, colours, corners')}
      ${qa('data-sec="integrations"', 'link', 'Connect services', 'Spotify, GitHub, calendars …')}
      ${qa('data-sec="behavior"', 'screen', 'Displays & taskbar', 'Docks per monitor, hover mode')}
      ${qa('data-do="export"', 'external', 'Back up', 'Export settings to a file')}</div>
    <h2>Essentials</h2><div class="card">${toggle('behavior.hideTaskbar', 'Replace the Windows taskbar', 'Restored automatically when PrismDock quits or crashes.')}${toggle('performance.powerSaver', 'Power saver', 'Longer update intervals and a lighter glass.')}${toggle('behavior.startWithWindows', 'Start with Windows')}</div>`;
};

R.appearance = () => {
  const wp = wallpaperUrl ? `background-image:url('${wallpaperUrl}')` : 'background:linear-gradient(135deg,#3a2a6b,#1f6f8b)';
  const card = (k, t) => `<button class="theme ${cfg.appearance.theme === k ? 'on' : ''}" data-theme="${k}"><span class="sample" style="${wp}"><i style="background:color-mix(in srgb, ${t.tint} ${Math.round(t.tintOpacity * 100)}%, rgba(80,80,90,.35));border:1px solid color-mix(in srgb, ${t.border} ${Math.round(t.borderOpacity * 100 + 10)}%, transparent);backdrop-filter:blur(${Math.round(t.blur / 3)}px) saturate(${t.saturation})"><b style="background:${t.accent}"></b><b style="background:${t.text};opacity:.8"></b><b style="background:${t.text};opacity:.4"></b></i></span>${t.label}</button>`;
  const c = 'appearance.custom';
  return `<h1>Appearance</h1><p class="lead">Style, glass and the finer details of the bar. Everything applies instantly – the live preview above and the real dock update together.</p>
    <h2>Style</h2><div class="themes">${Object.entries(THEMES).map(([k, t]) => card(k, t)).join('')}${card('custom', { ...cfg.appearance.custom, label: 'Custom' })}</div>
    ${cfg.appearance.theme === 'custom' ? `<h2>Custom theme</h2>
      <div class="card">${color(c + '.tint', 'Glass color')}${range(c + '.tintOpacity', 'Glass opacity', 0, 1, 0.01)}${range(c + '.blur', 'Blur', 0, 60, 1, ' px')}${range(c + '.saturation', 'Saturation', 0.5, 2.5, 0.05, '×')}${range(c + '.brightness', 'Brightness', 0.6, 1.4, 0.01, '×')}</div>
      <div class="card">${range(c + '.refraction', 'Edge refraction', 0, 1.5, 0.01, '', 'How strongly the edge bends the background like a lens.')}${range(c + '.chroma', 'Chromatic dispersion', 0, 1, 0.01, '', 'Colour fringes at the edge, like real glass.')}${range(c + '.specular', 'Highlights & hover light', 0, 1.5, 0.01)}${range(c + '.rim', 'Rim light', 0, 1.5, 0.01)}</div>
      <div class="card">${range(c + '.radius', 'Bar corner radius', 0, 40, 1, ' px')}${range(c + '.tileRadius', 'Widget corner radius', 0, 32, 1, ' px')}${color(c + '.border', 'Border color')}${range(c + '.borderOpacity', 'Border opacity', 0, 0.6, 0.01)}${range(c + '.shadow', 'Shadow', 0, 1, 0.01)}</div>
      <div class="card">${color(c + '.tile', 'Widget background')}${range(c + '.tileOpacity', 'Widget opacity', 0, 1, 0.01)}${color(c + '.text', 'Text color')}${color(c + '.accent', 'Accent color')}</div>`
    : `<div class="card" style="margin-top:12px">${row('Custom theme', 'Uses the selected style as a starting point; afterwards every value can be changed.', `<button class="b" data-do="toCustom">${icon('sparkles', 14)} Customize this style</button>`)}</div>`}
    <h2>Glass</h2><div class="card">${seg('appearance.glassEngine', 'Glass engine', [['wallpaper', 'Liquid glass'], ['flat', 'Flat']], 'Liquid glass refracts and blurs your desktop wallpaper in real time (WebGL). Flat saves a little GPU.')}</div>
    <h2>Motion & size</h2><div class="card">${toggle('appearance.animations', 'Animations', 'Short fades for panels, menus and tooltips. Off: everything appears instantly.')}${range('appearance.animSpeed', 'Animation duration', 0.4, 2, 0.05, '×', 'Lower is faster.')}${range('appearance.iconSize', 'Icon size', 24, 48, 1, ' px', 'At the default height icons render at 75 % of this value.')}${range('appearance.fontScale', 'Text size', 0.8, 1.3, 0.01, '×')}</div>`;
};

R.layout = () => {
  const profiles = cfg.profiles || [];
  return `<h1>Layout</h1><p class="lead">Save several layouts and switch between them. Arranging widgets happens in the <b>Layout Editor</b> on the dock itself – outside the editor the bar is locked, so nothing moves by accident.</p>
  <div class="card"><div class="srow"><div class="lbl"><b>Layout Editor</b><small>Drag widgets into place, set their size, add and remove widgets, adjust spacing and alignment – with the real dock as the live preview.</small></div><div class="ctl"><button class="b primary" data-do="editor">${icon('edit', 14)} Open Layout Editor</button></div></div></div>
  <h2>Saved layouts</h2><div class="card">${profiles.map((p) => `<div class="srow"><span class="lay-dot ${p.id === cfg.activeProfile ? 'on' : ''}"></span><div class="lbl">${renaming === p.id ? `<input class="in" data-rename="${esc(p.id)}" value="${esc(p.name)}" autofocus>` : `<b>${esc(p.name)}</b>`}<small>${p.widgets.filter((w) => w.enabled).length} widgets · ${p.layout.mode === 'full' ? 'full width' : 'floating pill'} · ${p.layout.edge} · height ${p.layout.size === 'custom' ? p.layout.height + ' px' : p.layout.size}</small></div>
    <div class="ctl">${p.id === cfg.activeProfile ? '<span class="ok">Active</span>' : `<button class="b sm" data-layout="switch" data-v="${esc(p.id)}">Use</button>`}${renaming === p.id ? `<button class="b sm" data-layout="renameOk" data-v="${esc(p.id)}">Save</button>` : `<button class="b icon sm" data-layout="rename" data-v="${esc(p.id)}" title="Rename">${icon('edit', 12)}</button>`}<button class="b icon sm danger" data-layout="delete" data-v="${esc(p.id)}" title="Delete" ${profiles.length <= 1 ? 'disabled' : ''}>${icon('trash', 12)}</button></div></div>`).join('')}
    <div class="srow"><div class="lbl"><b>New layout</b><small>Starts as a copy of the active layout, or from the defaults.</small></div><div class="ctl"><button class="b" data-layout="create">${icon('copy', 14)} Copy current</button><button class="b" data-layout="createBlank">${icon('plus', 14)} From defaults</button></div></div></div>
  <h2>Position & shape</h2><div class="card">${seg('layout.edge', 'Position', [['bottom', 'Bottom'], ['top', 'Top']])}${seg('layout.mode', 'Shape', [['pill', 'Floating pill'], ['full', 'Full width']], 'In full-width mode the “Spacer” widget splits the bar into left and right groups.')}
  ${seg('layout.align', 'Alignment', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])}${range('layout.offsetX', 'Horizontal offset', -900, 900, 1, ' px', 'Floating pill, centered only.')}</div>
  <h2>Size</h2><div class="card">${seg('layout.size', 'Height', [['S', 'S · 46 px'], ['M', 'M · 54 px'], ['L', 'L · 64 px'], ['custom', 'Custom']])}${cfg.layout.size === 'custom' ? range('layout.height', 'Custom height', 40, 96, 1, ' px') : ''}${range('layout.maxWidth', 'Maximum width (pill)', 0, 3000, 10, ' px', '0 = fit the content. Overflowing widgets scroll.')}</div>
  <h2>Spacing</h2><div class="card">${range('layout.margin', 'Distance to screen edge', 0, 40, 1, ' px')}${range('layout.padding', 'Inner padding', 0, 12, 1, ' px')}${range('layout.gap', 'Widget spacing', 0, 16, 1, ' px')}</div>
  <div class="card" style="margin-top:12px">${row('Reset layout', 'Restores the default widgets, size and spacing of the active layout.', `<button class="b danger" data-reset="layout">${icon('refresh', 14)} Reset</button>`)}</div>`;
};

let displays = null;
const ahOn = (k) => { const per = cfg.behavior.autohidePer || {}; return k in per ? !!per[k] : !!cfg.behavior.autohide; };
const loadDisplays = () => api.dock.list().then((l) => { displays = l; if (section === 'behavior') go('behavior'); });
loadDisplays();
R.behavior = () => `<h1>Behavior</h1><p class="lead">How the bar reacts.</p>
  <h2>Windows taskbar</h2><div class="card">${toggle('behavior.hideTaskbar', 'Replace the Windows taskbar', 'Hides the taskbar while PrismDock runs and switches it to auto-hide, so Windows releases its space. The original setting is saved first and restored when PrismDock quits – also after a crash.')}
  ${toggle('behavior.reserveSpace', 'Reserve screen space', 'Maximized windows end above the dock instead of underneath it (Windows AppBar).')}
  ${seg('behavior.monitors', 'Displays', [['all', 'All displays'], ['primary', 'Main display'], ['custom', 'Selected']], 'Each display with a dock gets its own bar and its Windows taskbar is replaced; displays without a dock keep their taskbar. Windows has one auto-hide setting for all taskbars, so while the taskbar is replaced, those taskbars hide until you point at them.')}
  ${cfg.behavior.monitors === 'custom' ? `<div class="srow col"><div class="lbl"><b>Displays with a dock</b><small>Click to toggle. If none is selected the main display is used.</small></div><div class="mons">${(displays || []).map((m) => `<button class="mon ${(cfg.behavior.monitorList || []).includes(m.key) ? 'on' : ''}" data-mon="${esc(m.key)}"><b>${esc(m.label)}${m.primary ? ' · main' : ''}</b><small>${m.width}×${m.height} · ${m.scale}%</small></button>`).join('')}</div></div>` : ''}
  ${toggle('behavior.fullscreenHide', 'Hide for full-screen apps', 'Games and videos in full screen get the whole display; the dock returns afterwards.')}</div>
  <h2>Show only on hover</h2><div class="card">${(displays || []).map((m) => row(`${esc(m.label)}${m.primary ? ' · main' : ''}`, m.active ? 'The dock slides away when the pointer leaves and returns when you touch the screen edge. While hidden it reserves no screen space.' : 'No dock on this display (see Displays above).', `<button class="sw ${ahOn(m.key) ? 'on' : ''}" data-ah="${esc(m.key)}" aria-label="Show only on hover: ${esc(m.label)}" ${m.active ? '' : 'disabled'}></button>`)).join('')}${range('behavior.autohideDelay', 'Hide after', 100, 3000, 50, ' ms')}</div>
  <h2>Pointer</h2><div class="card">${seg('behavior.hoverEffect', 'Hover effect', [['lift', 'Highlight'], ['none', 'Off']])}${seg('behavior.openOn', 'Open widget panels on', [['click', 'Click'], ['hover', 'Hover']])}${toggle('behavior.closeOnBlur', 'Close panels when clicking elsewhere')}</div>
  <h2>Clock</h2><div class="card">${toggle('behavior.clock24', '24-hour clock')}</div>
  <h2>Startup</h2><div class="card">${toggle('behavior.startWithWindows', 'Start with Windows', info.packaged ? '' : 'Takes effect in the installed app (disabled while running from source).')}</div>`;

// ----- widgets -----
let reg = registry(cfg);
const defOf = (type) => reg.get(type) || (type === 'spacer' ? { type, name: 'Spacer', icon: 'minus', sizes: ['m'], size: 'm', desc: 'Flexible space', cat: 'apps' } : null);
const wIcon = (d) => (d?.brand ? brandTile(d.brand, 26) : icon(d?.icon || 'grid', 18));

function widgetSettingsForm(w, d) {
  const s = { ...defaultsFor(d), ...(w.settings || {}) };
  const fields = (d.settings || []).map((f) => {
    const a = `data-wset="${w.uid}|${f.key}"`;
    const v = s[f.key];
    if (f.type === 'toggle') return row(f.label, '', `<button class="sw ${v ? 'on' : ''}" ${a} data-kind="bool"></button>`);
    if (f.type === 'select') return row(f.label, '', `<select class="in sm" ${a}>${f.options.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    if (f.type === 'number') return row(f.label, '', `<input class="in xs" type="number" ${a} data-kind="num" min="${f.min ?? ''}" max="${f.max ?? ''}" value="${v ?? ''}">`);
    if (f.type === 'color') return row(f.label, '', `<div class="color"><input type="color" ${a} value="${v}"></div>`);
    if (f.type === 'file' || f.type === 'folder') return row(f.label, esc(v || 'Not set'), `<button class="b" data-pick="${f.type}" data-target="${w.uid}|${f.key}">${icon(f.type === 'file' ? 'file' : 'folder', 14)} Choose…</button>`);
    if (f.type === 'pins') return `<div class="srow col"><div class="lbl"><b>${f.label}</b><small>Reorder with ↑ ↓. Pinned apps show a dot while they run.</small></div><div class="pins">${(v || []).map((p, i) => `<div class="pin"><img data-icon="${esc(p.path)}" alt=""><span>${esc(p.name)}</span><button class="b icon sm" data-pinmove="${w.uid}|${i}|-1" title="Move up">↑</button><button class="b icon sm" data-pinmove="${w.uid}|${i}|1" title="Move down">↓</button><button class="b icon sm danger" data-pindel="${w.uid}|${i}" title="Unpin">${icon('close', 12)}</button></div>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:8px"><select class="in" data-pinstart="${w.uid}"><option value="">Pin from the Start menu …</option>${(startApps || []).map((x) => `<option value="${esc(x.path)}">${esc(x.name)}</option>`).join('')}</select><button class="b" data-pinfile="${w.uid}">${icon('plus', 14)} Choose program</button></div></div>`;
    return row(f.label, '', `<input class="in" ${a} data-kind="text" value="${esc(v ?? '')}">`);
  });
  return `<div class="wset">${fields.join('') || '<div class="muted" style="padding:10px 0">This widget has no settings of its own.</div>'}</div>`;
}

let startApps = null;
api.startApps().then((a) => { startApps = a; if (section === 'widgets' && openWidget) render(); });

R.widgets = () => {
  reg = registry(cfg);
  const list = cfg.widgets;
  const sizes = { s: 'S', m: 'M', l: 'L' };
  const cats = Object.fromEntries(CATEGORIES);
  const defs = [...reg.values()].filter((d) => d.cat === addCat);
  const active = (cfg.profiles || []).find((p) => p.id === cfg.activeProfile);
  return `<h1>Widgets</h1><p class="lead">Add, remove, reorder (drag the handle), choose sizes, show or hide, and configure each widget. These lists belong to the active layout “${esc(active?.name || 'Default')}”.</p>
    <div class="card" style="margin-bottom:12px">${row('Arrange on the dock', 'The Layout Editor lets you drag widgets directly on the bar.', `<button class="b primary" data-do="editor">${icon('edit', 14)} Open Layout Editor</button>`)}</div>
    <h2>On the dock · ${list.length}</h2><div class="card wl" id="wl">${list.map((w, i) => {
      const d = defOf(w.type);
      if (!d) return `<div class="wrow off" data-uid="${w.uid}"><span class="grip">${icon('drag', 16)}</span><span class="wic">${icon('close', 16)}</span><div class="wname"><b>Unknown (${esc(w.type)})</b><small>This widget type no longer exists</small></div><button class="b icon danger" data-wdel="${w.uid}" title="Remove">${icon('trash', 14)}</button></div>`;
      const sz = w.size && w.size !== 'auto' ? w.size : d.size;
      return `<div class="wrow ${w.enabled ? '' : 'off'}" data-uid="${w.uid}" draggable="true"><span class="grip" title="Drag to reorder">${icon('drag', 16)}</span><span class="wpos">${i + 1}</span><span class="wic">${wIcon(d)}</span>
        <div class="wname"><b>${esc(d.name)}</b><small>${esc(cats[d.cat] || '')} · ${esc(d.desc || '')}</small></div>
        ${d.sizes.length > 1 ? `<div class="seg">${d.sizes.map((s) => `<button class="${sz === s ? 'on' : ''}" data-wsize="${w.uid}|${s}">${sizes[s]}</button>`).join('')}</div>` : ''}
        <button class="sw ${w.enabled ? 'on' : ''}" data-wtoggle="${w.uid}" title="${w.enabled ? 'Shown' : 'Hidden'}"></button>
        <button class="b icon" data-wopen="${w.uid}" title="Settings">${icon(openWidget === w.uid ? 'chevronUp' : 'gear', 14)}</button>
        <button class="b icon danger" data-wdel="${w.uid}" title="Remove">${icon('trash', 14)}</button></div>${openWidget === w.uid ? widgetSettingsForm(w, d) : ''}`;
    }).join('') || '<div class="srow"><span class="muted">The dock is empty.</span></div>'}</div>
    <h2>Add widgets</h2><div class="chips">${CATEGORIES.map(([k, l]) => `<button class="${addCat === k ? 'on' : ''}" data-addcat="${k}">${l}</button>`).join('')}</div>
    <div class="cat-grid">${defs.map((d) => `<button class="wcard" data-add="${esc(d.type)}"><span class="wic">${wIcon(d)}</span><span><b>${esc(d.name)}</b><small>${esc(d.desc)}</small></span></button>`).join('')}${addCat === 'apps' ? `<button class="wcard" data-add="spacer"><span class="wic">${icon('minus', 18)}</span><span><b>Spacer</b><small>Flexible space to split the bar into groups in full-width mode.</small></span></button>` : ''}</div>
    <h2 id="custom">Custom widgets</h2><div class="card">${(cfg.customWidgets || []).map((c) => `<div class="srow"><span class="wic" style="background:${esc(c.color)};color:#fff">${c.emoji ? esc(c.emoji) : icon(c.icon || 'sparkles', 17)}</span><div class="lbl"><b>${esc(c.name)}</b><small>${c.kind === 'json' ? 'JSON value · ' + esc(c.url) : c.kind === 'link' ? 'Link · ' + esc(c.target) : 'Text'}</small></div><div class="ctl"><button class="b" data-cadd="${c.id}">${icon('plus', 14)} Add to dock</button><button class="b icon" data-cedit="${c.id}" title="Edit">${icon('gear', 14)}</button><button class="b icon danger" data-cdel="${c.id}" title="Delete">${icon('trash', 14)}</button></div></div>${editCustom === c.id ? customForm(c) : ''}`).join('')}
      <div class="srow"><div class="lbl"><b>New custom widget</b><small>A link or app launcher, a value from any JSON API (e.g. Home Assistant, your own server) or a text label.</small></div><div class="ctl"><button class="b primary" data-cnew>${icon('plus', 14)} Create</button></div></div></div>`;
};
function customForm(c) {
  const f = (k, l, ph = '') => row(l, '', `<input class="in" data-cfield="${c.id}|${k}" value="${esc(c[k] ?? '')}" placeholder="${esc(ph)}">`);
  return `<div class="wset">${row('Type', '', `<div class="seg">${[['json', 'JSON value'], ['link', 'Link / app'], ['text', 'Text']].map(([k, l]) => `<button class="${c.kind === k ? 'on' : ''}" data-ckind="${c.id}|${k}">${l}</button>`).join('')}</div>`)}
    ${f('name', 'Name')}${c.kind === 'json' ? f('url', 'JSON URL', 'https://api.example.com/stats') + f('path', 'Path to the value', 'data.count  or  items.0.value') + f('label', 'Label') + f('prefix', 'Prefix', '$ ') + f('suffix', 'Suffix', ' visitors') : ''}
    ${c.kind === 'link' ? f('target', 'Target (URL, program or folder)', 'https://… or C:\\Program Files\\…') + f('text', 'Subtitle') : ''}${c.kind === 'text' ? f('text', 'Text') : ''}
    ${f('emoji', 'Emoji (optional)', '🚀')}${row('Icon', '', `<select class="in sm" data-cfield="${c.id}|icon">${ICON_NAMES.map((n) => `<option ${n === c.icon ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}${row('Color', '', `<div class="color"><input type="color" data-cfield="${c.id}|color" value="${esc(c.color || '#0a84ff')}"></div>`)}</div>`;
}

// ----- integrations -----
const INTEGRATIONS = [
  { id: 'weather', name: 'Weather', ic: 'cloud', desc: 'Open-Meteo – free, no key needed.', custom: 'weather' },
  { id: 'calendar', name: 'Google / Outlook / iCloud Calendar', brand: 'google', desc: 'Via a private iCal link, no sign-in.', fields: [{ path: 'integrations.calendarIcs.url', label: 'iCal link (.ics)', ph: 'https://calendar.google.com/calendar/ical/…/basic.ics' }], help: 'Google: Calendar settings → your calendar → “Secret address in iCal format”. Outlook: Settings → Shared calendars → Publish a calendar → ICS link.' },
  { id: 'github', name: 'GitHub', brand: 'github', desc: 'Notifications, PRs, stars, contributions.', fields: [{ secret: 'github.token', label: 'Personal access token' }], help: 'github.com/settings/tokens → classic token with “notifications”, “read:user” and “repo” (for private repos).' },
  { id: 'leetcode', name: 'LeetCode', brand: 'leetcode', desc: 'Public profile – no key needed.', fields: [{ path: 'integrations.leetcode.user', label: 'Username' }] },
  { id: 'linear', name: 'Linear', brand: 'linear', desc: 'Issues assigned to you.', fields: [{ secret: 'linear.key', label: 'Personal API key' }], help: 'Linear → Settings → Security & access → Personal API keys.' },
  { id: 'supabase', name: 'Supabase', brand: 'supabase', desc: 'Project health and API requests.', fields: [{ secret: 'supabase.token', label: 'Access token' }, { path: 'integrations.supabase.projectRef', label: 'Project ref', ph: 'abcdefghijklmnop' }], help: 'supabase.com/dashboard/account/tokens. The ref is part of your project URL.' },
  { id: 'youtube', name: 'YouTube', brand: 'youtube', desc: 'Subscribers, views, videos.', fields: [{ secret: 'youtube.key', label: 'YouTube Data API v3 key' }, { path: 'integrations.youtube.channelId', label: 'Channel ID', ph: 'UC…' }], help: 'console.cloud.google.com → APIs → enable YouTube Data API v3 → create an API key.' },
  { id: 'instagram', name: 'Instagram', brand: 'instagram', desc: 'Followers (Business or Creator account).', fields: [{ secret: 'instagram.token', label: 'Instagram Graph API token' }], help: 'Meta for Developers → app with “Instagram API with Instagram Login” → generate a user token.' },
  { id: 'tiktok', name: 'TikTok', brand: 'tiktok', desc: 'Followers, likes, videos.', fields: [{ secret: 'tiktok.token', label: 'Display API user token (user.info.stats)' }], help: 'developers.tiktok.com → app with Login Kit and the user.info.stats scope. TikTok user tokens expire after 24 hours: paste a new one when the widget shows “not connected”.' },
  { id: 'x', name: 'X', brand: 'x', desc: 'Followers on your account.', fields: [{ secret: 'x.token', label: 'Bearer token' }, { path: 'integrations.x.user', label: 'Username (without @)' }], help: 'developer.x.com – read access requires a paid API plan.' },
  { id: 'stripe', name: 'Stripe', brand: 'stripe', desc: 'Net revenue, 30 days.', fields: [{ secret: 'stripe.key', label: 'Restricted key (rk_live_…)' }], help: 'Dashboard → Developers → API keys → restricted key with read access to “Balance”.' },
  { id: 'paypal', name: 'PayPal', brand: 'paypal', desc: 'Incoming payments, 30 days.', fields: [{ path: 'integrations.paypal.clientId', label: 'Client ID' }, { secret: 'paypal.secret', label: 'Secret' }, { toggle: 'integrations.paypal.sandbox', label: 'Sandbox' }], help: 'developer.paypal.com → Apps & Credentials → REST app with “Transaction Search”.' },
  { id: 'shopify', name: 'Shopify', brand: 'shopify', desc: 'Net sales, 30 days.', fields: [{ path: 'integrations.shopify.domain', label: 'Shop domain', ph: 'my-shop.myshopify.com' }, { secret: 'shopify.token', label: 'Admin API access token (read_orders)' }], help: 'Shopify admin → Apps → Develop apps → Admin API scope read_orders → install.' },
  { id: 'deepseek', name: 'DeepSeek', brand: 'deepseek', desc: 'API balance.', fields: [{ secret: 'deepseek.key', label: 'API key' }] },
  { id: 'spotify', name: 'Spotify', brand: 'spotify', desc: 'Playlist, up next and precise seeking.', custom: 'spotify', info: 'Playback, cover art, skip and seeking work without signing in (Windows media session). Signing in adds the playlist or album you are listening to and the next tracks.' },
  { id: 'ai', name: 'AI usage', brand: 'claude', desc: 'Local, no key.', info: 'Claude: real token counts from your local Claude Code logs (~/.claude). ChatGPT/Codex: limits from the local Codex CLI logs (~/.codex). Gemini, Cursor and Grok have no public limit API – those tiles show labelled sample data.' },
];
const results = {};
let spotifyState = null; let spotifyRedirect = 'http://127.0.0.1:43117/callback';
api.act('spotifyRedirect').then((r) => { spotifyRedirect = r; }).catch(() => {});
function spotifyCard() {
  const cid = cfg.integrations.spotify?.clientId || '';
  const st = spotifyState;
  return `<label>Client ID<input class="in" data-path="integrations.spotify.clientId" data-kind="text" value="${esc(cid)}" placeholder="from developer.spotify.com/dashboard"></label>
    <div style="display:flex;gap:8px;align-items:center">${st?.connected ? `<span class="ok">✓ Connected${st.device ? ' · ' + esc(st.device) : ''}</span><span style="flex:1"></span><button class="b sm danger" data-do="spotifyOff">Disconnect</button>` : `<button class="b primary sm" data-do="spotifyOn" ${cid ? '' : 'disabled'}>Connect Spotify</button>${st?.error ? `<span class="bad">${esc(st.error)}</span>` : ''}`}</div>
    <div class="help">1. developer.spotify.com/dashboard → Create app (Web API).<br>2. Add the redirect URI <b>${esc(spotifyRedirect)}</b> and save.<br>3. Paste the app’s Client ID above and press Connect – the sign-in opens in your browser. No password or secret is stored here; the refresh token is encrypted with Windows DPAPI.</div>`;
}
R.integrations = () => {
  if (spotifyState === null) { spotifyState = undefined; api.integration('spotify', { refresh: true }).then((r) => { spotifyState = r; if (section === 'integrations') go('integrations'); }); }
  const field = (f) => {
    if (f.secret) { const has = secretKeys.includes(f.secret); return `<label>${f.label} ${has ? '<span class="ok">· saved (encrypted)</span>' : ''}<div style="display:flex;gap:6px"><input class="in" type="password" data-secret="${f.secret}" placeholder="${has ? '•••••••••••• (enter a new value to replace)' : 'Paste …'}"><button class="b" data-savesecret="${f.secret}">Save</button>${has ? `<button class="b icon danger" data-delsecret="${f.secret}" title="Remove">${icon('trash', 13)}</button>` : ''}</div></label>`; }
    if (f.toggle) return `<label style="flex-direction:row;align-items:center;justify-content:space-between">${f.label}<button class="sw ${get(f.toggle) ? 'on' : ''}" data-path="${f.toggle}" data-kind="bool"></button></label>`;
    return `<label>${f.label}<input class="in" data-path="${f.path}" data-kind="text" value="${esc(get(f.path) ?? '')}" placeholder="${esc(f.ph || '')}"></label>`;
  };
  const w = cfg.integrations.weather;
  const card = (it) => `<div class="card int"><div class="ih">${it.brand ? brandTile(it.brand, 34) : `<span class="brand" style="width:34px;height:34px;background:#0a84ff;color:#fff">${icon(it.ic, 18)}</span>`}<div><b>${it.name}</b><small>${it.desc}</small></div>${it.fields || it.custom ? `<button class="b sm st" data-test="${it.id}">Test</button>` : ''}</div>
    ${it.custom === 'spotify' ? spotifyCard() : ''}
    ${it.custom === 'weather' ? `<label>City<div style="display:flex;gap:6px"><input class="in" id="citySearch" value="${esc(w.city)}"><button class="b" data-do="geocode">${icon('search', 13)} Search</button></div></label><div id="cityResults" style="display:flex;flex-wrap:wrap;gap:6px"></div><div class="muted">${w.lat.toFixed(3)}, ${w.lon.toFixed(3)}</div>${seg('integrations.weather.unit', 'Units', [['celsius', '°C'], ['fahrenheit', '°F']]).replace('class="srow', 'style="padding:0;min-height:0;border:0" class="srow')}` : ''}
    ${(it.fields || []).map(field).join('')}${it.info ? `<div class="help">${it.info}</div>` : ''}${it.help ? `<div class="help">${it.help}</div>` : ''}${results[it.id] ? `<div class="result">${results[it.id]}</div>` : ''}</div>`;
  return `<h1>Integrations</h1><p class="lead">Every integration talks directly from this PC to its own service. Keys are encrypted with Windows DPAPI, stored only here, never exported and used only for their service. Without a connection, tiles show clearly labelled sample data.</p>
    <div class="int-grid">${INTEGRATIONS.map(card).join('')}</div>
    <h2>Goals</h2><div class="card">${range('integrations.revenueGoal', 'Monthly revenue goal', 0, 100000, 100, '', 'Used by the Revenue Dashboard.')}</div>`;
};

R.performance = () => `<h1>Performance</h1><p class="lead">PrismDock only queries data that a widget on the dock currently needs, pauses while the dock is hidden and redraws the glass only when its shape changes.</p>
  <div class="card stats" id="meters"><div><b>…</b><span>Memory</span></div><div><b>…</b><span>CPU</span></div><div><b>…</b><span>Processes</span></div><div><b>…</b><span>System helper</span></div></div>
  <h2>Mode</h2><div class="card">${toggle('performance.powerSaver', 'Power saver', 'All intervals 2.5× longer and no sheen in the glass.')}${toggle('performance.screenTime', 'Track screen time', 'Checks the foreground app every 5 s (stored only on this PC, 30 days).')}</div>
  <h2>Update intervals</h2><div class="card">${range('performance.intervals.system', 'CPU / RAM / GPU', 500, 10000, 100, ' ms')}${range('performance.intervals.network', 'Network', 500, 10000, 100, ' ms')}${range('performance.intervals.media', 'Media', 500, 10000, 100, ' ms')}${range('performance.intervals.windows', 'Open windows', 500, 10000, 100, ' ms')}${range('performance.intervals.weather', 'Weather', 300, 7200, 60, ' s')}${range('performance.intervals.online', 'Online services', 60, 3600, 30, ' s')}</div>
  <h2>Background processes</h2><div class="card"><div class="srow col" id="procs"><span class="muted">…</span></div></div>`;

R.backup = () => `<h1>Data & Backup</h1><p class="lead">Configuration (layouts, themes, widgets, custom widgets) and widget content (to-dos, notes, events) in one JSON file. API keys are never exported.</p>
  <div class="card">${row('Export', 'Saves everything to a .json file.', `<button class="b primary" data-do="export">${icon('external', 14)} Export…</button>`)}${row('Import', 'Replaces the current configuration.', `<button class="b" data-do="import">${icon('folder', 14)} Import…</button>`)}${row('Storage location', esc(info.userData), `<button class="b" data-do="openData">Open folder</button>`)}</div>
  <h2>Reset</h2><div class="card">${[['appearance', 'Appearance'], ['layout', 'Active layout (widgets, size, spacing)'], ['behavior', 'Behavior'], ['performance', 'Performance']].map(([k, l]) => row(l, '', `<button class="b" data-reset="${k}">Restore defaults</button>`)).join('')}${row('Everything', 'Resets the entire configuration. Saved layouts, widget content and keys are kept.', `<button class="b danger" data-reset="all">Reset everything</button>`)}</div>`;

R.about = () => `<h1>PrismDock</h1><p class="lead">Your private liquid-glass dock for Windows. An independent implementation with its own name, icons and glass engine.</p>
  <div class="card kv"><span>Version</span><span>${esc(info.version)}</span><span>Electron</span><span>${esc(info.electron)}</span><span>Data</span><span>${esc(info.userData)}</span><span>Mode</span><span>${info.packaged ? 'Installed' : 'Development'}</span></div>
  <h2>Using the dock</h2><div class="card"><ul class="lim"><li><b>Click</b> a widget to open its panel, <b>right-click</b> for the context menu (size, settings, style, position, layouts).</li><li><b>Edit layout…</b> in the context menu opens the Layout Editor. Only there can widgets be dragged, resized, added or removed, and the bar itself be moved.</li><li>The <b>Start</b> widget opens the Windows Start menu. <b>Scroll</b> over Volume to change it. <b>Esc</b> closes panels and the editor.</li><li>Tray icon: Settings, Edit layout, show/hide dock, quit.</li></ul></div>
  <h2>Known limits</h2><div class="card"><ul class="lim">
    <li><b>Glass:</b> Windows does not let apps read other windows’ pixels live. The liquid-glass engine therefore refracts your <b>desktop wallpaper</b>. Windows moved underneath the floating dock do not appear in the glass.</li>
    <li><b>Taskbar:</b> Explorer re-shows the taskbar on some events (Start menu, Explorer restart, display changes). PrismDock reacts to the window event itself and hides it before it is drawn. During an Explorer restart the dock is briefly gone.</li>
    <li><b>Temperatures:</b> without kernel drivers Windows only exposes ACPI thermal zones; GPU temperature on NVIDIA only (nvidia-smi).</li>
    <li><b>Brightness:</b> works on laptop panels and DDC/CI-capable monitors.</li>
    <li><b>AI limits:</b> Claude (tokens from Claude Code logs) and Codex (limits from CLI logs) are real. Gemini, Cursor and Grok have no public limit API → labelled sample data.</li>
    <li><b>Social & finance:</b> real as soon as you add a key; X requires paid API access.</li></ul></div>`;

// ---------------- render ----------------
function render() {
  renderSide();
  // same page: patch the DOM (keeps scroll, focus and images); new page: build it fresh
  if (render.same) morph(content, (R[section] || R.overview)()); else content.innerHTML = (R[section] || R.overview)();
  hydrateIcons(content);
  const pvOn = PREVIEW_ON.has(section);
  $('.preview-wrap').hidden = !pvOn; document.body.classList.toggle('no-preview', !pvOn);
  if (preview) { preview.hub.setPaused(!pvOn); if (pvOn) fitPreview(); }
  if (section === 'performance' || section === 'overview') startMeters(); else stopMeters();
  if (renaming) setTimeout(() => { const i = content.querySelector('[data-rename]'); i?.focus(); i?.select(); }, 20);
}
function go(sec, opts = {}) {
  if (sec.startsWith('widget:')) { openWidget = sec.slice(7); sec = 'widgets'; }
  if (sec === 'custom') { sec = 'widgets'; setTimeout(() => $('#custom')?.scrollIntoView(), 50); }
  render.same = sec === section && !opts.top;
  section = sec;
  render();
  if (!render.same) content.scrollTop = 0;
  if (openWidget && sec === 'widgets' && opts.top) setTimeout(() => content.querySelector(`.wrow[data-uid="${openWidget}"]`)?.scrollIntoView({ block: 'center' }), 50);
}
const icons = new Map();
function hydrateIcons(root) {
  for (const img of root.querySelectorAll('img[data-icon]')) {
    const p = img.dataset.icon; if (icons.has(p)) { if (icons.get(p)) img.src = icons.get(p); continue; }
    api.icon(p, 48).then((u) => { icons.set(p, u); if (u) for (const i of content.querySelectorAll('img[data-icon]')) if (i.dataset.icon === p) i.src = u; });
  }
}

// re-render on external changes, but never while the user is typing or dragging a slider
let typing = false; let sliding = false;
api.config.onChange((c) => {
  cfg = c;
  if (section === 'behavior') loadDisplays(); // which displays have a dock may have changed
  if (preview) { preview.setConfig(c); fitPreview(); }
  const a = document.activeElement;
  if (sliding || (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && content.contains(a) && a.type !== 'range')) { typing = true; return; }
  go(section);
});
content.addEventListener('focusout', () => { if (typing && !sliding) { typing = false; setTimeout(() => go(section), 0); } });
content.addEventListener('pointerdown', (e) => { if (e.target.type === 'range') sliding = true; });
window.addEventListener('pointerup', () => { if (sliding) { sliding = false; if (typing) { typing = false; setTimeout(() => go(section), 0); } } });
api.onSettingsSection((s) => go(s, { top: true }));

// ---------------- events ----------------
document.addEventListener('click', async (e) => {
  if (e.target.closest('#pv')) return; // the live preview is display-only
  const t = e.target.closest('button, [data-sec]'); if (!t || t.disabled) return;
  const d = t.dataset;
  if (d.sec) return go(d.sec, { top: true });
  if (d.path && d.kind === 'bool') return set(d.path, !get(d.path));
  if (d.path && d.v !== undefined) return set(d.path, d.num === 'true' ? Number(d.v) : d.v);
  if (d.theme) return set('appearance.theme', d.theme);
  if (d.do === 'toCustom') { const th = resolveTheme(cfg.appearance); const { label, dark, sheen, ...vals } = th; return api.config.patch({ appearance: { theme: 'custom', custom: vals } }); }
  if (d.do === 'editor') { api.openEditor('arrange'); toast('Layout Editor opened on the dock'); return; }
  if (d.do === 'export') { const p = await api.config.export(); if (p) toast('Exported to ' + p); return; }
  if (d.do === 'import') { try { const p = await api.config.import(); if (p) toast('Configuration imported'); } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } return; }
  if (d.do === 'openData') return api.act('open', { target: info.userData });
  if (d.do === 'spotifyOn') { toast('Finish the sign-in in your browser'); try { await api.act('spotifyConnect'); toast('Spotify connected'); } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } spotifyState = await api.integration('spotify', { refresh: true }); return go('integrations'); }
  if (d.do === 'spotifyOff') { await api.act('spotifyDisconnect'); spotifyState = await api.integration('spotify', { refresh: true }); return go('integrations'); }
  if (d.ah) return api.config.patch({ behavior: { autohidePer: { [d.ah]: !ahOn(d.ah) } } });
  if (d.mon) { const list = new Set(cfg.behavior.monitorList || []); if (list.has(d.mon)) list.delete(d.mon); else list.add(d.mon); return api.config.patch({ behavior: { monitors: 'custom', monitorList: [...list] } }); }
  if (d.do === 'geocode') {
    const q = $('#citySearch').value.trim(); if (!q) return;
    const res = await api.geocode(q).catch(() => []);
    $('#cityResults').innerHTML = res.map((r, i) => `<button class="b sm" data-city="${i}">${esc(r.name)}${r.admin ? ', ' + esc(r.admin) : ''} · ${esc(r.country || '')}</button>`).join('') || '<span class="bad">No city found</span>';
    $('#cityResults')._res = res; return;
  }
  if (d.city !== undefined) { const r = $('#cityResults')._res[Number(d.city)]; return api.config.patch({ integrations: { weather: { city: r.name, lat: r.lat, lon: r.lon } } }); }
  if (d.reset) {
    if (!confirm(d.reset === 'all' ? 'Reset the entire configuration?' : 'Restore the defaults for this section?')) return;
    await api.config.reset(d.reset === 'all' ? undefined : d.reset); toast('Defaults restored'); return;
  }
  // layouts
  if (d.layout) {
    try {
      if (d.layout === 'switch') { await api.config.layout('switch', { id: d.v }); toast('Layout activated'); }
      if (d.layout === 'create' || d.layout === 'createBlank') { const c = await api.config.layout('create', { name: `Layout ${(cfg.profiles || []).length + 1}`, blank: d.layout === 'createBlank' }); renaming = c.activeProfile; go('layout'); }
      if (d.layout === 'rename') { renaming = d.v; go('layout'); }
      if (d.layout === 'renameOk') { const v = content.querySelector(`[data-rename="${d.v}"]`)?.value.trim(); renaming = null; if (v) await api.config.layout('rename', { id: d.v, name: v }); else go('layout'); }
      if (d.layout === 'delete') { if (!confirm('Delete this layout?')) return; await api.config.layout('delete', { id: d.v }); toast('Layout deleted'); }
    } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    return;
  }
  // widgets
  const W = (uid, patch) => api.config.patch({ widgets: cfg.widgets.map((w) => (w.uid === uid ? { ...w, ...patch } : w)) });
  const Wset = (uid, key, v) => { const w = cfg.widgets.find((x) => x.uid === uid); return W(uid, { settings: { ...(w.settings || {}), [key]: v } }); };
  if (d.wtoggle) { const w = cfg.widgets.find((x) => x.uid === d.wtoggle); return W(w.uid, { enabled: !w.enabled }); }
  if (d.wsize) { const [uid, s] = d.wsize.split('|'); return W(uid, { size: s }); }
  if (d.wopen) { openWidget = openWidget === d.wopen ? null : d.wopen; return go('widgets'); }
  if (d.wdel) return api.config.patch({ widgets: cfg.widgets.filter((w) => w.uid !== d.wdel) });
  if (d.wset && d.kind === 'bool') { const [uid, key] = d.wset.split('|'); const w = cfg.widgets.find((x) => x.uid === uid); const def = defOf(w.type); const cur = { ...defaultsFor(def), ...(w.settings || {}) }[key]; return Wset(uid, key, !cur); }
  if (d.addcat) { addCat = d.addcat; return go('widgets'); }
  if (d.add) { const uid = `${d.add.replace(/[^a-z0-9]/gi, '')}-${Date.now().toString(36)}`; await api.config.patch({ widgets: [...cfg.widgets, { uid, type: d.add, enabled: true, size: 'auto', settings: {} }] }); toast('Widget added'); return; }
  if (d.pick) { const [uid, key] = d.target.split('|'); const p = await api.act(d.pick === 'file' ? 'pickApp' : 'pickFolder'); if (p) Wset(uid, key, p); return; }
  if (d.pinfile) { const p = await api.act('pickApp'); if (p) { const w = cfg.widgets.find((x) => x.uid === d.pinfile); Wset(w.uid, 'pins', [...(w.settings.pins || []), { path: p, name: p.split('\\').pop().replace(/\.(exe|lnk|url)$/i, '') }]); } return; }
  if (d.pindel) { const [uid, i] = d.pindel.split('|'); const w = cfg.widgets.find((x) => x.uid === uid); return Wset(uid, 'pins', w.settings.pins.filter((_, j) => j !== Number(i))); }
  if (d.pinmove) { const [uid, i, dir] = d.pinmove.split('|').map((x, k) => (k ? Number(x) : x)); const w = cfg.widgets.find((x) => x.uid === uid); const p = [...w.settings.pins]; const j = i + dir; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; return Wset(uid, 'pins', p); }
  // custom widgets
  const C = (id, patch) => api.config.patch({ customWidgets: cfg.customWidgets.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  if (d.cnew !== undefined) { const id = Date.now().toString(36); editCustom = id; await api.config.patch({ customWidgets: [...(cfg.customWidgets || []), { id, name: 'My widget', kind: 'link', target: 'https://', color: '#0a84ff', icon: 'sparkles' }] }); return; }
  if (d.cedit) { editCustom = editCustom === d.cedit ? null : d.cedit; return go('widgets'); }
  if (d.cdel) { if (!confirm('Delete this custom widget?')) return; const keep = (w) => w.type !== 'custom:' + d.cdel; // removed from every saved layout, not only the active one
    return api.config.patch({ customWidgets: cfg.customWidgets.filter((c) => c.id !== d.cdel), widgets: cfg.widgets.filter(keep), profiles: cfg.profiles.map((p) => ({ ...p, widgets: (p.widgets || []).filter(keep) })) }); }
  if (d.cadd) { await api.config.patch({ widgets: [...cfg.widgets, { uid: 'custom-' + Date.now().toString(36), type: 'custom:' + d.cadd, enabled: true, size: 'auto', settings: {} }] }); toast('Added to the dock'); return; }
  if (d.ckind) { const [id, k] = d.ckind.split('|'); return C(id, { kind: k }); }
  // secrets & tests
  if (d.savesecret) { const v = content.querySelector(`[data-secret="${d.savesecret}"]`).value.trim(); if (!v) return; secretKeys = await api.secrets.set(d.savesecret, v); toast('Saved and encrypted'); return go(section); }
  if (d.delsecret) { secretKeys = await api.secrets.set(d.delsecret, ''); toast('Key removed'); return go(section); }
  if (d.test) {
    results[d.test] = 'Testing…'; go(section);
    // escaped: an error can carry a server's HTML page (wrong domain, captive portal)
    try {
      const r = await api.integration(d.test, { refresh: true });
      results[d.test] = esc(r.connected ? `✓ Connected${r.login ? ' as ' + r.login : r.name ? ' · ' + r.name : r.city ? ' · ' + r.city : r.user ? ' · ' + r.user : ''}${r.events ? ` · ${r.events.length} events` : ''}${r.total !== undefined && r.currency ? ` · ${Math.round(r.total)} ${r.currency}` : ''}` : `✗ ${r.error || r.reason || 'Not connected'}`);
    } catch (err) { results[d.test] = esc(`✗ ${err.message}`); }
    return go(section);
  }
});
// a number field's value within its min/max, or null while it is empty or invalid
function numValue(el) {
  if (el.value === '' || !Number.isFinite(Number(el.value))) return null;
  let n = Number(el.value);
  if (el.min !== '') n = Math.max(Number(el.min), n);
  if (el.max !== '') n = Math.min(Number(el.max), n);
  return n;
}
document.addEventListener('input', (e) => {
  const el = e.target; const d = el.dataset;
  if (el.type === 'range' && el.closest('.range')) {
    const p = ((el.value - el.min) / (el.max - el.min)) * 100; el.style.setProperty('--p', p + '%');
    el.nextElementSibling.textContent = fmtVal(el.value, Number(el.step)) + (d.unit || '');
  }
  if (d.path) {
    if (el.type === 'range' || d.kind === 'num') { const n = numValue(el); return n === null ? undefined : set(d.path, n, 30); }
    if (el.type === 'color') { const t = el.parentElement.querySelector('.in'); if (t) t.value = el.value; return set(d.path, el.value, 30); }
    if (d.kind === 'text') { if (el.closest('.color') && !/^#[0-9a-f]{6}$/i.test(el.value)) return; return set(d.path, el.value, 450); }
  }
  if (d.wset) {
    const [uid, key] = d.wset.split('|');
    const v = d.kind === 'num' ? numValue(el) : el.value;
    if (v === null) return; // half-typed number: wait for a valid one
    // the current settings are read when the patch is sent, so two quick edits in a row both survive
    clearTimeout(el._t); el._t = setTimeout(() => api.config.patch({ widgets: cfg.widgets.map((x) => (x.uid === uid ? { ...x, settings: { ...(x.settings || {}), [key]: v } } : x)) }), el.tagName === 'SELECT' || el.type === 'color' ? 0 : 450);
  }
  if (d.cfield) { const [id, k] = d.cfield.split('|'); clearTimeout(el._t); el._t = setTimeout(() => api.config.patch({ customWidgets: cfg.customWidgets.map((c) => (c.id === id ? { ...c, [k]: el.value } : c)) }), el.tagName === 'SELECT' || el.type === 'color' ? 0 : 450); }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.pinstart && el.value) {
    const w = cfg.widgets.find((x) => x.uid === el.dataset.pinstart);
    const name = el.options[el.selectedIndex].text;
    api.config.patch({ widgets: cfg.widgets.map((x) => (x.uid === w.uid ? { ...x, settings: { ...x.settings, pins: [...(x.settings.pins || []), { path: el.value, name }] } } : x)) });
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'citySearch') content.querySelector('[data-do=geocode]').click();
  if (e.key === 'Enter' && e.target.dataset.secret) content.querySelector(`[data-savesecret="${e.target.dataset.secret}"]`).click();
  if (e.key === 'Enter' && e.target.dataset.rename) content.querySelector(`[data-layout="renameOk"][data-v="${e.target.dataset.rename}"]`)?.click();
  if (e.key === 'Escape' && renaming) { renaming = null; go('layout'); }
});

// drag & drop ordering in the widget list
let dragUid = null;
content.addEventListener('dragstart', (e) => { const r = e.target.closest('.wrow'); if (!r) return; dragUid = r.dataset.uid; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
content.addEventListener('dragover', (e) => { const r = e.target.closest('.wrow'); if (!r || !dragUid) return; e.preventDefault(); content.querySelectorAll('.wrow.over').forEach((x) => x.classList.remove('over')); r.classList.add('over'); });
content.addEventListener('dragend', () => { dragUid = null; content.querySelectorAll('.wrow').forEach((x) => x.classList.remove('over', 'dragging')); });
content.addEventListener('drop', (e) => {
  const r = e.target.closest('.wrow'); if (!r || !dragUid) return; e.preventDefault();
  const list = [...cfg.widgets];
  const from = list.findIndex((w) => w.uid === dragUid); const to = list.findIndex((w) => w.uid === r.dataset.uid);
  if (from < 0 || to < 0 || from === to) { dragUid = null; return; } // dropped on itself, or the widget is gone
  const [m] = list.splice(from, 1); list.splice(to, 0, m); // the target's index from before the removal: moving down reaches the end
  dragUid = null; api.config.patch({ widgets: list });
});

// ---------------- performance meters ----------------
let meterT = null;
function startMeters() {
  stopMeters();
  const tick = async () => {
    const m = await api.metrics();
    const ov = $('#ovMem'); if (ov) ov.textContent = fmtBytes(m.totalMem);
    const el = $('#meters'); if (!el) return;
    const v = el.querySelectorAll('b');
    v[0].textContent = fmtBytes(m.totalMem); v[1].textContent = m.cpu.toFixed(1) + ' %'; v[2].textContent = m.processes.length; v[3].textContent = m.helper ? 'Running' : 'Off';
    const names = { Browser: 'Main process', Tab: 'Window (dock / settings)', GPU: 'GPU process (glass rendering)', Utility: 'Network service' };
    $('#procs').innerHTML = `<table class="proc">${m.processes.map((p) => `<tr><td>${names[p.type] || p.type}</td><td>${fmtBytes(p.mem)}</td><td>${p.cpu.toFixed(1)} %</td></tr>`).join('')}<tr><td>PowerShell system helper</td><td colspan="2">${m.helper ? 'running (CPU, RAM, audio, windows, media – a single process)' : 'not started'}</td></tr></table>`;
  };
  tick(); meterT = setInterval(tick, section === 'overview' ? 5000 : 2000);
}
function stopMeters() { clearInterval(meterT); meterT = null; }

// ---------------- live preview ----------------
const wpInfo = await api.wallpaper();
const wallpaperUrl = wpInfo?.url || null;
const pv = $('#pv');
const store = new DataStore(api); await store.load();
const hub = new Hub(api, () => cfg);
preview = new DockView(pv, { api, hub, store, preview: true, canvas: pv.querySelector('.glass-canvas') });
if (wallpaperUrl) {
  $('#preview').style.backgroundImage = `url('${wallpaperUrl}')`;
  const img = new Image();
  img.onload = () => preview.glass.setSource({ img, color: '#1a1c24', place: (w, h) => { const k = Math.max(w / img.naturalWidth, h / img.naturalHeight); return { x: (w - img.naturalWidth * k) / 2, y: (h - img.naturalHeight * k) / 2, w: img.naturalWidth * k, h: img.naturalHeight * k }; } });
  img.src = wallpaperUrl;
}
preview.setConfig(cfg);
function fitPreview() {
  requestAnimationFrame(() => {
    // lay the dock out at its real size, then scale the whole stage down to fit the frame
    const frame = $('#preview');
    pv.style.transform = 'none'; pv.style.width = '4000px'; pv.style.height = frame.clientHeight + 'px';
    const need = (cfg.layout.mode === 'full' ? 1600 : preview.bar.scrollWidth) + 2 * (cfg.layout.margin + 16);
    const z = Math.min(1, frame.clientWidth / need);
    Object.assign(pv.style, { width: frame.clientWidth / z + 'px', height: frame.clientHeight / z + 'px', transform: `scale(${z})`, transformOrigin: '0 0', inset: 'auto', left: '0', top: '0' });
    preview.glass.resize();
  });
}
fitPreview();
new ResizeObserver(fitPreview).observe($('#preview'));
let lastBarW = 0;
new ResizeObserver(() => { const w = preview.bar.scrollWidth; if (Math.abs(w - lastBarW) > 4) { lastBarW = w; fitPreview(); } }).observe(preview.bar);
setTimeout(fitPreview, 800);

window.__go = go;
window.__view = preview; // the live preview, for the PRISM_DEBUG test harness like in the dock
go(location.hash.slice(1) || 'overview', { top: true });
