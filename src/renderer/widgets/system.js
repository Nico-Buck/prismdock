import { icon, ring, gauge, bar, meter, slider, fmtBytes, fmtRate, C, esc, clamp, fmtDur } from '../shared/ui.js';
import { lineChart, dualLineChart, spark } from '../shared/graph.js';

const HIST = 48; // samples kept by the main process (providers.js)

const pctColor = (p) => (p > 85 ? C.red : p > 65 ? C.orange : C.green);
const loading = '<div class="empty">Loading…</div>';
const na = (what) => `<div class="pn-muted">${what}</div>`;
// geometry in tile units, so rings and gauges follow the bar height
const P = (ctx, n) => Math.round(n * ctx.u);
const pct = (v) => (v == null ? '–' : Math.round(v) + '%');

// square tile with a usage ring (CPU, RAM, GPU, disk)
const ringTile = (ctx, value, color, label) => `<div class="tin sq">${ring(value ?? 0, { size: P(ctx, 46), stroke: Math.max(3, P(ctx, 4.5)), color, label: pct(value), sub: label })}</div>`;
// medium tile: ring + label + sparkline/sub
const ringWide = (ctx, value, color, label, extra) => `<div class="tin tight">${ring(value ?? 0, { size: P(ctx, 40), stroke: Math.max(3, P(ctx, 4)), color, label: pct(value) })}<div class="col" style="gap:calc(6px*var(--u))"><span class="t-label">${label}</span>${extra}</div></div>`;

// ---------- sound ----------
let volT = null;
const setVol = (ctx, flow, level) => { clearTimeout(volT); volT = setTimeout(() => ctx.act('volume', { level, flow }), 30); };
const sessionIcon = (s) => (s.system ? `<span class="ph dim">${icon('volume', 18)}</span>` : `<img data-icon="${esc(s.exe)}">`);

