// DockView renders the bar, its tiles, panels, context menu, tooltip and the Layout Editor.
// Used by the real dock window and by the live preview inside Settings.
//
// Layout changes (order, size, removal, dragging the dock) only happen inside the Layout Editor,
// which is opened and closed on purpose. Outside of it the bar is locked.
import { GlassEngine } from './glass.js';
import { morph } from './morph.js';
import { EditorMixin } from './editor.js';
import { applyTheme, THEMES } from './themes.js';
import { icon, esc } from './ui.js';
import { registry, defaultsFor } from '../widgets/index.js';

export class DataStore {
  constructor(api) { this.api = api; this.c = {}; this.listeners = new Set(); }
  async load() {
    this.c = (await this.api.data.get('*')) || {};
    if (!this._bound) {
      this._bound = true;
      this.api.data.onChange((m) => {
        if (!m) this.load().then(() => this.emit());
        else { this.c[m.key] = m.value; this.emit(m.key); }
      });
    }
  }
  emit(k) { for (const fn of this.listeners) fn(k); }
  get(k, fb) { const v = this.c[k]; return v === undefined ? (fb && typeof fb === 'object' ? structuredClone(fb) : fb) : v; }
  set(k, v) { this.c[k] = v; this.api.data.set(k, v); this.emit(k); }
}

