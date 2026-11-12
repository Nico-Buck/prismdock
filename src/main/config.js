// Local persistence: config.json (settings + layout), data.json (widget content),
// secrets.bin (API keys, encrypted with Windows DPAPI through Electron safeStorage).
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DIR = () => app.getPath('userData');
const FILE = (n) => path.join(DIR(), n);

let uidCounter = Date.now();
const uid = (type) => `${type}-${(uidCounter++).toString(36)}`;

function defaultWidgets() {
  const list = [
    ['winkey', {}],
    ['apps', { showStart: false }],
    ['claude', {}],
    ['cpu', {}],
    ['ram', {}],
    ['nowplaying', {}],
    ['calendar', {}],
    ['weather', {}],
    ['volume', {}],
    ['battery', {}],
    ['clock', {}],
  ];
  return list.map(([type, settings]) => ({ uid: uid(type), type, enabled: true, size: 'auto', settings }));
}

const DEFAULTS = () => ({
  version: 4,
  appearance: {
    theme: 'glass',
    custom: {
      tint: '#141416', tintOpacity: 0.42, blur: 26, saturation: 1.7, brightness: 1.0,
      refraction: 0.55, specular: 0.55, chroma: 0.25, radius: 22, tileRadius: 18,
      border: '#ffffff', borderOpacity: 0.12, rim: 0.5, shadow: 0.45,
      tile: '#000000', tileOpacity: 0.18, text: '#f5f5f7', accent: '#0a84ff',
    },
    animations: true,
    animSpeed: 1,
    iconSize: 37,
    fontScale: 1,
    glassEngine: 'wallpaper', // wallpaper | flat
  },
  layout: {
    edge: 'bottom', // bottom | top
    mode: 'pill', // pill | full
    size: 'M', // S | M | L | custom
    height: 54,
    maxWidth: 0, // 0 = fit content
    margin: 6,
    gap: 3,
    padding: 3,
    align: 'center', // left | center | right
    offsetX: 0,
  },
  behavior: {
    autohide: false, // default for displays without their own choice
    autohidePer: {}, // display key -> true (show only on hover) | false
    autohideDelay: 700,
    hoverEffect: 'lift', // lift (subtle highlight) | none
    openOn: 'click', // click | hover
    closeOnBlur: true,
    startWithWindows: false,
    monitors: 'all', // all | primary | custom
    monitorList: [], // display keys for 'custom'
    hideTaskbar: true,
    reserveSpace: true,
    clock24: true,
    fullscreenHide: true,
  },
  widgets: defaultWidgets(),
  integrations: {
    weather: { city: 'Berlin', lat: 52.52, lon: 13.405, unit: 'celsius' },
    github: { user: '' },
    leetcode: { user: '' },
    calendarIcs: { url: '' },
    linear: {},
    supabase: { projectRef: '' },
    youtube: { channelId: '' },
    instagram: {},
    tiktok: {},
    x: { user: '' },
    stripe: {},
    paypal: { clientId: '', sandbox: false },
    shopify: { domain: '' },
    revenueGoal: 5000,
    spotify: { clientId: '' },
  },
  performance: {
    powerSaver: false,
    intervals: { system: 1500, network: 1000, media: 1500, windows: 2000, weather: 900, online: 300 },
    screenTime: true,
  },
  customWidgets: [],
  // saved layouts; the active one is mirrored in .widgets/.layout above
  profiles: [],
  activeProfile: 'default',
});
const PROFILE_KEYS = ['widgets', 'layout'];

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// Repairs what a bad write, a hand edit or an old export can leave behind: sections that are not objects,
// lists that are not arrays and numbers that are not finite fall back to their defaults.
function sanitize(c) {
  const d = DEFAULTS();
  for (const [sec, v] of Object.entries(d)) {
    if (isObj(v) && !isObj(c[sec])) c[sec] = v;
    else if (Array.isArray(v) && !Array.isArray(c[sec])) c[sec] = v;
  }
  if (!isObj(c.performance.intervals)) c.performance.intervals = d.performance.intervals;
  c.widgets = c.widgets.filter((w) => isObj(w) && typeof w.type === 'string');
  for (const w of c.widgets) { if (!w.uid) w.uid = uid(w.type); if (!isObj(w.settings)) w.settings = {}; }
  c.profiles = c.profiles.filter((p) => isObj(p) && p.id && Array.isArray(p.widgets));
  for (const sec of ['layout', 'appearance', 'behavior']) for (const [k, v] of Object.entries(d[sec])) if (typeof v === 'number' && !Number.isFinite(c[sec]?.[k])) c[sec][k] = v;
  for (const [k, v] of Object.entries(d.performance.intervals)) if (!Number.isFinite(c.performance?.intervals?.[k])) c.performance.intervals[k] = v;
  return c;
}