function soundPanel(ctx, { volume: v, audioDevices: dev, audioSessions: ses }) {
  const tab = ctx.state.tab || 'sound';
  const tabs = `<div class="pn-tabs">${[['sound', 'volume', 'Sound'], ['devices', 'headphones', 'Devices'], ['mixer', 'sliders', 'Mixer']].map(([k, ic, l]) => `<button class="${tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${icon(ic, 13)} ${l}</button>`).join('')}</div>`;
  let body = '';
  if (!v) body = loading;
  else if (tab === 'sound') {
    const muted = v.muted || v.level === 0;
    body = `<div class="pn-sec"><h4>Output</h4><div class="pn-muted" style="margin-top:-4px">${esc(v.device || 'No output device')}</div>
        <div class="ctl-row"><button class="ibtn ${muted ? 'warn' : ''}" data-a="mute" data-tip="${muted ? 'Unmute' : 'Mute'}">${icon(muted ? 'mute' : 'volume', 16)}</button>${slider(v.level, 'data-input="out"')}<span class="val">${v.muted ? 'Muted' : v.level + '%'}</span></div></div>
      ${v.micLevel >= 0 ? `<div class="pn-sec"><h4>Input</h4><div class="pn-muted" style="margin-top:-4px">${esc(v.mic || 'Microphone')}</div>
        <div class="ctl-row"><button class="ibtn ${v.micMuted ? 'warn' : ''}" data-a="micMute">${icon(v.micMuted ? 'micOff' : 'mic', 16)}</button>${slider(v.micLevel, 'data-input="in"')}<span class="val">${v.micMuted ? 'Muted' : v.micLevel + '%'}</span></div></div>` : ''}`;
  } else if (tab === 'devices') {
    const list = (items, kind) => (items || []).map((d) => `<div class="dev ${d.isDefault ? 'on' : ''}" data-a="device" data-v="${esc(d.id)}"><span class="dim">${icon(kind === 'out' ? 'volume' : 'mic', 15)}</span><span class="grow">${esc(d.name)}</span><span class="ok">${d.isDefault ? icon('checkSmall', 15) : ''}</span></div>`).join('') || '<div class="pn-muted">None found.</div>';
    body = dev ? `<div class="pn-sec"><h4>Output device</h4><div class="dev-list">${list(dev.output, 'out')}</div></div><div class="pn-sec"><h4>Input device</h4><div class="dev-list">${list(dev.input, 'in')}</div></div>` : loading;
  } else {
    // one row per app: apps like Discord or browsers open several sessions
    const groups = new Map();
    for (const x of ses || []) { const k = (x.exe || x.name).toLowerCase(); const g = groups.get(k); if (g) { g.ids.push(x.id); g.active ||= x.active; g.muted &&= x.muted; } else groups.set(k, { ...x, ids: [x.id] }); }
    const rows = [...groups.values()].sort((a, b) => (a.system - b.system) || a.name.localeCompare(b.name));
    body = ses ? `<div class="pn-sec"><h4>Apps</h4>${rows.map((s) => `<div class="mix">${sessionIcon(s)}<span class="name" title="${esc(s.name)}">${esc(s.name)}</span>${slider(s.volume, `data-input="app" data-v="${esc(s.ids.join("|"))}"`, { cls: "sm" })}<span class="val">${s.volume}</span><button class="ibtn ${s.muted ? 'warn' : ''}" data-a="appMute" data-v="${esc(s.ids.join("|"))}" data-tip="${s.muted ? 'Unmute' : 'Mute'}">${icon(s.muted ? 'mute' : 'volume', 13)}</button></div>`).join('') || '<div class="pn-muted">No app is using audio right now.</div>'}</div>` : loading;
  }
  return `<div class="pn"><div class="pn-head"><h3>${icon('volume', 18)} Sound</h3><span class="sub num">${v ? (v.muted ? 'Muted' : v.level + '%') : ''}</span></div>${tabs}${body}
    <div class="btns grid2"><button class="btn" data-a="sound">${icon('gear', 14)} Sound settings</button><button class="btn" data-a="mixer">${icon('sliders', 14)} Windows mixer</button></div></div>`;
}
const soundOn = {
  tab: (ctx, el) => { ctx.state.tab = el.dataset.v; ctx.rerender(true); },
  out: (ctx, el) => { setVol(ctx, 0, Number(el.value)); const v = el.closest('.ctl-row')?.querySelector('.val'); if (v) v.textContent = el.value + '%'; },
  in: (ctx, el) => { setVol(ctx, 1, Number(el.value)); const v = el.closest('.ctl-row')?.querySelector('.val'); if (v) v.textContent = el.value + '%'; },
  mute: async (ctx) => { const v = ctx.hub.peek('volume'); await ctx.act('mute', { muted: !v?.muted, flow: 0 }); ctx.hub.refresh('volume'); },
  micMute: async (ctx) => { const v = ctx.hub.peek('volume'); await ctx.act('mute', { muted: !v?.micMuted, flow: 1 }); ctx.hub.refresh('volume'); },
  device: async (ctx, el) => { await ctx.act('audioDevice', { id: el.dataset.v }); ctx.hub.refresh('audioDevices'); ctx.hub.refresh('volume'); ctx.hub.refresh('audioSessions'); },
  app: (ctx, el) => { const ids = el.dataset.v.split('|'); const volume = Number(el.value); clearTimeout(ctx.state.at); ctx.state.at = setTimeout(() => ids.forEach((id) => ctx.act('appVolume', { id, volume })), 30); el.closest('.mix').querySelector('.val').textContent = volume; },
  appMute: async (ctx, el) => { const ids = el.dataset.v.split('|'); const all = (ctx.hub.peek('audioSessions') || []).filter((x) => ids.includes(x.id)); const mute = !all.every((x) => x.muted); for (const id of ids) await ctx.act('appVolume', { id, muted: mute }); ctx.hub.refresh('audioSessions'); },
  sound: (ctx) => ctx.act('open', { target: 'ms-settings:sound' }),
  mixer: (ctx) => ctx.act('open', { target: 'ms-settings:apps-volume' }),
};
const soundWheel = async (ctx, ev) => { const v = ctx.hub.peek('volume'); if (!v) return; await ctx.act('volume', { level: clamp(v.level + (ev.deltaY < 0 ? 2 : -2), 0, 100), flow: 0 }); ctx.hub.refresh('volume'); };

export { soundPanel, soundOn, soundWheel };

