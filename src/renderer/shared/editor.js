// Layout Editor: arranging, adding and sizing widgets directly on the dock, bar spacing and saved
// layouts. Mixed into DockView (see the end of dock-view.js); "this" is the DockView instance.
import { icon, esc, slider, SIZE_LABEL } from './ui.js';
import { CATEGORIES } from '../widgets/index.js';

export class EditorMixin {
  openEditor(tab) {
    this.closeCtx(); this.hideTip();
    if (this.panel && this.panel.kind !== 'editor') { this._unsubPanel(); this.panel = null; for (const x of this.tiles.values()) x.el.classList.remove('open'); }
    if (!this.panel) this.panel = { kind: 'editor', tab: tab || 'arrange', cat: 'system', q: '', unsubs: [], subs: new Set() };
    else if (tab) this.panel.tab = tab;
    this.editing = true;
    this.root.classList.add('editing');
    this._reveal();
    this.panelEl.style.setProperty('--pw', 'min(780px, calc(100vw - 24px))');
    for (const t of this.tiles.values()) this._renderTile(t, true);
    this._renderEditor();
    this._showPanel(this.dockEl);
    if (!this.preview) this.api.dock.focus();
  }
  closeEditor() {
    if (this.panel?.kind === 'editor') { this._unsubPanel(); this.panel = null; this._fade(this.panelEl, false); }
    this.editing = false; this.selected = null;
    this.root.classList.remove('editing');
    for (const t of this.tiles.values()) { t.el.classList.remove('selected'); this._renderTile(t, true); }
    this.glass.invalidate(400);
    this._maybeAutohide();
  }
  selectTile(uid) {
    this.selected = this.selected === uid ? null : uid;
    for (const t of this.tiles.values()) t.el.classList.toggle('selected', this.selected === t.inst.uid);
    if (this.selected && this.panel?.tab !== 'arrange') this.panel.tab = 'arrange';
    this._renderEditor();
  }

  _renderEditor() {
    const p = this.panel; if (p?.kind !== 'editor') return;
    const a = document.activeElement;
    if (this.panelBody.contains(a) && a.matches('input[type=text],input[type=search],input:not([type])')) { this._editorStale = true; return; }
    if (this._pressedIn === this.panelEl) { this._editorStale = true; return; }
    const c = this.cfg;
    const profiles = c.profiles || [];
    const tabs = [['arrange', 'drag', 'Arrange'], ['add', 'plus', 'Add widgets'], ['bar', 'sliders', 'Bar & spacing']];
    let body = '';
    if (p.tab === 'add') body = this._editorAdd(p);
    else if (p.tab === 'bar') body = this._editorBar();
    else body = this._editorArrange();
    const scroll = this.panelBody.querySelector('.ed-body')?.scrollTop;
    this.panelBody.innerHTML = `<div class="pn editor">
      <div class="pn-head"><h3>${icon('edit', 17)} Layout Editor</h3>
        <span class="sub">Changes are saved automatically</span>
        <button class="btn primary" data-ed="done">${icon('checkSmall', 14)} Done</button></div>
      <div class="ed-profiles"><span class="ed-label">Layout</span>${profiles.map((x) => `<button class="chip ${x.id === c.activeProfile ? 'on' : ''}" data-ed="switch" data-v="${esc(x.id)}">${esc(x.name)}</button>`).join('')}
        <button class="chip ghost" data-ed="newLayout" data-tip="New layout from the current one">${icon('plus', 12)} New</button>
        <span class="ed-sp"></span>
        ${p.renaming ? `<input class="inp ed-name" data-ed-name value="${esc(profiles.find((x) => x.id === c.activeProfile)?.name || '')}" autofocus><button class="btn" data-ed="renameOk">Save name</button>`
          : `<button class="btn icon" data-ed="rename" data-tip="Rename layout">${icon('edit', 13)}</button><button class="btn icon" data-ed="duplicate" data-tip="Duplicate layout">${icon('copy', 13)}</button><button class="btn icon danger" data-ed="deleteLayout" data-tip="${this._confirmDelLayout ? 'Click again to delete this layout' : 'Delete layout'}" ${this._confirmDelLayout ? 'style="background:#ff453a;color:#fff"' : ''} ${profiles.length <= 1 ? 'disabled' : ''}>${icon('trash', 13)}</button>`}</div>
      <div class="pn-tabs">${tabs.map(([k, ic, l]) => `<button class="${p.tab === k ? 'on' : ''}" data-ed="tab" data-v="${k}">${icon(ic, 13)} ${l}</button>`).join('')}</div>
      <div class="ed-body">${body}</div></div>`;
    const b = this.panelBody.querySelector('.ed-body'); if (b && scroll) b.scrollTop = scroll;
    this._hydrate(this.panelBody);
    if (p.renaming) setTimeout(() => { const i = this.panelBody.querySelector('[data-ed-name]'); i?.focus(); i?.select(); }, 30);
  }