// v1 -> v2: compact proportions, dedicated Windows-key widget, taskbar replacement on
function migrate(c) {
  if ((c.version || 1) < 2) {
    if (c.layout) { if (c.layout.height > 60) c.layout.height = 54; c.layout.padding = 3; c.layout.gap = 3; if (c.layout.margin > 6) c.layout.margin = 6; }
    if (Array.isArray(c.widgets) && !c.widgets.some((w) => w.type === 'winkey')) {
      c.widgets = c.widgets.map((w) => (w.type === 'apps' ? { ...w, settings: { ...(w.settings || {}), showStart: false } } : w));
      c.widgets.unshift({ uid: uid('winkey'), type: 'winkey', enabled: true, size: 'auto', settings: {} });
    }
    c.behavior = { ...(c.behavior || {}), hideTaskbar: true, reserveSpace: true };
    c.version = 2;
  }
  // v2 -> v3: a dock on every monitor; the Start button becomes a real capsule tile
  if (c.version < 3) {
    c.behavior = { ...(c.behavior || {}), monitors: 'all' };
    if (Array.isArray(c.widgets) && !c.widgets.some((w) => w.type === 'winkey')) c.widgets.unshift({ uid: uid('winkey'), type: 'winkey', enabled: true, size: 'auto', settings: {} });
    for (const p of c.profiles || []) if (Array.isArray(p.widgets) && !p.widgets.some((w) => w.type === 'winkey')) p.widgets.unshift({ uid: uid('winkey'), type: 'winkey', enabled: true, size: 'auto', settings: {} });
    c.version = 3;
  }
  // v3 -> v4: the glow hover effect was removed (calm interactions); it becomes the subtle highlight
  if (c.version < 4) {
    if (c.behavior?.hoverEffect === 'glow') c.behavior.hoverEffect = 'lift';
    c.version = 4;
  }
  return c;
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(FILE(name), 'utf8')); } catch { return fallback; }
}

// Atomic write: write temp file, then rename over the old one.
function writeJson(name, obj) {
  fs.mkdirSync(DIR(), { recursive: true });
  const tmp = FILE(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, FILE(name));
}

class Store {
  constructor() {
    this._timers = {};
    this.firstRun = !fs.existsSync(FILE('config.json'));
    const raw0 = readJson('config.json', {});
    const raw = isObj(raw0) ? raw0 : {};
    const wasOld = (raw.version || 1) < 4 && Object.keys(raw).length > 0;
    this.config = sanitize(deepMerge(DEFAULTS(), migrate(raw)));
    this._ensureProfiles();
    const data = readJson('data.json', {});
    this.data = isObj(data) ? data : {};
    this.secrets = this._loadSecrets();
    if (wasOld) this.saveConfig(); // persist the migrated config right away
  }
  // a save can fail for a moment (antivirus or the indexer holds the file): retry instead of throwing
  // inside a timer, which Electron would show as an error dialog
  _debounced(name, fn, delay = 250, tries = 3) {
    clearTimeout(this._timers[name]);
    this._timers[name] = setTimeout(() => {
      try { fn(); } catch (e) {
        console.warn(`saving ${name} failed:`, e.code || e.message);
        if (tries > 1) this._debounced(name, fn, 2000, tries - 1);
      }
    }, delay);
  }
  saveConfig() { this._debounced('config', () => writeJson('config.json', this.config)); }
  saveData() { this._debounced('data', () => writeJson('data.json', this.data)); }
  flush() {
    for (const t of Object.values(this._timers)) clearTimeout(t);
    for (const [n, v] of [['config.json', this.config], ['data.json', this.data]]) try { writeJson(n, v); } catch (e) { console.warn('saving', n, 'failed:', e.code || e.message); }
  }
  patch(p) { this.config = sanitize(deepMerge(this.config, p)); if (PROFILE_KEYS.some((k) => k in p)) this._syncProfile(); this.saveConfig(); return this.config; }
  replace(c) { this.config = sanitize(deepMerge(DEFAULTS(), migrate(isObj(c) ? c : {}))); this._ensureProfiles(); this.saveConfig(); return this.config; }
  reset(section) {
    const d = DEFAULTS();
    if (section === 'layout') { this.config.layout = d.layout; this.config.widgets = d.widgets; this._syncProfile(); }
    else if (section && d[section] !== undefined) { this.config[section] = d[section]; if (PROFILE_KEYS.includes(section)) this._syncProfile(); }
    else {
      // the saved layouts stay; the defaults go into the active one, not into "Default"
      const keepProfiles = this.config.profiles; const keepActive = this.config.activeProfile;
      this.config = d; this.config.activeProfile = keepActive;
      // custom widgets are reset too: drop them from the kept layouts
      this.config.profiles = keepProfiles.map((p) => ({ ...p, widgets: (p.widgets || []).filter((w) => !String(w.type).startsWith('custom:')) }));
      this._ensureProfiles(); this._syncProfile();
    }
    this.saveConfig();
    return this.config;
  }