export default [
  {
    type: 'cpu', name: 'CPU', cat: 'system', icon: 'cpu', desc: 'Processor load as a ring with history.',
    sizes: ['s', 'm'], size: 's', topics: ['cpu'],
    tile(ctx, { cpu }) {
      if (ctx.size === 'm') return ringWide(ctx, cpu?.pct, pctColor(cpu?.pct || 0), 'CPU', spark((cpu?.history || []).slice(-24), { w: P(ctx, 64), h: P(ctx, 18), color: C.blue, max: 100 }));
      return ringTile(ctx, cpu?.pct, pctColor(cpu?.pct || 0), 'CPU');
    },
    panel(ctx, { cpu }) {
      if (!cpu) return loading;
      return `<div class="pn"><div class="pn-head"><h3>${icon('cpu', 18)} Processor</h3><span class="sub num">${pct(cpu.pct)}</span></div>
        <div class="pn-sec chart">${lineChart(cpu.history, { h: 72, max: 100, color: pctColor(cpu.pct), dot: true, grid: [0, 0.5, 1], labels: true, fmt: (v) => v + '%', slots: HIST })}</div>
        <div class="pn-grid c2"><div class="pn-stat"><b>${cpu.cores}</b><span>Logical cores</span></div><div class="pn-stat"><b>${cpu.history?.length ? pct(Math.max(...cpu.history)) : '–'}</b><span>Peak (recent)</span></div></div>
        <div class="pn-muted">${esc(cpu.model || '')}</div>
        <div class="btns grid2"><button class="btn" data-a="taskmgr">${icon('external', 14)} Task Manager</button><button class="btn" data-a="about">${icon('gear', 14)} System info</button></div></div>`;
    },
    on: { taskmgr: (ctx) => ctx.act('open', { target: 'C:\\Windows\\System32\\Taskmgr.exe' }), about: (ctx) => ctx.act('open', { target: 'ms-settings:about' }) },
  },
  {
    type: 'ram', name: 'RAM', cat: 'system', icon: 'ram', desc: 'Memory in use as a ring.',
    sizes: ['s', 'm'], size: 's', topics: ['mem'],
    tile(ctx, { mem }) {
      if (ctx.size === 'm') return ringWide(ctx, mem?.pct, C.purple, 'RAM', `<span class="t-sub num">${mem ? fmtBytes(mem.used) : '–'}</span>`);
      return ringTile(ctx, mem?.pct, C.purple, 'RAM');
    },
    panel(ctx, { mem }) {
      if (!mem) return loading;
      return `<div class="pn"><div class="pn-head"><h3>${icon('ram', 18)} Memory</h3><span class="sub num">${pct(mem.pct)}</span></div>
        <div class="pn-sec chart">${lineChart(mem.history, { h: 64, max: 100, color: C.purple, dot: true, grid: [0, 0.5, 1], labels: true, fmt: (v) => v + '%', slots: HIST })}</div>
        <div class="pn-grid c3"><div class="pn-stat"><b>${fmtBytes(mem.used)}</b><span>Used</span></div><div class="pn-stat"><b>${fmtBytes(mem.total - mem.used)}</b><span>Free</span></div><div class="pn-stat"><b>${fmtBytes(mem.total, 0)}</b><span>Total</span></div></div></div>`;
    },
  },
  {
    type: 'gpu', name: 'GPU', cat: 'system', icon: 'gpu', desc: 'Graphics load (3D engine).',
    sizes: ['s', 'm'], size: 's', topics: ['gpu'],
    tile(ctx, { gpu }) {
      if (ctx.size === 'm') return ringWide(ctx, gpu?.pct, C.teal, 'GPU', `<span class="t-sub num">${gpu?.temp != null ? gpu.temp + '°C' : '3D load'}</span>`);
      return ringTile(ctx, gpu?.pct, C.teal, 'GPU');
    },
    panel(ctx, { gpu }) {
      if (!gpu) return loading;
      return `<div class="pn"><div class="pn-head"><h3>${icon('gpu', 18)} Graphics</h3><span class="sub num">${pct(gpu.pct)}</span></div>
        <div class="pn-sec chart">${lineChart(gpu.history, { h: 64, max: 100, color: C.teal, dot: true, grid: [0, 0.5, 1], labels: true, fmt: (v) => v + '%', slots: HIST })}</div>
        <div class="pn-grid c2"><div class="pn-stat"><b>${gpu.temp != null ? gpu.temp + '°C' : '–'}</b><span>Temperature</span></div><div class="pn-stat"><b style="font-size:13px">${esc(gpu.name || 'Windows counters')}</b><span>Source</span></div></div>
        <div class="pn-muted">Load comes from the Windows “GPU Engine (3D)” performance counters. Temperature is available on NVIDIA cards (nvidia-smi).</div></div>`;
    },
  },
  {
    type: 'temps', name: 'Temperature', cat: 'system', icon: 'temp', desc: 'Temperature as a gauge, with CPU and memory load beside it.',
    sizes: ['s', 'm'], size: 'm', topics: ['temps', 'cpu', 'mem'],
    tile(ctx, { temps, cpu, mem }) {
      const t = temps?.cpu ?? temps?.gpu;
      const col = t == null ? C.gray : t > 85 ? C.red : t > 70 ? C.orange : C.green;
      const g = gauge(t == null ? 0 : clamp(((t - 20) / 80) * 100, 0, 100), { size: P(ctx, 44), stroke: Math.max(3, P(ctx, 4.5)), color: col, label: t == null ? '–' : Math.round(t) + '°', sub: temps?.cpu != null ? 'SYS' : temps?.gpu != null ? 'GPU' : '' });
      if (ctx.size === 's') return `<div class="tin sq">${g}</div>`;
      return `<div class="tin wide">${g}<div class="meters-col">${meter('CPU', cpu?.pct, pct(cpu?.pct), C.blue)}${meter('RAM', mem?.pct, pct(mem?.pct), C.purple)}</div></div>`;
    },
    panel(ctx, { temps }) {
      if (!temps) return loading;
      return `<div class="pn"><div class="pn-head"><h3>${icon('temp', 18)} Temperatures</h3></div>
        <div class="pn-grid c2"><div class="pn-stat"><b>${temps.cpu != null ? temps.cpu + '°C' : '–'}</b><span>System / CPU zone</span></div><div class="pn-stat"><b>${temps.gpu != null ? temps.gpu + '°C' : '–'}</b><span>GPU</span></div></div>
        ${temps.zones?.length > 1 ? `<div class="pn-sec">${temps.zones.map((z, i) => `<div class="pn-row"><span class="grow">Thermal zone ${i}</span><span class="val">${z}°C</span></div>`).join('')}</div>` : ''}
        <div class="pn-muted">Without third-party kernel drivers Windows only exposes ACPI thermal zones (board / package sensors, not per-core temperatures).</div></div>`;
    },
  },
  {
    type: 'network', name: 'Network', cat: 'system', icon: 'net', desc: 'Download and upload speed with a live chart.',
    sizes: ['s', 'm'], size: 'm', topics: ['net'],
    tile(ctx, { net }) {
      const down = `<span class="t-val num"><span class="blue">↓</span> ${fmtRate(net?.down)}</span>`, up = `<span class="t-val num"><span class="green">↑</span> ${fmtRate(net?.up)}</span>`;
      if (ctx.size === 's') return `<div class="tin tight"><div class="col" style="gap:calc(7px*var(--u));width:calc(66px*var(--fu))">${down}${up}</div></div>`;
      const h = net ? [...net.rxHistory.slice(-30), ...net.txHistory.slice(-30), 1] : [1];
      const W = P(ctx, 72), H = P(ctx, 32);
      return `<div class="tin"><div class="col" style="gap:calc(7px*var(--u));width:calc(72px*var(--fu))">${down}${up}</div>
        <span class="spark-stack" style="width:${W}px;height:${H}px">${spark(net?.rxHistory.slice(-30), { w: W, h: H, color: C.blue, max: Math.max(...h) })}${spark(net?.txHistory.slice(-30), { w: W, h: H, color: C.green, max: Math.max(...h) })}</span></div>`;
    },
    panel(ctx, { net }) {
      if (!net) return loading;
      return `<div class="pn"><div class="pn-head"><h3>${icon('net', 18)} Network</h3></div>
        <div class="pn-grid c2"><div class="pn-stat"><b class="blue">${fmtRate(net.down)}</b><span>Download</span></div><div class="pn-stat"><b class="green">${fmtRate(net.up)}</b><span>Upload</span></div></div>
        <div class="pn-sec chart">${dualLineChart(net.rxHistory, net.txHistory, { h: 76, colorA: C.blue, colorB: C.green, grid: [0.5, 1], labels: true, fmt: fmtRate, slots: HIST })}</div>
        <div class="btns grid2"><button class="btn" data-a="settings">${icon('gear', 14)} Network settings</button><button class="btn" data-a="nets">${icon('wifi', 14)} Networks</button></div></div>`;
    },
    on: { settings: (ctx) => ctx.act('open', { target: 'ms-settings:network' }), nets: (ctx) => ctx.act('open', { target: 'ms-availablenetworks:' }) },
  },
  {
    type: 'storage', name: 'Storage', cat: 'system', icon: 'disk', desc: 'Free space on your drives, with a usage bar.',
    sizes: ['s', 'm'], size: 'm', topics: ['disks'],
    settings: [{ key: 'drive', label: 'Drive', type: 'text', default: 'C:\\' }],
    tile(ctx, { disks }) {
      const d = disks?.find((x) => x.name.toLowerCase() === (ctx.s.drive || 'C:\\').toLowerCase()) || disks?.[0];
      if (!d) return `<div class="tin"><span class="t-sub">…</span></div>`;
      const used = (d.total ? ((d.total - d.free) / d.total) * 100 : 0);
      if (ctx.size === 's') return `<div class="tin sq">${ring(used, { size: P(ctx, 46), stroke: Math.max(3, P(ctx, 4.5)), color: pctColor(used), label: d.name.slice(0, 2), sub: fmtBytes(d.free, 0) })}</div>`;
      return `<div class="tin wide"><span class="glyph-tile">${icon('disk')}</span><div class="col" style="width:calc(112px*var(--u));gap:calc(7px*var(--u))"><div class="row" style="justify-content:space-between"><span class="t-title">${d.name.slice(0, 2)}</span><span class="t-sub num">${fmtBytes(d.free, 0)} free</span></div>${bar(used, pctColor(used))}</div></div>`;
    },
    panel(ctx, { disks }) {
      if (!disks) return loading;
      return `<div class="pn"><div class="pn-head"><h3>${icon('disk', 18)} Drives</h3></div>${disks.map((d) => {
        const used = (d.total ? ((d.total - d.free) / d.total) * 100 : 0);
        return `<div class="pn-sec" data-a="open" data-v="${esc(d.name)}"><div class="pn-row"><b class="grow">${esc(d.label || 'Local disk')} (${d.name.slice(0, 2)})</b><span class="dim num">${fmtBytes(d.free)} free of ${fmtBytes(d.total, 0)}</span></div>${bar(used, pctColor(used))}</div>`;
      }).join('')}<div class="btns grid2"><button class="btn" data-a="cleanup">${icon('sparkles', 14)} Storage Sense</button><button class="btn" data-a="explorer">${icon('folder', 14)} This PC</button></div></div>`;
    },
    on: { open: (ctx, el) => ctx.act('open', { target: el.dataset.v }), cleanup: (ctx) => ctx.act('open', { target: 'ms-settings:storagesense' }), explorer: (ctx) => ctx.act('open', { target: 'shell:MyComputerFolder' }) },
  },
  {
    type: 'battery', name: 'Battery', cat: 'system', icon: 'battery', desc: 'Charge level as a filling gauge, with the charging state.',
    sizes: ['s', 'm'], size: 's', topics: ['battery'],
    tile(ctx, { battery: b }) {
      if (!b) return `<div class="tin sq"><span class="t-sub">…</span></div>`;
      if (!b.present) return `<div class="tin sq"><div class="col" style="align-items:center;gap:calc(4px*var(--u))">${icon('bolt', P(ctx, 20))}<span class="t-xs">AC</span></div></div>`;
      const p = b.percent;
      const grad = p <= 20 ? ['#ff8a80', '#ff453a'] : b.charging ? ['#7cf29a', '#30d158'] : ['#64c8ff', '#0a84ff'];
      const wave = `<svg class="wave" viewBox="0 0 200 8" preserveAspectRatio="none"><path d="M0 4 Q12.5 0 25 4 T50 4 T75 4 T100 4 T125 4 T150 4 T175 4 T200 4 V8 H0Z" fill="${grad[0]}" opacity=".85"/></svg>`;
      const liquid = `<div class="liquid"><div class="fill" style="height:${p}%;background:linear-gradient(${grad[0]}cc,${grad[1]}d9)">${wave}</div></div>`;
      const label = `<div class="col" style="align-items:center;gap:calc(3px*var(--u));z-index:1;text-shadow:0 1px 2px rgba(0,0,0,.35)"><span class="t-val" style="font-size:calc(13px*var(--fu))">${p}%</span>${b.charging ? icon('bolt', P(ctx, 11)) : ''}</div>`;
      return `${liquid}<div class="tin ${ctx.size === 'm' ? '' : 'sq'}" style="${ctx.size === 'm' ? 'width:calc(96px*var(--u));justify-content:center' : ''}">${label}</div>`;
    },
    panel(ctx, { battery: b }) {
      if (!b) return loading;
      if (!b.present) return `<div class="pn"><div class="pn-head"><h3>${icon('bolt', 18)} Power</h3></div>${na('No battery detected – this device runs on mains power.')}<div class="btns"><button class="btn" data-a="power">Power options</button></div></div>`;
      return `<div class="pn"><div class="pn-head"><h3>${icon('battery', 18)} Battery</h3><span class="sub">${b.charging ? 'Charging' : 'On battery'}</span></div>
        <div class="pn-big">${b.percent}%</div>${bar(b.percent, b.percent <= 20 ? C.red : C.green)}
        <div class="pn-grid c2"><div class="pn-stat"><b>${b.secondsLeft > 0 ? fmtDur(b.secondsLeft, true) : '–'}</b><span>Time left</span></div><div class="pn-stat"><b>${b.saver ? 'On' : 'Off'}</b><span>Battery saver</span></div></div>
        <div class="btns"><button class="btn" data-a="power">Power options</button></div></div>`;
    },
    on: { power: (ctx) => ctx.act('open', { target: 'ms-settings:powersleep' }) },
  },
  {
    type: 'wifi', name: 'Wi-Fi', cat: 'system', icon: 'wifi', desc: 'Connected network and signal strength.',
    sizes: ['s', 'm'], size: 's', topics: ['wifi'],
    tile(ctx, { wifi }) {
      const on = wifi?.connected;
      if (ctx.size === 'm') return `<div class="tin"><span class="glyph-tile" style="${on ? 'background:var(--accent);color:#fff' : ''}">${icon('wifi')}</span><div class="col" style="gap:calc(6px*var(--u))"><span class="t-title">${on ? esc(wifi.ssid) : 'Wi-Fi'}</span><span class="t-sub">${on ? wifi.signal + '% signal' : 'Not connected'}</span></div></div>`;
      return `<div class="tin sq"><span style="display:flex;color:${on ? 'var(--text)' : 'var(--text-3)'}">${icon('wifi', P(ctx, 24))}</span></div>`;
    },
    panel(ctx, { wifi }) {
      return `<div class="pn"><div class="pn-head"><h3>${icon('wifi', 18)} Wi-Fi</h3></div>
        ${wifi?.connected ? `<div class="pn-sec"><div class="pn-row"><b class="grow">${esc(wifi.ssid)}</b><span class="green">Connected</span></div>${meter('Signal', wifi.signal, wifi.signal + '%', C.blue)}${wifi.rate ? `<div class="pn-row"><span class="grow dim">Receive rate</span><span class="val">${esc(wifi.rate)}</span></div>` : ''}</div>` : na('No Wi-Fi connection (or no Wi-Fi adapter on this PC).')}
        <div class="btns grid2"><button class="btn" data-a="nets">Available networks</button><button class="btn" data-a="settings">Wi-Fi settings</button></div></div>`;
    },
    on: { nets: (ctx) => ctx.act('open', { target: 'ms-availablenetworks:' }), settings: (ctx) => ctx.act('open', { target: 'ms-settings:network-wifi' }) },
  },
  {
    type: 'bluetooth', name: 'Quick Toggles', cat: 'system', icon: 'bluetooth', desc: 'Wi-Fi and Bluetooth switches, plus airplane mode.',
    sizes: ['s', 'm'], size: 's', topics: ['radios'],
    tile(ctx, { radios }) {
      const bt = radios?.find((r) => r.kind === 'Bluetooth');
      if (ctx.size === 'm') {
        const wl = radios?.find((r) => r.kind === 'WiFi');
        const s = `calc(40px*var(--u))`;
        const t = (r, ic, tip) => `<button class="ico-btn" data-a="toggle" data-v="${r?.kind || ''}" data-tip="${tip}" style="width:${s};height:${s};${r?.state === 'On' ? 'background:var(--accent);color:#fff' : ''};${r ? '' : 'opacity:.35'}">${icon(ic, P(ctx, 19))}</button>`;
        return `<div class="tin tight">${t(wl, 'wifi', 'Wi-Fi')}${t(bt, 'bluetooth', 'Bluetooth')}</div>`;
      }
      return `<div class="tin sq"><span style="display:flex;color:${bt?.state === 'On' ? 'var(--accent)' : 'var(--text-3)'}">${icon('bluetooth', P(ctx, 24))}</span></div>`;
    },
    panel(ctx, { radios }) {
      const list = radios || [];
      return `<div class="pn"><div class="pn-head"><h3>${icon('bluetooth', 18)} Quick toggles</h3></div>
        ${list.length ? `<div class="pn-grid c2">${list.map((r) => `<button class="btn" data-a="toggle" data-v="${r.kind}" style="height:56px;justify-content:flex-start;padding:0 14px;${r.state === 'On' ? 'background:var(--accent);color:#fff' : ''}">${icon(r.kind === 'Bluetooth' ? 'bluetooth' : r.kind === 'WiFi' ? 'wifi' : 'airplane', 18)}<span style="display:flex;flex-direction:column;align-items:flex-start;gap:3px"><b>${esc(r.name)}</b><small style="opacity:.7">${r.state === 'On' ? 'On' : 'Off'}</small></span></button>`).join('')}</div>` : na('No switchable radios found (desktop PC without Wi-Fi or Bluetooth?).')}
        <div class="btns grid2"><button class="btn" data-a="bt">Bluetooth devices</button><button class="btn" data-a="air">Airplane mode</button></div></div>`;
    },
    on: {
      toggle: async (ctx, el) => {
        const kind = el.dataset.v; if (!kind) return;
        const r = ctx.hub.peek('radios')?.find((x) => x.kind === kind);
        await ctx.act('radio', { kind, on: r?.state !== 'On' });
        ctx.hub.refresh('radios');
      },
      bt: (ctx) => ctx.act('open', { target: 'ms-settings:bluetooth' }),
      air: (ctx) => ctx.act('open', { target: 'ms-settings:network-airplanemode' }),
    },
  },
  {
    type: 'volume', name: 'Volume', cat: 'system', icon: 'volume', desc: 'Volume, mute, output and input devices and a per-app mixer. Scroll to change.',
    sizes: ['s', 'm'], size: 's', topics: ['volume'], panelTopics: ['audioDevices', 'audioSessions'],
    tile(ctx, { volume: v }) {
      const lvl = v?.level ?? 0; const muted = v?.muted || lvl === 0;
      const ic = icon(muted ? 'mute' : 'volume', P(ctx, 17));
      if (ctx.size === 'm') return `<div class="tin"><span class="glyph-tile">${icon(muted ? 'mute' : 'volume')}</span><div class="col" style="width:calc(96px*var(--u));gap:calc(7px*var(--u))"><div class="row" style="justify-content:space-between"><span class="t-label">Volume</span><span class="t-val">${v?.muted ? 'Muted' : lvl + '%'}</span></div>${bar(v?.muted ? 0 : lvl, 'var(--text)', 'live')}</div></div>`;
      return `<div class="tin sq">${ring(v?.muted ? 0 : lvl, { size: P(ctx, 46), stroke: Math.max(3, P(ctx, 4.5)), color: 'var(--text)', cls: 'live', label: `<span style="display:flex">${ic}</span>` })}</div>`;
    },
    panel: soundPanel, on: soundOn, wheel: soundWheel, panelWidth: 340,
  },
  {
    type: 'brightness', name: 'Brightness', cat: 'system', icon: 'sun', desc: 'Display brightness (laptop panel or DDC/CI monitor).',
    sizes: ['s', 'm'], size: 's', topics: ['brightness'],
    tile(ctx, { brightness: b }) {
      const ok = b && b.level >= 0;
      if (ctx.size === 'm') return `<div class="tin"><span class="glyph-tile">${icon('sun')}</span><div class="col" style="width:calc(96px*var(--u));gap:calc(7px*var(--u))"><div class="row" style="justify-content:space-between"><span class="t-label">Brightness</span><span class="t-val">${ok ? b.level + '%' : '–'}</span></div>${bar(ok ? b.level : 0, '#ffd60a')}</div></div>`;
      return `<div class="tin sq">${ring(ok ? b.level : 0, { size: P(ctx, 46), stroke: Math.max(3, P(ctx, 4.5)), color: '#ffd60a', label: `<span style="display:flex">${icon('sun', P(ctx, 17))}</span>` })}</div>`;
    },
    panel(ctx, { brightness: b }) {
      const ok = b && b.level >= 0;
      return `<div class="pn"><div class="pn-head"><h3>${icon('sun', 18)} Brightness</h3><span class="sub num">${ok ? b.level + '%' : ''}</span></div>
        ${ok ? `<div class="ctl-row"><span class="ibtn" style="pointer-events:none">${icon('sun', 16)}</span>${slider(b.level, 'data-input="set"', { color: '#ffd60a' })}<span class="val">${b.level}%</span></div><div class="pn-muted">${b.kind === 'ddc' ? 'External monitor via DDC/CI' : 'Built-in display'}</div>`
          : na('This display cannot be dimmed by software (not a laptop panel and no DDC/CI). Enable DDC/CI in your monitor’s menu if it has the option.')}
        <div class="btns grid2"><button class="btn" data-a="display">Display settings</button><button class="btn" data-a="night">Night light</button></div></div>`;
    },
    on: {
      set: (ctx, el) => { clearTimeout(ctx.state.t); ctx.state.t = setTimeout(async () => { await ctx.act('brightness', { level: Number(el.value) }); ctx.hub.refresh('brightness'); }, 120); },
      display: (ctx) => ctx.act('open', { target: 'ms-settings:display' }),
      night: (ctx) => ctx.act('open', { target: 'ms-settings:nightlight' }),
    },
  },
  {
    type: 'recycle', name: 'Recycle Bin', cat: 'system', icon: 'trash', desc: 'What the bin holds, and a click to empty it.',
    sizes: ['s', 'm'], size: 's', topics: ['recycle'],
    tile(ctx, { recycle: r }) {
      const n = r?.items || 0;
      if (ctx.size === 'm') return `<div class="tin"><span class="glyph-tile">${icon('trash')}</span><div class="col" style="gap:calc(6px*var(--u))"><span class="t-title">Recycle Bin</span><span class="t-sub num">${n ? `${n} items · ${fmtBytes(r.size)}` : 'Empty'}</span></div></div>`;
      return `<div class="tin sq"><span class="ico-btn" style="pointer-events:none;width:calc(44px*var(--u));height:calc(44px*var(--u))">${icon('trash', P(ctx, 23))}${n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : ''}</span></div>`;
    },
    panel(ctx, { recycle: r }) {
      const n = r?.items || 0;
      return `<div class="pn"><div class="pn-head"><h3>${icon('trash', 18)} Recycle Bin</h3></div>
        <div class="pn-grid c2"><div class="pn-stat"><b>${n}</b><span>Items</span></div><div class="pn-stat"><b>${fmtBytes(r?.size || 0)}</b><span>Size</span></div></div>
        <div class="btns grid2"><button class="btn" data-a="open">${icon('folder', 14)} Open</button><button class="btn danger" data-a="empty" ${n ? '' : 'disabled'}>${icon('trash', 14)} Empty</button></div></div>`;
    },
    on: {
      open: (ctx) => ctx.act('open', { target: 'shell:RecycleBinFolder' }),
      empty: async (ctx) => { await ctx.act('emptyRecycle'); ctx.hub.refresh('recycle'); },
    },
  },
];