  _editorArrange() {
    const list = this.cfg.widgets;
    // a widget whose type no longer exists (old import) cannot be edited, only listed and removed
    const w = list.find((x) => x.uid === this.selected && this.reg.get(x.type));
    const hint = `<div class="ed-hint">${icon('drag', 14)}<span><b>Drag</b> widgets on the bar to reorder them, or drag an empty spot to move the whole bar (release in the top half to dock it at the top). <b>Click</b> a widget to select it. The <b>size badge</b> cycles Small / Medium / Large, <b>×</b> removes it.</span></div>`;
    if (!w) {
      return `${hint}<div class="ed-list">${list.map((x, i) => { const d = this.reg.get(x.type); return `<button class="ed-item ${x.enabled ? '' : 'off'}" data-ed="select" data-v="${x.uid}"><span class="ed-pos">${i + 1}</span>${d?.brand ? '' : `<span class="dim" style="display:flex">${icon(d?.icon || 'grid', 14)}</span>`}<span class="grow">${esc(d?.name || x.type)}</span>${x.enabled ? '' : '<span class="kbd">hidden</span>'}</button>`; }).join('')}</div>`;
    }
    const d = this.reg.get(w.type); const idx = list.indexOf(w);
    const size = w.size && w.size !== 'auto' && d.sizes.includes(w.size) ? w.size : d.size;
    return `<div class="ed-sel">
      <div class="ed-sel-head"><span class="glyph-tile" style="width:34px;height:34px;border-radius:10px">${icon(d.icon || 'grid', 17)}</span><div class="grow"><b>${esc(d.name)}</b><span>${esc(d.desc || '')}</span></div><button class="btn icon" data-ed="deselect" data-tip="Deselect">${icon('close', 13)}</button></div>
      <div class="ed-grid">
        <div class="ed-field"><span class="ed-label">Size</span><div class="seg">${d.sizes.map((s) => `<button class="${size === s ? 'on' : ''}" data-ed="size" data-v="${s}">${SIZE_LABEL[s]}</button>`).join('')}${d.sizes.length === 1 ? '<span class="kbd" style="padding:0 8px;align-self:center">Fixed size</span>' : ''}</div></div>
        <div class="ed-field"><span class="ed-label">Position</span><div class="ed-row"><button class="btn icon" data-ed="first" data-tip="Move to start" ${idx === 0 ? 'disabled' : ''}>⇤</button><button class="btn icon" data-ed="left" data-tip="Move left" ${idx === 0 ? 'disabled' : ''}>${icon('arrowLeft', 14)}</button>
          <input class="inp ed-num" type="number" min="1" max="${list.length}" value="${idx + 1}" data-ed-pos><span class="kbd">of ${list.length}</span>
          <button class="btn icon" data-ed="right" data-tip="Move right" ${idx === list.length - 1 ? 'disabled' : ''}>${icon('arrowRight', 14)}</button><button class="btn icon" data-ed="last" data-tip="Move to end" ${idx === list.length - 1 ? 'disabled' : ''}>⇥</button></div></div>
        <div class="ed-field"><span class="ed-label">Visibility</span><div class="seg"><button class="${w.enabled ? 'on' : ''}" data-ed="show">Shown</button><button class="${w.enabled ? '' : 'on'}" data-ed="hide">Hidden</button></div></div>
      </div>
      <div class="btns"><button class="btn" data-ed="widgetSettings">${icon('gear', 14)} Widget settings</button><button class="btn" data-ed="addAfter">${icon('plus', 14)} Add widget after this</button><span style="flex:1"></span><button class="btn danger" data-ed="remove">${icon('trash', 14)} Remove</button></div></div>`;
  }

