// Local data providers. Every provider is pull-based and cached, so nothing runs
// unless a widget that needs it is on the dock.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');
const native = require('./native/bridge');

const cache = new Map(); // key -> { at, value, promise }
const mediaDir = () => { const d = path.join(app.getPath('userData'), 'media'); fs.mkdirSync(d, { recursive: true }); return d; };
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  const now = Date.now();
  if (c && c.value !== undefined && now - c.at < ttl) return c.value;
  if (c && c.promise) return c.promise;
  const promise = fn().then((value) => { cache.set(key, { at: Date.now(), value }); return value; })
    .catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { ...(c || {}), promise });
  return promise;
}
// merges pushed fields into a cached value (e.g. live volume) and returns it, or null if nothing is cached yet
const patchCached = (key, fields) => { const c = cache.get(key); if (!c || c.value === undefined) return null; c.value = { ...c.value, ...fields }; c.at = Date.now(); return c.value; };
const invalidate = (prefix) => { for (const k of [...cache.keys()]) if (k === prefix || k.startsWith(prefix + ':')) cache.delete(k); };

const history = { cpu: [], gpu: [], rx: [], tx: [], mem: [] };
const pushHist = (k, v, n = 48) => { history[k].push(v); if (history[k].length > n) history[k].shift(); };

// ---------- system ----------
let lastNet = null;
const sys = {
  cpu: () => cached('cpu', 900, async () => {
    const pct = await native.call('cpu');
    pushHist('cpu', pct);
    return { pct, cores: os.cpus().length, model: os.cpus()[0]?.model?.trim(), history: history.cpu };
  }),
  mem: () => cached('mem', 1500, async () => {
    const m = await native.call('mem');
    const used = m.total - m.free;
    const pct = (used / m.total) * 100;
    pushHist('mem', pct);
    return { total: m.total, used, pct, history: history.mem };
  }),
  gpu: () => cached('gpu', 1500, async () => {
    const pct = await native.call('gpu', {}, 15000);
    if (pct >= 0) pushHist('gpu', pct);
    const nv = await nvidia();
    return { pct: pct >= 0 ? pct : (nv ? nv.util : null), temp: nv ? nv.temp : null, name: nv ? nv.name : null, history: history.gpu };
  }),
  temps: () => cached('temps', 3000, async () => {
    const zones = await native.call('thermal').catch(() => []);
    const nv = await nvidia();
    const cpu = zones && zones.length ? Math.max(...zones) : null;
    return { cpu, zones, gpu: nv ? nv.temp : null, source: zones?.length ? 'ACPI Thermal Zone' : null };
  }),
  net: () => cached('net', 900, async () => {
    const n = await native.call('net');
    const now = Date.now();
    let down = 0, up = 0;
    if (lastNet) {
      const dt = (now - lastNet.at) / 1000;
      down = Math.max(0, (n.rx - lastNet.rx) / dt);
      up = Math.max(0, (n.tx - lastNet.tx) / dt);
    }
    lastNet = { ...n, at: now };
    pushHist('rx', down); pushHist('tx', up);
    return { down, up, rxHistory: history.rx, txHistory: history.tx };
  }),
  disks: () => cached('disks', 30000, () => native.call('disks')),
  battery: () => cached('battery', 5000, async () => {
    const b = await native.call('battery');
    const present = b.percent !== 255 && !(b.flag & 128);
    return { present, percent: present ? b.percent : null, charging: !!(b.flag & 8) || (present && b.ac === 1), ac: b.ac === 1, saver: !!b.saver, secondsLeft: b.secondsLeft };
  }),
  wifi: () => cached('wifi', 5000, () => native.call('wifi')),
  radios: () => cached('radios', 4000, () => native.call('radios').catch(() => [])),
  volume: () => cached('volume', 700, () => native.call('volume')),
  audioDevices: () => cached('audioDevices', 3000, () => native.call('audioDevices')),
  audioSessions: () => cached('audioSessions', 900, () => native.call('audioSessions')),
  brightness: () => cached('brightness', 4000, () => native.call('brightness', {}, 10000)),
  recycle: () => cached('recycle', 5000, () => native.call('recycle')),
  // the cover is written to <userData>/media by the helper (only when it changes) and served as app://prism/__media/<file>
  media: () => cached('media', 900, async () => {
    const m = await native.call('media', { dir: mediaDir() }).catch(() => ({ active: false }));
    if (m.cover) m.coverUrl = 'app://prism/__media/' + m.cover;
    return m;
  }),
};