const SPACER = { type: 'spacer', name: 'Spacer', cat: 'apps', icon: 'minus', desc: 'Flexible space – pushes widgets apart in full-width mode.', sizes: ['m'], size: 'm', topics: [], bare: true, noPanel: true, tile: () => '' };
const SIZE_LABEL = { s: 'Small', m: 'Medium', l: 'Large' };
const uidFor = (type) => `${type.replace(/[^a-z0-9]/gi, '')}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export class DockView {
  constructor(root, { api, hub, store, preview = false, canvas }) {
    this.root = root; this.api = api; this.hub = hub; this.store = store; this.preview = preview;
    this.tiles = new Map(); this.icons = new Map();
    this.panel = null; this.editing = false; this.selected = null; this.hidden = false;
    root.classList.add('prism', 'dock-root');
    root.insertAdjacentHTML('beforeend', `
      <div class="dock-wrap"><div id="dock" class="dock" data-glass="0" data-hit><nav class="bar"></nav></div></div>
      <div class="panel" data-glass="0.1" data-hit><div class="panel-body"></div></div>
      <div class="ctx" data-glass="0.14" data-hit></div>
      <div class="tip" data-glass="0.2"></div>
      <div class="toast" data-glass="0.16"></div>
      <div class="sensor" data-hit></div>`);
    this.dockEl = root.querySelector('.dock');
    this.wrapEl = root.querySelector('.dock-wrap'); this.wrapEl._fadeP = 1; this.wrapEl.classList.add('show');
    this.bar = root.querySelector('.bar');
    this.panelEl = root.querySelector('.panel');
    this.panelBody = root.querySelector('.panel-body');
    this.ctxEl = root.querySelector('.ctx');
    this.tipEl = root.querySelector('.tip');
    this.toastEl = root.querySelector('.toast');
    this.sensor = root.querySelector('.sensor');
    this.glass = new GlassEngine(canvas, root);
    this._bindEvents();
    new ResizeObserver(() => { if (this.panel) this._positionPanel(); this.glass.invalidate(); this.onZone?.(); }).observe(this.dockEl);
    new ResizeObserver(() => this._scheduleFit()).observe(this.root);
    new ResizeObserver(() => { if (this.panel) this._positionPanel(); this.glass.invalidate(200); }).observe(this.panelEl);
    store.listeners.add(() => { for (const t of this.tiles.values()) this._renderTile(t); if (this.panel?.t) this._renderPanel(); });
  }

  // ---------------- config ----------------
  setConfig(cfg) {
    const prev = this.cfg;
    this.cfg = cfg;
    this.reg = registry(cfg); this.reg.set('spacer', SPACER);
    const theme = applyTheme(this.root, cfg);
    this.glass.setParams(theme);
    const L = cfg.layout;
    this.root.dataset.edge = L.edge; this.root.dataset.mode = L.mode; this.root.dataset.align = L.align;
    this.root.toggleAttribute('data-margin0', L.margin === 0);
    this.root.classList.toggle('hover-lift', cfg.behavior.hoverEffect !== 'none'); // 'glow' of older configs = highlight
    this.root.classList.toggle('no-anim', !cfg.appearance.animations);
    if (!this._drag) this.root.style.setProperty('--dx', (L.mode === 'pill' && L.align === 'center' ? Number(L.offsetX) || 0 : 0) + 'px');
    this._fitW = null; this._scheduleFit();
    this._syncTiles(prev);
    if (!this.preview) this._setupAutohide();
    if (this.panel?.kind === 'editor') this._renderEditor();
    this.glass.invalidate(300);
  }

  _syncTiles() {
    const want = this.cfg.widgets.filter((w) => w.enabled && this.reg.has(w.type));
    const wantIds = new Set(want.map((w) => w.uid));
    for (const [uid, t] of this.tiles) if (!wantIds.has(uid)) { this._destroyTile(t); this.tiles.delete(uid); }
    for (const inst of want) {
      let t = this.tiles.get(inst.uid);
      const def = this.reg.get(inst.type);
      if (t && JSON.stringify(t.inst) !== JSON.stringify(inst)) { this._destroyTile(t); this.tiles.delete(inst.uid); t = null; }
      if (!t) { t = this._createTile(inst, def); this.tiles.set(inst.uid, t); }
      else t.def = def;
    }
    want.forEach((inst) => this.bar.appendChild(this.tiles.get(inst.uid).el));
    if (this.selected && !this.cfg.widgets.some((w) => w.uid === this.selected)) this.selected = null;
    for (const t of this.tiles.values()) this._renderTile(t, true);
    if (this.panel?.t && !this.tiles.has(this.panel.t.inst.uid)) this.closePanel();
    else if (this.panel?.t) { this.panel.t = this.tiles.get(this.panel.t.inst.uid); this._renderPanel(true); }
  }

  // ---------------- glass surface fades ----------------
  // Panels, menu, tooltip and toast are faded from the same animation frame that redraws the glass.
  // CSS transitions run on Chromium's compositor thread while the WebGL glass is drawn on the main
  // thread, so the two drifted apart: content (and a blur filter, which DWM composites dark in a
  // transparent window) stayed visible after its glass was gone - the black flash on close.
  _fade(el, show, { dur, dy = 4 } = {}) {
    cancelAnimationFrame(el._fadeRaf);
    const speed = this.cfg?.appearance.animations === false ? 0 : (this.cfg?.appearance.animSpeed || 1);
    const ms = (dur ?? (show ? 190 : 140)) * speed;
    const from = el._fadeP ?? 0; const to = show ? 1 : 0;
    const sign = this.cfg?.layout.edge === 'top' ? -1 : 1;
    if (show) { el.style.visibility = 'visible'; el.classList.add('show'); this.onZone?.(); } else el.classList.remove('show');
    const apply = (p) => { el._fadeP = p; el.style.opacity = p.toFixed(3); el.style.transform = p >= 1 ? 'none' : `translateY(${((1 - p) * dy * sign).toFixed(2)}px)`; };
    const t0 = performance.now();
    const step = (now) => {
      const k = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3); // ease-out cubic: quick, no overshoot
      apply(from + (to - from) * e);
      if (k >= 1 && !show) el.style.visibility = 'hidden';
      if (k >= 1) this.onZone?.();
      this.glass.draw();
      if (k < 1) el._fadeRaf = requestAnimationFrame(step); else el._fadeRaf = null;
    };
    el._fadeRaf = requestAnimationFrame(step);
  }

  // ---------------- fit to screen ----------------
  // Narrow or highly scaled screens: shrink the whole bar (down to 72 %) instead of cutting widgets off;
  // anything still wider scrolls horizontally with the mouse wheel.
  _scheduleFit() { if (this._fitRaf) return; this._fitRaf = requestAnimationFrame(() => { this._fitRaf = null; this._fit(); }); }
  _fit() {
    if (this.preview || !this.cfg) return;
    const L = this.cfg.layout;
    const avail = this.root.clientWidth - 2 * L.margin;
    const cap = L.mode === 'pill' && L.maxWidth ? Math.min(L.maxWidth, avail) : avail;
    // natural width = content + bar padding, measured without any cap
    const need = this.bar.scrollWidth + 2;
    const z = L.mode === 'pill' && need > cap ? Math.max(0.72, cap / need) : 1;
    const maxW = Math.floor(cap / z);
    if (Math.abs((this._fitZ || 1) - z) > 0.004 || this._fitW !== maxW) {
      this._fitZ = z; this._fitW = maxW;
      this.root.style.setProperty('--fit', z);
      this.dockEl.style.maxWidth = maxW + 'px';
      this.glass.invalidate(300); if (this.panel) this._positionPanel();
    }
    this.dockEl.classList.toggle('overflowing', this.bar.scrollWidth > this.bar.clientWidth + 1);
  }

  // ---------------- tiles ----------------
  _createTile(inst, def) {
    const el = document.createElement('section');
    el.className = 'tile' + (def.bare ? ' bare' : '') + (def.type === 'spacer' ? ' spacer' : '') + (def.tileClass ? ' ' + def.tileClass : '');
    el.dataset.uid = inst.uid;
    const t = { inst, def, el, data: {}, state: {}, unsubs: [], last: null };
    t.ctx = this._makeCtx(t);
    el.dataset.size = t.ctx.size;
    const topics = new Set(typeof def.topics === 'function' ? def.topics(t.ctx) : def.topics || []);
    if (def.tick) topics.add('clock');
    for (const topic of topics) {
      t.unsubs.push(this.hub.subscribe(topic, (v) => {
        t.data[topic] = v;
        if (topic === 'clock' && def.tick) def.tick(t.ctx);
        this._scheduleRender(t);
      }));
    }
    if (def.init && !this.preview) Promise.resolve(def.init(t.ctx)).catch((e) => console.warn(e));
    return t;
  }
  _destroyTile(t) { t.unsubs.forEach((u) => u()); t.el.remove(); }

  _makeCtx(t) {
    const self = this;
    return {
      get inst() { return t.inst; },
      get widget() { return t.def; },
      get s() { return { ...defaultsFor(t.def), ...(t.inst.settings || {}) }; },
      get size() { const s = t.inst.size; return s && s !== 'auto' && t.def.sizes.includes(s) ? s : t.def.size; },
      get cfg() { return self.cfg; },
      get u() { return parseFloat(getComputedStyle(self.root).getPropertyValue('--u')) || 1; },
      api: this.api, hub: this.hub, store: this.store, state: t.state, icons: this.icons,
      act: (n, a) => this.api.act(n, a),
      rerender: (force) => { if (!t.el) return; this._renderTile(t, true); if (this.panel?.t === t) this._renderPanel(force); },
      rerenderTile: () => { if (t.el) this._renderTile(t, true); },
      // every tile of these widget types, plus the open panel (e.g. all media widgets after play/pause)
      rerenderType: (types) => { for (const x of this.tiles.values()) if (types.includes(x.def.type)) this._renderTile(x, true); if (this.panel?.t && types.includes(this.panel.t.def.type)) this._renderPanel(); },
      openPanel: () => this.openPanel(t), closePanel: () => this.closePanel(),
      panelEl: () => (this.panel?.t === t ? this.panelBody : null),
      toast: (m) => this.toast(m),
      openSettings: (s) => this.api.openSettings(s),
      openEditor: () => this.openEditor(),
      saveSettings: (patch) => this.saveWidget(t.inst.uid, { settings: { ...(t.inst.settings || {}), ...patch } }),
    };
  }

  _scheduleRender(t) {
    if (t.pending) return;
    t.pending = true;
    requestAnimationFrame(() => {
      t.pending = false;
      this._renderTile(t);
      if (this.panel?.t === t && t.def.panelLive !== false) this._renderPanel();
    });
  }

  _renderTile(t, force = false) {
    let html;
    try { html = t.def.tile(t.ctx, t.data) || ''; } catch (e) { console.error(t.def.type, e); html = `<div class="tin"><span class="t-sub">Error</span></div>`; }
    if (this.editing) {
      html += `<button class="rm" data-rm="${t.inst.uid}" title="Remove">${icon('close', 10)}</button>`;
      if (t.def.sizes.length > 1) html += `<button class="szb" data-cycle="${t.inst.uid}" title="Change size">${t.ctx.size.toUpperCase()}</button>`;
    }
    if (html === t.last && !force) return;
    if (!force && t.el.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (!force && this._pressedIn === t.el) return;
    if (html === t.last) return;
    const w0 = t.el.offsetWidth;
    morph(t.el, html);
    t.el.dataset.size = t.ctx.size;
    t.el.classList.toggle('selected', this.editing && this.selected === t.inst.uid);
    t.last = html;
    this._hydrate(t.el);
    // the glass only has to be redrawn when the bar's geometry changed, not for new numbers
    if (t.el.offsetWidth !== w0) { this.glass.invalidate(); this._scheduleFit(); }
  }

  // load icons for <img data-icon="path">
  _hydrate(root) {
    for (const img of root.querySelectorAll('img[data-icon]:not([src])')) {
      const p = img.dataset.icon; if (!p) continue;
      const c = this.icons.get(p);
      if (c) { img.src = c; continue; }
      if (c === null) continue;
      this.api.icon(p, 64).then((url) => { this.icons.set(p, url || null); if (url) for (const i of this.root.querySelectorAll('img[data-icon]')) if (i.dataset.icon === p) i.src = url; });
    }
  }

  // ---------------- widget list operations ----------------
  saveWidget(uid, patch) {
    const widgets = this.cfg.widgets.map((w) => (w.uid === uid ? { ...w, ...patch } : w));
    return this.api.config.patch({ widgets });
  }
  addWidget(type, afterUid) {
    const def = this.reg.get(type);
    const inst = { uid: uidFor(type), type, enabled: true, size: 'auto', settings: {} };
    const widgets = [...this.cfg.widgets];
    const i = afterUid ? widgets.findIndex((w) => w.uid === afterUid) : -1;
    if (i >= 0) widgets.splice(i + 1, 0, inst); else widgets.push(inst);
    this.toast(`${def?.name || type} added`);
    if (this.editing) this.selected = inst.uid;
    return this.api.config.patch({ widgets });
  }
  removeWidget(uid) { if (this.selected === uid) this.selected = null; return this.api.config.patch({ widgets: this.cfg.widgets.filter((w) => w.uid !== uid) }); }
  moveWidget(uid, to) {
    const list = [...this.cfg.widgets]; const from = list.findIndex((w) => w.uid === uid); if (from < 0) return;
    const clamped = Math.max(0, Math.min(list.length - 1, to)); if (clamped === from) return;
    const [m] = list.splice(from, 1); list.splice(clamped, 0, m);
    return this.api.config.patch({ widgets: list });
  }
  cycleSize(uid) {
    const w = this.cfg.widgets.find((x) => x.uid === uid); const def = w && this.reg.get(w.type); if (!def) return;
    const cur = w.size && w.size !== 'auto' && def.sizes.includes(w.size) ? w.size : def.size;
    return this.saveWidget(uid, { size: def.sizes[(def.sizes.indexOf(cur) + 1) % def.sizes.length] });
  }

  // ---------------- panels ----------------
  togglePanel(t) { if (this.panel?.t === t) this.closePanel(); else this.openPanel(t); }

  async openPanel(t) {
    if (t.def.noPanel || this.editing) return;
    this.closeCtx();
    const same = this.panel?.t === t;
    if (this.panel && !same) this._unsubPanel();
    for (const x of this.tiles.values()) x.el.classList.toggle('open', x === t);
    this.panel = { t, kind: 'widget', unsubs: [] };
    for (const topic of t.def.panelTopics || []) {
      if ((t.def.topics || []).includes(topic)) continue;
      this.panel.unsubs.push(this.hub.subscribe(topic, (v) => { t.data[topic] = v; this._renderPanel(); }));
    }
    if (t.def.panelLive === 'fast') this.panel.unsubs.push(this._fastTicker(t));
    this.panelEl.style.setProperty('--pw', (t.def.panelWidth || 320) + 'px');
    if (t.def.panelLoad) { this.panelBody.innerHTML = '<div class="empty">Loading…</div>'; this._showPanel(t.el); await t.def.panelLoad(t.ctx); }
    this._renderPanel(true);
    this._showPanel(t.el);
    if (!this.preview) this.api.dock.focus();
    setTimeout(() => this.panelBody.querySelector('[autofocus]')?.focus(), 60);
  }
  _fastTicker() { let on = true; const f = () => { if (!on) return; this._renderPanel(); setTimeout(f, 100); }; f(); return () => { on = false; }; }
  _unsubPanel() { this.panel?.unsubs?.forEach((u) => u()); }

  _renderPanel(force = false) {
    const p = this.panel; if (!p?.t) return;
    const a = document.activeElement;
    if (!force && this.panelBody.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'range') return;
    if (!force && this._pressedIn === this.panelEl) return;
    let html;
    try { html = p.t.def.panel(p.t.ctx, p.t.data); } catch (e) { console.error(e); html = `<div class="err-note">${esc(e.message)}</div>`; }
    if (html === p.last && !force) return;
    p.last = html;
    const h0 = this.panelEl.offsetHeight;
    if (force) this.panelBody.innerHTML = html; else morph(this.panelBody, html);
    this._hydrate(this.panelBody);
    if (this.panelEl.offsetHeight !== h0) this.glass.invalidate();
  }

  _showPanel(anchor) {
    this.panel.anchor = anchor;
    this._positionPanel();
    this._fade(this.panelEl, true);
  }
  _positionPanel() {
    const p = this.panel; if (!p) return;
    const rr = this.root.getBoundingClientRect();
    const a = (p.anchor || this.dockEl).getBoundingClientRect();
    const d = this.dockEl.getBoundingClientRect();
    const w = this.panelEl.offsetWidth;
    const cx = p.kind === 'editor' ? rr.width / 2 : a.left + a.width / 2 - rr.left;
    const x = Math.max(8, Math.min(rr.width - w - 8, cx - w / 2));
    this.panelEl.style.left = Math.round(x) + 'px';
    this.panelEl.style.transformOrigin = `${cx - x}px ${this.cfg.layout.edge === 'top' ? '0' : '100%'}`;
    if (this.cfg.layout.edge === 'top') { this.panelEl.style.top = Math.round(d.bottom - rr.top + 10) + 'px'; this.panelEl.style.bottom = ''; }
    else { this.panelEl.style.bottom = Math.round(rr.bottom - d.top + 10) + 'px'; this.panelEl.style.top = ''; }
  }
  closePanel() {
    if (!this.panel) return;
    if (this.panel.kind === 'editor') return this.closeEditor();
    this._unsubPanel();
    this.panel = null;
    this._fade(this.panelEl, false);
    for (const x of this.tiles.values()) x.el.classList.remove('open');
    this._maybeAutohide();
  }
  // window lost focus: close widget panels and menus, but keep the editor open
  onBlur() {
    this.closeCtx();
    if (this.panel && this.panel.kind !== 'editor') this.closePanel();
  }

  // ---------------- context menu ----------------
  showCtx(x, y, items) {
    this.ctxItems = items;
    this.ctxEl.innerHTML = items.map((it, i) => (it.sep ? '<div class="sep"></div>' : it.head ? `<div class="head">${esc(it.head)}</div>`
      : it.swatches ? `<div class="swatches">${it.swatches.map(([k, label, tint, text, a]) => `<button class="sw ${it.current === k ? 'on' : ''}" data-settheme="${k}" title="${esc(label)}"><i style="background:linear-gradient(135deg, color-mix(in srgb, ${tint} ${Math.round(a * 100)}%, #5b4b8a), color-mix(in srgb, ${tint} ${Math.round(a * 100)}%, #1f6f8b));color:${text}">Aa</i><span>${esc(label.replace('Liquid ', ''))}</span></button>`).join('')}</div>`
        : `<button class="item ${it.danger ? 'danger' : ''}" data-ci="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 15) : '<i class="ic-sp"></i>'}<span>${esc(it.label)}</span>${it.check ? icon('checkSmall', 14, 'class="ic chk"') : it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`)).join('');
    const rr = this.root.getBoundingClientRect();
    this.ctxEl.classList.add('measure');
    const w = this.ctxEl.offsetWidth, h = this.ctxEl.offsetHeight;
    this.ctxEl.classList.remove('measure');
    const left = Math.max(8, Math.min(rr.width - w - 8, x - rr.left - 12));
    const top = this.cfg.layout.edge === 'top' ? Math.min(rr.height - h - 8, y - rr.top + 8) : Math.max(8, y - rr.top - h - 8);
    Object.assign(this.ctxEl.style, { left: Math.round(left) + 'px', top: Math.round(top) + 'px', transformOrigin: `${x - rr.left - left}px ${this.cfg.layout.edge === 'top' ? '0' : '100%'}` });
    this._fade(this.ctxEl, true, { dur: 150, dy: 3 });
    if (!this.preview) this.api.dock.focus();
  }
  closeCtx() { if (!this.ctxEl.classList.contains('show')) return; this._fade(this.ctxEl, false, { dur: 110, dy: 3 }); this._maybeAutohide(); }

  dockMenu(t, sub) {
    const c = this.cfg; const L = c.layout;
    const items = [];
    if (t && t.def.type !== 'spacer') {
      const own = t.def.contextMenu && sub ? t.def.contextMenu(t.ctx, sub) : [];
      if (own.length) items.push(...own, { sep: true });
      items.push({ head: t.def.name });
      if (t.def.sizes.length > 1) for (const s of t.def.sizes) items.push({ label: `${SIZE_LABEL[s]} size`, icon: s === 's' ? 'minus' : s === 'm' ? 'layers' : 'plus', check: t.ctx.size === s, run: () => this.saveWidget(t.inst.uid, { size: s }) });
      items.push({ label: 'Widget settings…', icon: 'gear', run: () => this.api.openSettings('widget:' + t.inst.uid) });
      items.push({ label: 'Remove from dock', icon: 'trash', danger: true, run: () => this.removeWidget(t.inst.uid) }, { sep: true });
    }
    items.push(
      { label: 'Edit layout…', icon: 'edit', run: () => this.openEditor('arrange') },
      { label: 'Add widgets…', icon: 'plus', run: () => this.openEditor('add') },
    );
    if ((c.profiles || []).length > 1) {
      items.push({ sep: true }, { head: 'Layouts' });
      for (const p of c.profiles) items.push({ label: p.name, icon: 'layers', check: p.id === c.activeProfile, run: () => this.api.config.layout('switch', { id: p.id }) });
    }
    items.push(
      { sep: true },
      { label: L.edge === 'top' ? 'Move dock to bottom' : 'Move dock to top', icon: L.edge === 'top' ? 'chevronDown' : 'chevronUp', run: () => this.api.config.patch({ layout: { edge: L.edge === 'top' ? 'bottom' : 'top' } }) },
      { label: L.mode === 'pill' ? 'Full width' : 'Floating pill', icon: 'layers', run: () => this.api.config.patch({ layout: { mode: L.mode === 'pill' ? 'full' : 'pill' } }) },
      { label: 'Show only on hover', icon: 'eye', check: this._ahOn(), run: () => this.api.config.patch(this.displayKey ? { behavior: { autohidePer: { [this.displayKey]: !this._ahOn() } } } : { behavior: { autohide: !this._ahOn() } }) },
      { sep: true }, { head: 'Style' },
      { swatches: [...Object.entries(THEMES).map(([k, th]) => [k, th.label, th.tint, th.text, th.tintOpacity]), ['custom', 'Custom', c.appearance.custom.tint, c.appearance.custom.text, c.appearance.custom.tintOpacity]], current: c.appearance.theme },
      { sep: true },
      { label: 'Settings…', icon: 'gear', run: () => this.api.openSettings() },
    );
    if (!this.preview) items.push({ label: 'Quit PrismDock', icon: 'power', run: () => this.api.act('quit') });
    return items;
  }

  // ---------------- tooltip & toast ----------------
  showTip(el) {
    const text = el.dataset.tip; if (!text) return;
    const rr = this.root.getBoundingClientRect(); const a = el.getBoundingClientRect();
    this.tipEl.textContent = text;
    const w = this.tipEl.offsetWidth || 80;
    this.tipEl.style.left = Math.round(Math.max(6, Math.min(rr.width - w - 6, a.left - rr.left + a.width / 2 - w / 2))) + 'px';
    const inPanel = el.closest('.panel');
    if (this.cfg.layout.edge === 'top' && !inPanel) { this.tipEl.style.top = Math.round(this.dockEl.getBoundingClientRect().bottom - rr.top + 8) + 'px'; this.tipEl.style.bottom = ''; }
    else { this.tipEl.style.bottom = Math.round(rr.bottom - (inPanel ? a.top : this.dockEl.getBoundingClientRect().top) + 8) + 'px'; this.tipEl.style.top = ''; }
    this._fade(this.tipEl, true, { dur: 120, dy: 2 });
  }
  hideTip() { if (this.tipEl.classList.contains('show')) this._fade(this.tipEl, false, { dur: 90, dy: 2 }); }
  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.style.setProperty('--toast-w', this.toastEl.offsetWidth + 'px');
    const rr = this.root.getBoundingClientRect(); const anchor = (this.panel ? this.panelEl : this.dockEl).getBoundingClientRect();
    if (this.cfg.layout.edge === 'top') { this.toastEl.style.top = Math.round(anchor.bottom - rr.top + 12) + 'px'; this.toastEl.style.bottom = ''; }
    else { this.toastEl.style.bottom = Math.round(rr.bottom - anchor.top + 12) + 'px'; this.toastEl.style.top = ''; }
    this._fade(this.toastEl, true, { dur: 160, dy: 3 });
    clearTimeout(this._toastT); this._toastT = setTimeout(() => this._fade(this.toastEl, false, { dur: 160, dy: 3 }), 2200);
  }

  // ---------------- autohide ----------------
  // per display: behavior.autohidePer[key] wins over the global default
  _ahOn() { const b = this.cfg?.behavior; if (!b) return false; const per = b.autohidePer || {}; return this.displayKey && this.displayKey in per ? !!per[this.displayKey] : !!b.autohide; }
  setDisplayKey(k) { if (k === this.displayKey) return; this.displayKey = k; if (!this.preview && this.cfg) this._setupAutohide(); }
  _setupAutohide() {
    const on = this._ahOn();
    this.sensor.style.display = on ? '' : 'none';
    this.onZone?.();
    if (!on) this._reveal();
    else this._maybeAutohide();
  }
  _reveal() { clearTimeout(this._hideT); if (this.hidden) { this.hidden = false; this.root.classList.remove('dock-hidden'); this.syncDockVisible(); } }
  // show-on-hover and full-screen apps hide the bar with the same frame-synchronous fade as panels
  syncDockVisible() {
    const show = !this.hidden && !this.root.classList.contains('fs-hidden');
    if (show === (this._dockShown ?? true)) return;
    this._dockShown = show;
    this._fade(this.wrapEl, show, { dur: show ? 170 : 150, dy: 6 });
    this.updatePause();
  }
  // no polling while nothing of this dock can be seen (window hidden, bar faded out)
  updatePause() { if (!this.preview) this.hub.setPaused(document.hidden || this._dockShown === false); }
  _maybeAutohide() {
    if (this.preview || !this._ahOn()) return;
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => {
      if (this.panel || this.editing || this.ctxEl.classList.contains('show') || this._hovering || this._drag) return;
      this.hidden = true; this.root.classList.add('dock-hidden'); this.syncDockVisible();
    }, this.cfg.behavior.autohideDelay);
  }

  // ---------------- events ----------------
  _tileOf(el) { const s = el?.closest?.('.tile'); return s && this.tiles.get(s.dataset.uid); }

  _bindEvents() {
    const R = this.root;
    R.addEventListener('click', async (e) => {
      if (this._suppressClick) { this._suppressClick = false; return; }
      const ci = e.target.closest('[data-ci]');
      if (ci) { const it = this.ctxItems[Number(ci.dataset.ci)]; this.closeCtx(); it?.run?.(); return; }
      const sw = e.target.closest('[data-settheme]');
      if (sw) { this.closeCtx(); this.api.config.patch({ appearance: { theme: sw.dataset.settheme } }); return; }
      if (!e.target.closest('.ctx')) this.closeCtx();
      const ed = e.target.closest('[data-ed]');
      if (ed && !ed.disabled) { this._editorAction(ed); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) { e.stopPropagation(); this.removeWidget(rm.dataset.rm); return; }
      const cyc = e.target.closest('[data-cycle]');
      if (cyc) { e.stopPropagation(); this.cycleSize(cyc.dataset.cycle); return; }
      const inPanel = e.target.closest('.panel');
      if (this.editing && !inPanel) { const t = this._tileOf(e.target); if (t) this.selectTile(t.inst.uid); return; }
      const t = inPanel ? this.panel?.t : this._tileOf(e.target);
      if (!t) return;
      const actEl = e.target.closest('[data-a]');
      if (actEl && t.def.on?.[actEl.dataset.a]) { e.stopPropagation(); t.def.on[actEl.dataset.a](t.ctx, actEl, e); return; }
      if (inPanel || e.target.closest('input,[data-noclick]')) return;
      if (t.def.onClick && (await t.def.onClick(t.ctx, e))) return;
      if (!t.def.noPanel) this.togglePanel(t);
    });
    R.addEventListener('input', (e) => {
      if (e.target.classList?.contains('rng')) e.target.style.setProperty('--p', ((e.target.value - e.target.min) / ((e.target.max - e.target.min) || 1)) * 100 + '%');
      if (e.target.matches('[data-ed-q]')) { this.panel.q = e.target.value; this._editorStale = false; clearTimeout(this._qT); this._qT = setTimeout(() => { const pos = e.target.selectionStart; const keep = document.activeElement === e.target; this._editorQuery(pos, keep); }, 120); return; }
      if (e.target.matches('[data-ed-rng]')) {
        const k = e.target.dataset.edRng; const v = Number(e.target.value);
        const out = e.target.closest('.ed-rng')?.querySelector('.val'); if (out) out.textContent = v + 'px';
        clearTimeout(this._rngT); this._rngT = setTimeout(() => this.api.config.patch({ layout: { [k]: v } }), 25);
        return;
      }
      const el = e.target.closest('[data-input]'); if (!el) return;
      const t = e.target.closest('.panel') ? this.panel?.t : this._tileOf(el);
      t?.def.on?.[el.dataset.input]?.(t.ctx, el, e);
    });
    R.addEventListener('change', (e) => {
      if (e.target.matches('[data-ed-pos]')) { const n = Number(e.target.value); if (this.selected && n >= 1) this.moveWidget(this.selected, n - 1); }
      const ch = e.target.closest('[data-change]');
      if (ch) { const t = e.target.closest('.panel') ? this.panel?.t : this._tileOf(ch); t?.def.on?.[ch.dataset.change]?.(t.ctx, ch, e); }
    });
    R.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (this.ctxEl.classList.contains('show')) return this.closeCtx(); if (this.panel?.kind === 'editor' && this.panel.renaming) { this.panel.renaming = false; return this._renderEditor(); } return this.closePanel(); }
      if (e.key === 'Enter' && e.target.matches('[data-ed-name]')) return this._editorAction({ dataset: { ed: 'renameOk' } });
      if (e.key === 'Enter' && e.target.matches('[data-ed-pos]')) { e.target.blur(); return; }
      if (this.editing && this.selected && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
        const i = this.cfg.widgets.findIndex((w) => w.uid === this.selected);
        if (e.key === 'ArrowLeft') return this.moveWidget(this.selected, i - 1);
        if (e.key === 'ArrowRight') return this.moveWidget(this.selected, i + 1);
        if (e.key === 'Delete') return this.removeWidget(this.selected);
      }
      const el = e.target.closest('[data-enter]');
      if (el && e.key === 'Enter') { const t = this.panel?.t || this._tileOf(el); t?.def.on?.[el.dataset.enter]?.(t.ctx, el, e); }
    });
    R.addEventListener('focusout', () => { if (this._editorStale) setTimeout(() => { if (this._editorStale && !this.panelBody.contains(document.activeElement)) { this._editorStale = false; this._renderEditor(); } }, 0); });
    R.addEventListener('wheel', (e) => {
      if (e.target.closest('.panel,.ctx')) return;
      const t = this._tileOf(e.target);
      if (t?.def.wheel && !this.editing) { e.preventDefault(); t.def.wheel(t.ctx, e); return; }
      if (e.target.closest('.dock') && this.bar.scrollWidth > this.bar.clientWidth) { e.preventDefault(); this.bar.scrollLeft += e.deltaY || e.deltaX; }
    }, { passive: false });
    R.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (e.target.closest('.panel,.ctx')) return;
      const t = this._tileOf(e.target);
      if (!t && !e.target.closest('.dock')) return;
      if (this.panel?.kind !== 'editor') this.closePanel();
      this.showCtx(e.clientX, e.clientY, this.dockMenu(t, e.target.closest('[data-ctx]')));
    });
    // tooltips
    R.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip]');
      clearTimeout(this._tipT);
      if (el && (!this.panel || el.closest('.panel'))) this._tipT = setTimeout(() => this.showTip(el), 450); else this.hideTip();
    });
    R.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]') && !e.relatedTarget?.closest?.('[data-tip]')) { clearTimeout(this._tipT); this.hideTip(); } });
    // hover-to-open
    R.addEventListener('mouseover', (e) => {
      if (this.cfg?.behavior.openOn !== 'hover' || this.editing) return;
      const t = this._tileOf(e.target);
      clearTimeout(this._hoverT);
      if (t && !t.def.noPanel && this.panel?.t !== t) this._hoverT = setTimeout(() => this.openPanel(t), 380);
    });
    this._bindDrag();
  }

  // re-render the Add tab while typing a search without losing the caret
  _bindDrag() {
    const bar = this.bar;
    this.root.addEventListener('pointerdown', (e) => {
      this._pressedIn = e.target.closest('.tile,.panel');
      // the bar is locked outside the Layout Editor
      if (!this.editing || e.button !== 0 || e.target.closest('input,textarea,select,.panel,.ctx,[data-rm],[data-cycle]')) return;
      const tileEl = e.target.closest('.tile');
      if (!e.target.closest('.dock')) return;
      this._drag = { x: e.clientX, y: e.clientY, tileEl, started: false, id: e.pointerId };
    });
    window.addEventListener('pointerup', () => {
      const wasPanel = this._pressedIn === this.panelEl; this._pressedIn = null;
      if (wasPanel && this._editorStale) { this._editorStale = false; setTimeout(() => this._renderEditor(), 0); }
    });
    this.root.addEventListener('pointermove', (e) => {
      const d = this._drag; if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.started) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        d.started = true;
        this.closeCtx(); this.hideTip();
        try { this.root.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
        if (d.tileEl) {
          d.mode = 'tile';
          d.items = [...bar.children];
          d.from = d.items.indexOf(d.tileEl);
          d.rects = d.items.map((x) => x.getBoundingClientRect());
          d.tileEl.classList.add('dragging');
          d.gap = parseFloat(getComputedStyle(bar).columnGap) || 4;
          this.root.classList.add('reordering');
        } else { d.mode = 'dock'; this.root.classList.add('moving'); d.ox = Number(this.cfg.layout.offsetX) || 0; }
      }
      if (d.mode === 'tile') {
        d.tileEl.style.transform = `translateX(${dx}px)`;
        const r0 = d.rects[d.from]; const c = r0.left + r0.width / 2 + dx;
        let to = d.from;
        d.rects.forEach((r, i) => { if (i < d.from && c < r.left + r.width / 2) to = Math.min(to, i); if (i > d.from && c > r.left + r.width / 2) to = Math.max(to, i); });
        d.to = to;
        const shift = r0.width + d.gap;
        d.items.forEach((x, i) => { if (x === d.tileEl) return; const s = d.from < to && i > d.from && i <= to ? -shift : d.from > to && i >= to && i < d.from ? shift : 0; x.style.transform = s ? `translateX(${s}px)` : ''; });
        this.glass.invalidate(100);
      } else if (d.mode === 'dock') {
        if (this.cfg.layout.mode === 'pill' && this.cfg.layout.align === 'center') this.root.style.setProperty('--dx', d.ox + dx + 'px');
        this.root.style.setProperty('--dy', Math.max(-60, Math.min(60, dy * 0.5)) + 'px');
        this.glass.invalidate(100);
      }
    });
    const finish = async (e) => {
      const d = this._drag; this._drag = null;
      if (!d || !d.started) return;
      this._suppressClick = true; setTimeout(() => { this._suppressClick = false; }, 60);
      this.root.classList.remove('reordering');
      if (d.mode === 'tile') {
        const visibleOrder = d.items.map((x) => x.dataset.uid);
        const [moved] = visibleOrder.splice(d.from, 1); visibleOrder.splice(d.to ?? d.from, 0, moved);
        d.items.forEach((x) => { x.style.transition = 'none'; x.style.transform = ''; });
        d.tileEl.classList.remove('dragging');
        if (d.to !== undefined && d.to !== d.from) {
          // keep hidden widgets where they were relative to their neighbours
          const byId = new Map(this.cfg.widgets.map((w) => [w.uid, w]));
          const result = []; let vi = 0;
          for (const w of this.cfg.widgets) result.push(byId.has(w.uid) && visibleOrder.includes(w.uid) ? byId.get(visibleOrder[vi++]) : w);
          visibleOrder.forEach((u) => bar.appendChild(this.tiles.get(u).el));
          this.selected = moved;
          await this.api.config.patch({ widgets: result });
        }
        requestAnimationFrame(() => d.items.forEach((x) => { x.style.transition = ''; }));
      } else {
        this.root.classList.remove('moving');
        this.root.style.setProperty('--dy', '0px');
        const patch = {};
        const nx = Math.round((Number(d.ox) || 0) + (e.clientX - d.x));
        if (this.cfg.layout.mode === 'pill' && this.cfg.layout.align === 'center' && Number.isFinite(nx)) patch.offsetX = nx;
        if (!this.preview) {
          const disp = await this.api.dock.display();
          const edge = e.screenY < disp.bounds.y + disp.bounds.height / 2 ? 'top' : 'bottom';
          if (edge !== this.cfg.layout.edge) patch.edge = edge;
        }
        if (Object.keys(patch).length) await this.api.config.patch({ layout: patch });
      }
      this.glass.invalidate(400);
    };
    this.root.addEventListener('pointerup', finish);
    this.root.addEventListener('pointercancel', finish);
  }
}

// the Layout Editor lives in editor.js
for (const k of Object.getOwnPropertyNames(EditorMixin.prototype)) if (k !== 'constructor') DockView.prototype[k] = EditorMixin.prototype[k];