  _editorAdd(p) {
    const q = (p.q || '').toLowerCase();
    const defs = [...this.reg.values()].filter((d) => (q ? (d.name + ' ' + d.desc).toLowerCase().includes(q) : d.cat === p.cat));
    const counts = Object.fromEntries(CATEGORIES.map(([k]) => [k, [...this.reg.values()].filter((d) => d.cat === k).length]));
    const used = (type) => this.cfg.widgets.filter((w) => w.type === type).length;
    // the previews show real values: subscribe to what the visible cards need while the tab is open
    for (const d of defs) for (const tp of d.topics || []) {
      if (p.subs.has(tp) || tp === 'startApps') continue;
      p.subs.add(tp);
      p.unsubs.push(this.hub.subscribe(tp, () => { clearTimeout(p.rt); p.rt = setTimeout(() => { if (this.panel === p && p.tab === 'add') this._renderEditor(); }, 500); }));
    }
    const sel = this.cfg.widgets.find((w) => w.uid === this.selected);
    return `<div class="ed-add-head"><input class="inp" type="search" placeholder="Search all widgets …" data-ed-q value="${esc(p.q || '')}"><span class="kbd">${sel ? `Inserts after “${esc(this.reg.get(sel.type)?.name || '')}”` : 'Inserts at the end of the bar'}</span></div>
      <div class="chips">${CATEGORIES.map(([k, label, ic]) => `<button class="chip ${!q && p.cat === k ? 'on' : ''}" data-ed="cat" data-v="${k}">${icon(ic, 12)} ${label} <span>${counts[k] || 0}</span></button>`).join('')}</div>
      <div class="gal-grid">${defs.map((d) => `<div class="gal-card" role="button" data-ed="add" data-v="${esc(d.type)}"><div class="gal-prev"><section class="tile ${d.bare ? 'bare' : ''}" data-size="${d.size}">${this._previewTile(d)}</section></div><div class="gal-meta"><b>${esc(d.name)}</b>${used(d.type) ? `<span class="gal-used">${used(d.type)}× in this layout</span>` : ''}<span>${esc(d.desc)}</span></div></div>`).join('')
        || (p.cat === 'custom' && !q ? `<div class="empty" style="grid-column:1/-1">Create your own widgets (link, JSON API value or text) in Settings → Widgets → Custom widgets.<br><br><button class="btn" data-ed="custom">Create a custom widget</button></div>` : '<div class="empty" style="grid-column:1/-1">No widgets match.</div>')}
        ${!q && p.cat === 'apps' ? `<div class="gal-card" role="button" data-ed="add" data-v="spacer"><div class="gal-prev"><span class="kbd">← flexible space →</span></div><div class="gal-meta"><b>Spacer</b><span>Pushes widgets apart in full-width mode.</span></div></div>` : ''}</div>`;
  }