// nvidia-smi gives real GPU temperature on NVIDIA systems; checked once.
let nvPath; let nvCache = { at: 0, v: null };
function nvidia() {
  if (nvPath === null) return Promise.resolve(null);
  if (Date.now() - nvCache.at < 2500) return Promise.resolve(nvCache.v);
  const candidates = ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe'];
  return new Promise((resolve) => {
    execFile(nvPath || candidates[0], ['--query-gpu=name,temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000 }, (err, out) => {
      if (err) { nvPath = null; return resolve(null); }
      nvPath = nvPath || candidates[0];
      const [name, temp, util] = String(out).split('\n')[0].split(',').map((s) => s.trim());
      nvCache = { at: Date.now(), v: { name, temp: Number(temp), util: Number(util) } };
      resolve(nvCache.v);
    });
  });
}

// ---------- icons ----------
const iconCache = new Map();
async function icon(p, size = 96) {
  if (!p) return null;
  const key = p.toLowerCase() + '|' + size;
  if (iconCache.has(key)) return iconCache.get(key);
  if (iconCache.size > 400) iconCache.delete(iconCache.keys().next().value); // oldest first
  let url = null;
  try {
    const b64 = await native.call('icon', { path: p, size }, 6000);
    if (b64) url = 'data:image/png;base64,' + b64;
  } catch { /* fall through */ }
  if (!url) {
    try { url = (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch { url = null; }
  }
  iconCache.set(key, url);
  return url;
}

// ---------- apps / windows ----------
async function windows() {
  return cached('windows', 1200, async () => {
    const list = await native.call('windows', { selfPid: process.pid });
    return list.filter((w) => w.exe && !/\\(ApplicationFrameHost|ShellExperienceHost|SearchHost|StartMenuExperienceHost)\.exe$/i.test(w.exe));
  });
}

function walk(dir, out, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) walk(p, out, depth + 1);
    else if (/\.(lnk|url)$/i.test(e.name) && !/uninstall|deinstall|readme|help|hilfe/i.test(e.name)) out.push({ name: e.name.replace(/\.(lnk|url)$/i, ''), path: p });
  }
}
function startApps() {
  return cached('startApps', 5 * 60 * 1000, async () => {
    const out = [];
    walk(path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'), out);
    walk(path.join(process.env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs'), out);
    const seen = new Set();
    return out.filter((a) => { const k = a.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

function recent() {
  return cached('recent', 15000, async () => {
    const dir = path.join(process.env.APPDATA, 'Microsoft\\Windows\\Recent');
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.lnk'))
        .map((f) => { const p = path.join(dir, f); return { name: f.slice(0, -4), path: p, mtime: fs.statSync(p).mtimeMs }; });
    } catch { /* none */ }
    return files.sort((a, b) => b.mtime - a.mtime).slice(0, 20);
  });
}

// ---------- screen time (foreground app sampling) ----------
let stTimer = null; let stSaved = 0;
function startScreenTime(store) {
  if (stTimer) return;
  const STEP = 5;
  stTimer = setInterval(async () => {
    try {
      const f = await native.call('foreground');
      if (f.idleMs > 120000 || !f.exe) return;
      const exe = path.basename(f.exe).replace(/\.exe$/i, '');
      const d = new Date();
      const day = d.toISOString().slice(0, 10);
      const st = (store.data.screentime ||= {});
      const rec = (st[day] ||= { total: 0, hours: Array(24).fill(0), apps: {}, paths: {} });
      rec.total += STEP;
      rec.hours[d.getHours()] += STEP;
      rec.apps[exe] = (rec.apps[exe] || 0) + STEP;
      rec.paths[exe] = f.exe;
      const days = Object.keys(st).sort();
      while (days.length > 30) delete st[days.shift()];
      // sampled every 5 s, written to disk at most once a minute
      if (Date.now() - stSaved > 60000) { stSaved = Date.now(); store.saveData(); }
    } catch { /* helper busy */ }
  }, STEP * 1000);
}
function stopScreenTime() { clearInterval(stTimer); stTimer = null; }

// ---------- AI usage read from local CLI logs ----------
// Claude Code writes ~/.claude/projects/**/<session>.jsonl, Codex CLI writes ~/.codex/sessions/**/rollout-*.jsonl
const fileAgg = new Map(); // path -> { mtime, size, entries: [[ts, tokens]], rate }
function scanJsonl(root, parseLine, maxAgeDays = 8) {
  const files = [];
  const cutoff = Date.now() - maxAgeDays * 864e5;
  (function rec(dir, depth) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 5) rec(p, depth + 1);
      else if (e.name.endsWith('.jsonl')) {
        try { const s = fs.statSync(p); if (s.mtimeMs > cutoff) files.push([p, s]); } catch { /* skip */ }
      }
    }
  })(root, 0);
  const result = [];
  for (const [p, st] of files) {
    let agg = fileAgg.get(p);
    // logs are append-only: on growth read just the new bytes; on anything else start over
    if (!agg || st.size < agg.offset) agg = { offset: 0, mtime: 0, entries: [], rest: '' };
    if (agg.mtime !== st.mtimeMs || agg.offset !== st.size) {
      readLines(p, agg, st.size, parseLine);
      agg.mtime = st.mtimeMs;
      fileAgg.set(p, agg);
    }
    result.push(...agg.entries);
  }
  // forget logs that aged out or were deleted, so the cache does not grow over weeks of uptime
  const current = new Set(files.map(([p]) => p));
  for (const k of fileAgg.keys()) if (k.startsWith(root) && !current.has(k)) fileAgg.delete(k);
  return result;
}

// Reads [agg.offset, size) in 1 MB chunks and feeds complete lines to parseLine.
function readLines(p, agg, size, parseLine) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(1 << 20);
    while (agg.offset < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - agg.offset), agg.offset);
      if (n <= 0) break;
      agg.offset += n;
      const lines = (agg.rest + buf.toString('utf8', 0, n)).split('\n');
      agg.rest = lines.pop();
      for (const line of lines) { if (!line) continue; const r = parseLine(line); if (r && r.ts) agg.entries.push(r); }
    }
  } catch { /* unreadable or locked */ } finally { if (fd !== undefined) fs.closeSync(fd); }
  // keep only what the summaries need (last 8 days)
  const cutoff = Date.now() - 8 * 864e5;
  if (agg.entries.length && agg.entries[0].ts < cutoff) agg.entries = agg.entries.filter((e) => e.ts >= cutoff);
}