  // ---- layout profiles ----
  _ensureProfiles() {
    const c = this.config;
    if (!Array.isArray(c.profiles) || !c.profiles.length) c.profiles = [{ id: 'default', name: 'Default', widgets: c.widgets, layout: c.layout }];
    if (!c.profiles.some((p) => p.id === c.activeProfile)) c.activeProfile = c.profiles[0].id;
  }
  _syncProfile() {
    const c = this.config; const p = c.profiles.find((x) => x.id === c.activeProfile);
    for (const q of c.profiles) if (q.layout) for (const [k, v] of Object.entries(DEFAULTS().layout)) if (typeof v === 'number' && !Number.isFinite(q.layout[k])) q.layout[k] = v;
    if (p) { p.widgets = JSON.parse(JSON.stringify(c.widgets)); p.layout = JSON.parse(JSON.stringify(c.layout)); }
  }
  profileAction(action, a = {}) {
    const c = this.config;
    this._syncProfile();
    if (action === 'switch') {
      const p = c.profiles.find((x) => x.id === a.id); if (!p) throw new Error('Unknown layout');
      c.activeProfile = p.id; c.widgets = JSON.parse(JSON.stringify(p.widgets)); c.layout = deepMerge(DEFAULTS().layout, p.layout);
    } else if (action === 'create') {
      const src = a.blank ? DEFAULTS() : c;
      const p = { id: 'l' + Date.now().toString(36), name: (a.name || 'New layout').slice(0, 40), widgets: JSON.parse(JSON.stringify(src.widgets)).map((w) => ({ ...w, uid: uid(w.type) })), layout: JSON.parse(JSON.stringify(src.layout)) };
      c.profiles.push(p); c.activeProfile = p.id; c.widgets = p.widgets; c.layout = p.layout;
    } else if (action === 'rename') {
      const p = c.profiles.find((x) => x.id === a.id); if (p && a.name) p.name = a.name.slice(0, 40);
    } else if (action === 'delete') {
      if (c.profiles.length <= 1) throw new Error('At least one layout is required');
      c.profiles = c.profiles.filter((x) => x.id !== a.id);
      if (c.activeProfile === a.id) return this.profileAction('switch', { id: c.profiles[0].id });
    }
    sanitize(c);
    this.saveConfig();
    return c;
  }
  defaults() { return DEFAULTS(); }

  // ---- secrets ----
  _loadSecrets() {
    try {
      const buf = fs.readFileSync(FILE('secrets.bin'));
      if (!safeStorage.isEncryptionAvailable()) return {};
      return JSON.parse(safeStorage.decryptString(buf));
    } catch { return {}; }
  }
  _saveSecrets() {
    fs.mkdirSync(DIR(), { recursive: true });
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption (DPAPI) is not available');
    fs.writeFileSync(FILE('secrets.bin'), safeStorage.encryptString(JSON.stringify(this.secrets)));
  }
  setSecret(key, value) {
    if (value) this.secrets[key] = value; else delete this.secrets[key];
    this._saveSecrets();
  }
  getSecret(key) { return this.secrets[key] || ''; }
  secretKeys() { return Object.keys(this.secrets); }

  // ---- export / import (secrets are never exported) ----
  exportBundle() {
    return { app: 'PrismDock', exportedAt: new Date().toISOString(), config: this.config, data: this.data };
  }
  importBundle(b) {
    if (!b || b.app !== 'PrismDock' || !isObj(b.config)) throw new Error('This is not a valid PrismDock configuration file');
    // an export of an older version goes through the same migration and repair as a config on disk
    this.config = sanitize(deepMerge(DEFAULTS(), migrate(JSON.parse(JSON.stringify(b.config)))));
    this._ensureProfiles();
    if (isObj(b.data)) this.data = b.data;
    this.saveConfig(); this.saveData();
    return this.config;
  }
}

module.exports = { Store, uid, DEFAULTS, sanitize, migrate, deepMerge };