  _editorBar() {
    const L = this.cfg.layout;
    const field = (label, ctl) => `<div class="ed-field"><span class="ed-label">${label}</span>${ctl}</div>`;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(L[key]) === String(v) ? 'on' : ''}" data-ed="layout" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const rng = (key, min, max, unit = 'px') => `<div class="ed-rng">${slider(L[key], `data-ed-rng="${key}"`, { min, max, cls: 'sm' })}<span class="val num">${L[key]}${unit}</span></div>`;
    return `<div class="ed-grid">
      ${field('Position', seg('edge', [['bottom', 'Bottom'], ['top', 'Top']]))}
      ${field('Shape', seg('mode', [['pill', 'Floating pill'], ['full', 'Full width']]))}
      ${field('Alignment', seg('align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]))}
      ${field('Height', seg('size', [['S', 'S · 46'], ['M', 'M · 54'], ['L', 'L · 64'], ['custom', 'Custom']]))}
      ${L.size === 'custom' ? field('Custom height', rng('height', 40, 96)) : ''}
      ${field('Max width (pill, 0 = fit)', rng('maxWidth', 0, 3000))}
      ${field('Widget spacing', rng('gap', 0, 16))}
      ${field('Inner padding', rng('padding', 0, 12))}
      ${field('Distance to screen edge', rng('margin', 0, 40))}
      ${L.mode === 'pill' && L.align === 'center' ? field('Horizontal offset', rng('offsetX', -900, 900)) : ''}
    </div>
    <div class="btns" style="margin-top:4px"><button class="btn ${this._confirmReset ? 'danger' : ''}" data-ed="reset">${icon('refresh', 14)} ${this._confirmReset ? 'Click again to reset this layout' : 'Reset layout to defaults'}</button></div>`;
  }

  async _editorAction(el) {
    const d = el.dataset; const act = d.ed; const api = this.api;
    const sel = this.selected; const list = this.cfg.widgets; const idx = list.findIndex((w) => w.uid === sel);
    if (act !== 'reset') this._confirmReset = false;
    if (act !== 'deleteLayout') this._confirmDelLayout = false;
    switch (act) {
      case 'done': return this.closeEditor();
      case 'tab': this.panel.tab = d.v; return this._renderEditor();
      case 'cat': this.panel.cat = d.v; this.panel.q = ''; return this._renderEditor();
      case 'switch': this.selected = null; return api.config.layout('switch', { id: d.v });
      case 'newLayout': return api.config.layout('create', { name: `Layout ${(this.cfg.profiles || []).length + 1}` }).then(() => { this.panel.renaming = true; this._renderEditor(); });
      case 'duplicate': return api.config.layout('create', { name: `${(this.cfg.profiles || []).find((x) => x.id === this.cfg.activeProfile)?.name || 'Layout'} copy` });
      case 'rename': this.panel.renaming = true; return this._renderEditor();
      case 'renameOk': { const v = this.panelBody.querySelector('[data-ed-name]')?.value.trim(); this.panel.renaming = false; if (v) await api.config.layout('rename', { id: this.cfg.activeProfile, name: v }); return this._renderEditor(); }
      case 'deleteLayout':
        if (!this._confirmDelLayout) { this._confirmDelLayout = true; return this._renderEditor(); }
        this._confirmDelLayout = false;
        return api.config.layout('delete', { id: this.cfg.activeProfile }).catch((e) => this.toast(e.message));
      case 'select': return this.selectTile(d.v);
      case 'deselect': return this.selectTile(this.selected);
      case 'size': return this.saveWidget(sel, { size: d.v });
      case 'first': return this.moveWidget(sel, 0);
      case 'left': return this.moveWidget(sel, idx - 1);
      case 'right': return this.moveWidget(sel, idx + 1);
      case 'last': return this.moveWidget(sel, list.length - 1);
      case 'show': return this.saveWidget(sel, { enabled: true });
      case 'hide': return this.saveWidget(sel, { enabled: false });
      case 'remove': return this.removeWidget(sel);
      case 'widgetSettings': return api.openSettings('widget:' + sel);
      case 'addAfter': this.panel.tab = 'add'; return this._renderEditor();
      case 'add': return this.addWidget(d.v, sel);
      case 'custom': return api.openSettings('custom');
      case 'layout': return api.config.patch({ layout: { [d.k]: d.v } });
      case 'reset':
        if (!this._confirmReset) { this._confirmReset = true; return this._renderEditor(); }
        this._confirmReset = false; this.selected = null;
        return api.config.reset('layout').then(() => this.toast('Layout reset to defaults'));
      default: return null;
    }
  }

  _previewTile(def) {
    const fake = { inst: { uid: 'preview-' + def.type.replace(/[^a-z0-9]/gi, ''), type: def.type, settings: {} }, def, data: {}, state: {} };
    const ctx = this._makeCtx(fake);
    for (const tp of def.topics || []) fake.data[tp] = this.hub.peek(tp);
    if ((def.topics || []).includes('clock')) fake.data.clock = Date.now();
    try { return def.tile(ctx, fake.data); } catch { return `<div class="tin">${icon(def.icon || 'grid', 20)}</div>`; }
  }


  _editorQuery(pos, keep) {
    this._renderEditor();
    if (keep) { const i = this.panelBody.querySelector('[data-ed-q]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
  }
}