function summarize(entries) {
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const sum = (from) => entries.filter((e) => e.ts >= from).reduce((a, e) => a + (e.tokens || 0), 0);
  const models = {};
  for (const e of entries) if (e.ts >= now - 7 * 864e5 && e.model) models[e.model] = (models[e.model] || 0) + (e.tokens || 0);
  const top = Object.entries(models).sort((a, b) => b[1] - a[1])[0];
  // a "session" block = 5h starting at the first message after a 5h gap (same idea as the plan windows)
  const sorted = entries.map((e) => e.ts).sort((a, b) => a - b);
  let blockStart = null;
  for (const t of sorted) if (blockStart === null || t - blockStart >= 5 * 3600e3) blockStart = t;
  const blockActive = blockStart !== null && now - blockStart < 5 * 3600e3;
  return {
    session: blockActive ? sum(blockStart) : 0,
    sessionResetsAt: blockActive ? blockStart + 5 * 3600e3 : null,
    today: sum(startOfDay.getTime()),
    week: sum(now - 7 * 864e5),
    topModel: top ? top[0] : null,
    messages: entries.filter((e) => e.ts >= startOfDay.getTime()).length,
  };
}

function aiLocal() {
  return cached('aiLocal', 60000, async () => {
    const home = os.homedir();
    const out = {};
    const claudeDir = path.join(home, '.claude', 'projects');
    if (fs.existsSync(claudeDir)) {
      const entries = scanJsonl(claudeDir, (line) => {
        if (!line.includes('"usage"')) return null;
        try {
          const j = JSON.parse(line);
          const u = j.message && j.message.usage;
          if (!u) return null;
          return { ts: Date.parse(j.timestamp), model: j.message.model, tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) };
        } catch { return null; }
      });
      out.claude = { source: 'Claude Code (~/.claude)', ...summarize(entries) };
    }
    const codexDir = path.join(home, '.codex', 'sessions');
    if (fs.existsSync(codexDir)) {
      let rate = null; let rateTs = 0;
      const entries = scanJsonl(codexDir, (line) => {
        if (!line.includes('token_count')) return null;
        try {
          const j = JSON.parse(line);
          const p = j.payload || j;
          const ts = Date.parse(j.timestamp);
          if (p.rate_limits && ts > rateTs) { rate = p.rate_limits; rateTs = ts; }
          const last = p.info && p.info.last_token_usage;
          return { ts, tokens: last ? (last.input_tokens || 0) + (last.output_tokens || 0) : 0 };
        } catch { return null; }
      });
      out.codex = { source: 'Codex CLI (~/.codex)', ...summarize(entries), rate, rateAt: rateTs || null };
    }
    return out;
  });
}

module.exports = { mediaDir, sys, icon, windows, startApps, recent, aiLocal, startScreenTime, stopScreenTime, invalidate, patchCached, cached };
