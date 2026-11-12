import { icon, esc, fmtClock, fmtTimeShort, wmo, C, WEEKDAYS, WEEKDAYS_LONG, MONTHS, MONTHS_LONG } from '../shared/ui.js';

const P = (ctx, n) => Math.round(n * ctx.u);
// Open-Meteo days are plain dates ("2026-11-13"); new Date() would read them as UTC midnight, the day before west of UTC
const localDay = (s) => new Date(s + 'T00:00');
// a mistyped time zone ("Europe/Berln") must not break the whole tile: it falls back to local time
const validTz = (tz) => { if (!tz) return true; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const tzParts = (tz) => {
  const d = new Date();
  if (!validTz(tz)) tz = undefined;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second), wd: p.weekday };
};
const tzOffset = (tz) => {
  if (!validTz(tz)) return 'unknown time zone';
  const d = new Date();
  const a = new Date(d.toLocaleString('en-US', { timeZone: tz })); const b = new Date(d.toLocaleString('en-US'));
  const h = Math.round(((a - b) / 36e5) * 2) / 2;
  return h === 0 ? 'same time' : (h > 0 ? '+' : '') + h + ' h';
};
const hm = (ctx, h, m) => { let hh = h; let suffix = ''; if (!ctx.cfg.behavior.clock24) { suffix = h < 12 ? ' AM' : ' PM'; hh = h % 12 || 12; } return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}${suffix}`; };

function analogSvg(size, { h, m, s }, { seconds = true, ticks = 12 } = {}) {
  const c = size / 2; const r = c - 2;
  const hand = (deg, len, w, col) => { const a = ((deg - 90) * Math.PI) / 180; return `<line x1="${c}" y1="${c}" x2="${c + Math.cos(a) * len}" y2="${c + Math.sin(a) * len}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`; };
  let t = '';
  for (let i = 0; i < ticks; i++) { const a = (((i * 360) / ticks - 90) * Math.PI) / 180; const major = i % 3 === 0; const r1 = r - (major ? size * 0.13 : size * 0.08); t += `<line x1="${c + Math.cos(a) * r1}" y1="${c + Math.sin(a) * r1}" x2="${c + Math.cos(a) * (r - size * 0.04)}" y2="${c + Math.sin(a) * (r - size * 0.04)}" stroke="var(--text-${major ? '2' : '3'})" stroke-width="${major ? 1.6 : 1}" stroke-linecap="round"/>`; }
  return `<span class="analog" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}">${t}
    ${hand((h % 12) * 30 + m * 0.5, r * 0.5, 2.6, 'var(--text)')}${hand(m * 6 + s * 0.1, r * 0.75, 1.9, 'var(--text)')}
    ${seconds ? hand(s * 6, r * 0.82, 1, '#ff9f0a') : ''}<circle cx="${c}" cy="${c}" r="2.2" fill="${seconds ? '#ff9f0a' : 'var(--text)'}"/></svg></span>`;
}
const SEG = { 0: 'abcfed', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' };
function segDigit(n, w = 13, h = 24, col = '#ff453a') {
  const on = SEG[n] || ''; const t = Math.max(2, w * 0.2); const g = 0.6;
  const seg = { a: [g + t / 2, 0, w - 2 * g - t, t], d: [g + t / 2, h - t, w - 2 * g - t, t], g: [g + t / 2, h / 2 - t / 2, w - 2 * g - t, t], f: [0, g + t / 2, t, h / 2 - t - g], b: [w - t, g + t / 2, t, h / 2 - t - g], e: [0, h / 2 + g, t, h / 2 - t - g], c: [w - t, h / 2 + g, t, h / 2 - t - g] };
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${Object.entries(seg).map(([k, [x, y, ww, hh]]) => `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${t / 2}" fill="${col}" opacity="${on.includes(k) ? 1 : 0.08}"/>`).join('')}</svg>`;
}
function flipCards(ctx, str) {
  const prev = ctx.state.prevFlip || '';
  ctx.state.prevFlip = str;
  return `<span class="flip">${[...str].map((ch, i) => (ch === ':' ? '<span class="sep">:</span>' : `<span class="card ${prev && prev[i] !== ch ? 'turn' : ''}">${ch}</span>`)).join('')}</span>`;
}
const cities = (s) => (s.cities || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [tz, label] = x.split('='); return { tz, label: label || tz.split('/').pop().replace(/_/g, ' ') }; });

function weatherTile(ctx, w, kind) {
  if (!w) return `<div class="tin"><span class="t-sub">…</span></div>`;
  if (!w.connected) return `<div class="tin"><span class="glyph-tile">${icon('cloud')}</span><div class="col" style="gap:calc(6px*var(--u))"><span class="t-title">Weather</span><span class="t-sub">${w.error ? 'Offline' : 'Choose a city'}</span></div></div>`;
  const c = w.current; const x = wmo(c.weather_code, c.is_day);
  const hi = Math.round(w.daily.temperature_2m_max[0]), lo = Math.round(w.daily.temperature_2m_min[0]);
  const gl = (n) => `<span style="font-size:calc(${n}px*var(--u));line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25))">${x.glyph}</span>`;
  if (ctx.size === 's') return `<div class="tin sq"><div class="col" style="align-items:center;gap:calc(3px*var(--u))">${gl(20)}<span class="t-val" style="font-size:calc(13px*var(--fu))">${Math.round(c.temperature_2m)}°</span></div></div>`;
  if (kind === 'details') return `<div class="tin wide">${gl(26)}<div class="col" style="gap:calc(6px*var(--u))"><span class="t-sub">${icon('wind', P(ctx, 11))} ${Math.round(c.wind_speed_10m)} km/h · ${icon('drop', P(ctx, 11))} ${w.daily.precipitation_probability_max?.[0] ?? 0}%</span><span class="t-sub">${lo}° – ${hi}° · ${c.relative_humidity_2m}% humidity</span></div></div>`;
  if (kind === 'status') return `<div class="tin wide">${gl(26)}<div class="col" style="gap:calc(6px*var(--u))"><span class="t-title">${x.label}</span><span class="t-sub">${esc(w.city)}</span></div></div>`;
  return `<div class="tin wide">${gl(28)}<div class="col" style="gap:calc(5px*var(--u))"><span class="t-big">${Math.round(c.temperature_2m)}°</span><span class="t-sub">H ${hi}° · L ${lo}°</span></div></div>`;
}
function weatherPanel(ctx, { 'integ:weather': w }) {
  if (!w?.connected) return `<div class="pn"><div class="pn-head"><h3>${icon('cloud', 18)} Weather</h3></div>${w?.error ? `<div class="err-note">Weather data unavailable: ${esc(w.error)}</div>` : ''}<div class="btns"><button class="btn" data-a="city">Choose city</button></div></div>`;
  const c = w.current; const x = wmo(c.weather_code, c.is_day);
  const h24 = ctx.cfg.behavior.clock24;
  const hours = w.hourly.time.slice(0, 12).map((t, i) => ({ t: new Date(t), temp: w.hourly.temperature_2m[i], code: w.hourly.weather_code[i], pp: w.hourly.precipitation_probability[i] }));
  const dmin = Math.min(...w.daily.temperature_2m_min), dmax = Math.max(...w.daily.temperature_2m_max);
  const sr = new Date(w.daily.sunrise[0]), ss = new Date(w.daily.sunset[0]);
  return `<div class="pn"><div class="pn-head"><h3>${esc(w.city)}</h3><button class="btn" data-a="city">${icon('search', 13)} City</button><button class="btn icon" data-a="refresh" data-tip="Refresh">${icon('refresh', 13)}</button></div>
    <div style="display:flex;align-items:center;gap:14px"><span style="font-size:54px;line-height:1">${x.glyph}</span><div><div class="pn-big">${Math.round(c.temperature_2m)}°</div><div class="pn-muted">${x.label} · feels like ${Math.round(c.apparent_temperature)}°</div></div></div>
    <div class="pn-grid c4"><div class="pn-stat"><b>${Math.round(c.wind_speed_10m)}</b><span>km/h wind</span></div><div class="pn-stat"><b>${c.relative_humidity_2m}%</b><span>Humidity</span></div><div class="pn-stat"><b>${w.daily.precipitation_probability_max?.[0] ?? 0}%</b><span>Rain</span></div><div class="pn-stat"><b style="font-size:15px">${fmtTimeShort(sr, h24)}</b><span>Sunrise</span></div></div>
    <div class="pn-sec"><h4>Next hours</h4><div style="display:flex;justify-content:space-between">${hours.filter((_, i) => i % 2 === 0).map((h) => `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;font-size:12px"><span class="kbd">${h24 ? h.t.getHours() + 'h' : (h.t.getHours() % 12 || 12) + (h.t.getHours() < 12 ? 'a' : 'p')}</span><span style="font-size:18px">${wmo(h.code).glyph}</span><b>${Math.round(h.temp)}°</b><span class="kbd" style="color:${C.teal}">${h.pp}%</span></div>`).join('')}</div></div>
    <div class="pn-sec"><h4>7 days</h4>${w.daily.time.map((t, i) => { const lo = w.daily.temperature_2m_min[i], hi = w.daily.temperature_2m_max[i]; const l = ((lo - dmin) / (dmax - dmin || 1)) * 100, r = ((hi - dmin) / (dmax - dmin || 1)) * 100; return `<div class="pn-row"><span style="width:44px" class="${i === 0 ? '' : 'dim'}">${i === 0 ? 'Today' : WEEKDAYS[localDay(t).getDay()]}</span><span style="width:24px;text-align:center">${wmo(w.daily.weather_code[i]).glyph}</span><span class="dim num" style="width:30px;text-align:right">${Math.round(lo)}°</span><span class="pbar" style="height:5px"><i style="left:${l}%;width:${r - l}%;background:linear-gradient(90deg,${C.teal},${C.orange})"></i></span><span class="num" style="width:30px">${Math.round(hi)}°</span></div>`; }).join('')}</div>
    <div class="pn-muted">Sunset ${fmtTimeShort(ss, h24)} · Data: Open-Meteo</div></div>`;
}
const weatherOn = { city: (ctx) => ctx.openSettings('integrations'), refresh: (ctx) => ctx.hub.refresh('integ:weather') };
const W = { panel: weatherPanel, on: weatherOn, panelWidth: 340 };

export default [
  {
    type: 'clock', name: 'Clock', cat: 'time', icon: 'clock', desc: 'Large, readable time with seconds and the date, in 12- or 24-hour format.',
    sizes: ['s', 'm'], size: 'm', topics: ['clock'],
    settings: [{ key: 'seconds', label: 'Show seconds', type: 'toggle', default: false }, { key: 'date', label: 'Show date', type: 'toggle', default: true }],
    tile(ctx) {
      const d = new Date(); const h24 = ctx.cfg.behavior.clock24;
      if (ctx.size === 's') return `<div class="tin sq"><div class="col" style="align-items:center;gap:calc(4px*var(--u))"><span class="t-val" style="font-size:calc(13px*var(--fu))">${fmtTimeShort(d, h24).replace(/\s?[AP]M/, '')}</span><span class="t-xs">${WEEKDAYS[d.getDay()]} ${d.getDate()}</span></div></div>`;
      return `<div class="tin wide" style="gap:calc(10px*var(--u))">${ctx.s.date ? `<div class="col" style="align-items:flex-end;gap:calc(5px*var(--u))"><span class="t-cap red">${WEEKDAYS_LONG[d.getDay()]}</span><span class="t-title">${MONTHS[d.getMonth()]} ${d.getDate()}</span></div>` : ''}<span class="t-big" style="font-size:calc(21px*var(--fu));font-weight:600">${fmtClock(d, h24, ctx.s.seconds)}</span></div>`;
    },
    panel(ctx) {
      const d = new Date();
      const view = ctx.state.month || new Date(d.getFullYear(), d.getMonth(), 1);
      const first = new Date(view.getFullYear(), view.getMonth(), 1); const off = (first.getDay() + 6) % 7;
      let grid = '<div class="cal-grid">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x) => `<div class="h">${x}</div>`).join('');
      for (let i = 0; i < 42; i++) { const x = new Date(view.getFullYear(), view.getMonth(), 1 - off + i); grid += `<div class="d ${x.getMonth() !== view.getMonth() ? 'o' : ''} ${x.toDateString() === d.toDateString() ? 't' : ''}">${x.getDate()}</div>`; }
      const week = (() => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); })();
      return `<div class="pn"><div><div class="pn-big" style="font-size:44px">${fmtClock(d, ctx.cfg.behavior.clock24, true)}</div><div class="pn-muted">${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · Week ${week}</div></div>
        <div class="pn-head"><h3 style="font-size:13px">${MONTHS_LONG[view.getMonth()]} ${view.getFullYear()}</h3><button class="btn icon" data-a="prev">${icon('arrowLeft', 14)}</button><button class="btn icon" data-a="next">${icon('arrowRight', 14)}</button></div>${grid}</div>
        <div class="btns grid2"><button class="btn" data-a="alarms">${icon('clock', 14)} Alarms & Clock</button><button class="btn" data-a="dt">Date & time</button></div></div>`;
    },
    panelLive: 'fast',
    on: {
      prev: (ctx) => { const v = ctx.state.month || new Date(new Date().getFullYear(), new Date().getMonth(), 1); ctx.state.month = new Date(v.getFullYear(), v.getMonth() - 1, 1); ctx.rerender(true); },
      next: (ctx) => { const v = ctx.state.month || new Date(new Date().getFullYear(), new Date().getMonth(), 1); ctx.state.month = new Date(v.getFullYear(), v.getMonth() + 1, 1); ctx.rerender(true); },
      alarms: (ctx) => ctx.act('open', { target: 'ms-clock:' }),
      dt: (ctx) => ctx.act('open', { target: 'ms-settings:dateandtime' }),
    },
  },
  {
    type: 'flipclock', name: 'Flip Clock', cat: 'time', icon: 'clock', desc: 'Split-flap digits that turn over every minute.',
    sizes: ['m'], size: 'm', topics: ['clock'],
    tile(ctx) {
      const d = new Date(); let h = d.getHours(); if (!ctx.cfg.behavior.clock24) h = h % 12 || 12;
      return `<div class="tin">${flipCards(ctx, `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)}</div>`;
    },
  },
  {
    type: 'analog', name: 'Analog Minimal', cat: 'time', icon: 'clock', desc: 'Hands and hour ticks on a dark face, nothing else.',
    sizes: ['s'], size: 's', topics: ['clock'],
    settings: [{ key: 'seconds', label: 'Second hand', type: 'toggle', default: true }],
    tile(ctx) { return `<div class="tin sq">${analogSvg(P(ctx, 46), tzParts(), { seconds: ctx.s.seconds })}</div>`; },
  },
  {
    type: 'worldclock', name: 'World Clocks', cat: 'time', icon: 'globe', desc: 'Three small analog faces for the cities you work with.',
    sizes: ['m'], size: 'm', topics: ['clock'],
    settings: [{ key: 'cities', label: 'Time zones (Zone=Name, …)', type: 'text', default: 'America/New_York=New York,Europe/London=London,Asia/Tokyo=Tokyo' }],
    tile(ctx) {
      return `<div class="tin" style="gap:calc(9px*var(--u))">${cities(ctx.s).slice(0, 4).map((c) => `<div class="col" style="align-items:center;gap:calc(3px*var(--u))">${analogSvg(P(ctx, 32), tzParts(c.tz), { seconds: false })}<span class="t-xs" style="font-size:calc(8px*var(--fu));font-weight:600">${esc(c.label.slice(0, 9))}</span></div>`).join('')}</div>`;
    },
    panel(ctx) {
      return `<div class="pn"><div class="pn-head"><h3>${icon('globe', 18)} World clocks</h3></div>${cities(ctx.s).map((c) => { const p = tzParts(c.tz); return `<div class="pn-item">${analogSvg(36, p, { seconds: false })}<div class="grow"><b>${esc(c.label)}</b><span>${p.wd} · ${tzOffset(c.tz)}</span></div><span class="pn-mid">${hm(ctx, p.h, p.m)}</span></div>`; }).join('')}<div class="pn-muted">Change the cities in the widget settings.</div></div>`;
    },
  },
  {
    type: 'worldtime', name: 'World Time', cat: 'time', icon: 'globe', desc: 'One more city in big digits, with its offset.',
    sizes: ['m'], size: 'm', topics: ['clock'],
    settings: [{ key: 'tz', label: 'Time zone', type: 'text', default: 'America/New_York' }, { key: 'label', label: 'Name', type: 'text', default: 'New York' }],
    tile(ctx) {
      const p = tzParts(ctx.s.tz);
      return `<div class="tin wide"><div class="col" style="gap:calc(5px*var(--u))"><span class="t-title">${esc(ctx.s.label)}</span><span class="t-sub">${tzOffset(ctx.s.tz)}</span></div><span class="t-big" style="font-size:calc(21px*var(--fu));font-weight:600">${hm(ctx, p.h, p.m)}</span></div>`;
    },
  },
  {
    type: 'date', name: 'Date', cat: 'time', icon: 'calendar', desc: 'The full date, set large.',
    sizes: ['m'], size: 'm', topics: ['clock'],
    tile() { const d = new Date(); return `<div class="tin wide"><div class="col" style="gap:calc(6px*var(--u))"><span class="t-cap red">${WEEKDAYS_LONG[d.getDay()]}</span><span class="t-big">${MONTHS_LONG[d.getMonth()]} ${d.getDate()}</span></div></div>`; },
  },
  {
    type: 'daynumber', name: 'Day Number', cat: 'time', icon: 'calendar', desc: 'Today’s date as a calendar page.',
    sizes: ['s'], size: 's', topics: ['clock'],
    tile() {
      const d = new Date();
      return `<div class="tin sq"><span style="display:flex;flex-direction:column;width:calc(40px*var(--u));height:calc(44px*var(--u));border-radius:calc(10px*var(--u));overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"><span style="background:#ff3b30;color:#fff;font-size:calc(8px*var(--fu));font-weight:700;text-align:center;padding:calc(2px*var(--u)) 0;letter-spacing:.06em">${MONTHS[d.getMonth()].toUpperCase()}</span><span style="flex:1;display:flex;align-items:center;justify-content:center;color:#1d1d1f;font-size:calc(20px*var(--fu));font-weight:600" class="num">${d.getDate()}</span></span></div>`;
    },
  },
  {
    type: 'segment', name: 'Segment Clock', cat: 'time', icon: 'clock', desc: 'The time as a seven-segment display, under the weekday and date.',
    sizes: ['m'], size: 'm', topics: ['clock'],
    settings: [{ key: 'color', label: 'Color', type: 'color', default: '#ff453a' }],
    tile(ctx) {
      const d = new Date(); let h = d.getHours(); if (!ctx.cfg.behavior.clock24) h = h % 12 || 12;
      const s = `${String(h).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const col = ctx.s.color; const w = P(ctx, 12), hh = P(ctx, 22); const blink = d.getSeconds() % 2 ? 1 : 0.25;
      return `<div class="tin"><div class="col" style="gap:calc(5px*var(--u));align-items:center"><span class="t-cap" style="color:var(--text-2)">${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}</span><span class="row" style="gap:2px">${segDigit(+s[0], w, hh, col)}${segDigit(+s[1], w, hh, col)}<span style="width:4px;display:flex;flex-direction:column;gap:5px;align-items:center"><i style="width:3px;height:3px;border-radius:2px;background:${col};opacity:${blink}"></i><i style="width:3px;height:3px;border-radius:2px;background:${col};opacity:${blink}"></i></span>${segDigit(+s[2], w, hh, col)}${segDigit(+s[3], w, hh, col)}</span></div></div>`;
    },
  },
  {
    type: 'today', name: 'Today', cat: 'time', icon: 'sun', desc: 'Weekday, date, time and weather in a single tile.',
    sizes: ['m'], size: 'm', topics: ['clock', 'integ:weather'],
    tile(ctx, { 'integ:weather': w }) {
      const d = new Date(); const c = w?.connected ? w.current : null;
      return `<div class="tin wide" style="gap:calc(12px*var(--u))"><div class="col" style="gap:calc(5px*var(--u))"><span class="t-cap red">${WEEKDAYS_LONG[d.getDay()]}</span><span class="t-title">${MONTHS[d.getMonth()]} ${d.getDate()}</span></div><div class="col" style="gap:calc(5px*var(--u));align-items:flex-end"><span class="t-big" style="font-weight:600">${fmtTimeShort(d, ctx.cfg.behavior.clock24)}</span><span class="t-sub">${c ? `${wmo(c.weather_code, c.is_day).glyph} ${Math.round(c.temperature_2m)}°` : ''}</span></div></div>`;
    },
    ...W,
  },
  {
    type: 'clockweather', name: 'Clock & Weather', cat: 'time', icon: 'layers', desc: 'Time, date and temperature as three colour blocks in one square tile.',
    sizes: ['s'], size: 's', topics: ['clock', 'integ:weather'],
    tile(ctx, { 'integ:weather': w }) {
      const d = new Date(); const c = w?.connected ? w.current : null;
      const blk = (bg, fg, txt, flex = 1) => `<span style="flex:${flex};display:flex;align-items:center;justify-content:center;background:${bg};color:${fg};font-weight:700;font-size:calc(10px*var(--fu))" class="num">${txt}</span>`;
      return `<div style="position:absolute;inset:3px;border-radius:calc(var(--tile-r) - 3px);overflow:hidden;display:flex;flex-direction:column;gap:2px">${blk('#ff9f0a', '#3a2300', fmtTimeShort(d, true), 1.3)}<span style="flex:1;display:flex;gap:2px">${blk('#0a84ff', '#fff', d.getDate())}${blk('#30d158', '#063a14', c ? Math.round(c.temperature_2m) + '°' : '–')}</span></div><div class="tin sq"></div>`;
    },
    ...W,
  },
  {
    type: 'weekstrip', name: '7 Days', cat: 'time', icon: 'calendar', desc: 'This week as a strip of days, with today’s temperature.',
    sizes: ['m'], size: 'm', topics: ['clock', 'integ:weather'],
    tile(ctx, { 'integ:weather': w }) {
      const d = new Date(); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const days = Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x; });
      return `<div class="tin" style="gap:calc(3px*var(--u))">${days.map((x) => { const t = x.toDateString() === d.toDateString(); return `<span style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(4px*var(--u));width:calc(24px*var(--u));height:calc(44px*var(--u));border-radius:calc(9px*var(--u));${t ? 'background:#ff453a;color:#fff' : ''}"><span class="t-cap" style="font-size:calc(7.5px*var(--fu));${t ? '' : 'color:var(--text-2)'}">${WEEKDAYS[x.getDay()].slice(0, 2)}</span><span class="t-val" style="font-size:calc(12px*var(--fu))">${x.getDate()}</span>${t && w?.connected ? `<span style="font-size:calc(8px*var(--fu));font-weight:600">${Math.round(w.current.temperature_2m)}°</span>` : ''}</span>`; }).join('')}</div>`;
    },
  },
  { type: 'weather', name: 'Weather', cat: 'weather', icon: 'cloud', desc: 'Temperature now, with today’s high and low (Open-Meteo, no key needed).', sizes: ['s', 'm'], size: 'm', topics: ['integ:weather'], tile: (ctx, d) => weatherTile(ctx, d['integ:weather'], 'main'), ...W },
  { type: 'weatherDetails', name: 'Weather Details', cat: 'weather', icon: 'wind', desc: 'Wind, rain and the day’s range.', sizes: ['m'], size: 'm', topics: ['integ:weather'], tile: (ctx, d) => weatherTile(ctx, d['integ:weather'], 'details'), ...W },
  { type: 'weatherStatus', name: 'Weather Status', cat: 'weather', icon: 'cloud', desc: 'The conditions in words, with your city.', sizes: ['m'], size: 'm', topics: ['integ:weather'], tile: (ctx, d) => weatherTile(ctx, d['integ:weather'], 'status'), ...W },
  {
    type: 'forecast', name: 'Today & Forecast', cat: 'weather', icon: 'calendar', desc: 'Today next to the next three days.',
    sizes: ['m'], size: 'm', topics: ['integ:weather'],
    tile(ctx, { 'integ:weather': w }) {
      if (!w?.connected) return weatherTile(ctx, w, 'main');
      const dd = w.daily;
      return `<div class="tin" style="gap:calc(12px*var(--u))">${[0, 1, 2, 3].map((i) => `<div class="col" style="align-items:center;gap:calc(4px*var(--u))"><span class="t-cap" style="color:${i ? 'var(--text-2)' : '#ff453a'}">${i ? WEEKDAYS[localDay(dd.time[i]).getDay()] : 'Today'}</span><span style="font-size:calc(17px*var(--u));line-height:1">${wmo(dd.weather_code[i]).glyph}</span><span class="t-val">${Math.round(dd.temperature_2m_max[i])}°<span class="dim" style="font-weight:500"> ${Math.round(dd.temperature_2m_min[i])}°</span></span></div>`).join('')}</div>`;
    },
    ...W,
  },
  {
    type: 'hourly', name: 'Hourly', cat: 'weather', icon: 'clock', desc: 'The next six hours.',
    sizes: ['m'], size: 'm', topics: ['integ:weather'],
    tile(ctx, { 'integ:weather': w }) {
      if (!w?.connected) return weatherTile(ctx, w, 'main');
      const h = w.hourly; const h24 = ctx.cfg.behavior.clock24;
      const lbl = (t) => { const x = new Date(t).getHours(); return h24 ? x + 'h' : (x % 12 || 12) + (x < 12 ? 'a' : 'p'); };
      return `<div class="tin" style="gap:calc(10px*var(--u))">${[0, 1, 2, 3, 4, 5].map((i) => `<div class="col" style="align-items:center;gap:calc(4px*var(--u))"><span class="t-xs">${i ? lbl(h.time[i]) : 'Now'}</span><span style="font-size:calc(15px*var(--u));line-height:1">${wmo(h.weather_code[i]).glyph}</span><span class="t-val">${Math.round(h.temperature_2m[i])}°</span></div>`).join('')}</div>`;
    },
    ...W,
  },
  {
    type: 'sun', name: 'Sunrise & Sunset', cat: 'weather', icon: 'sunrise', desc: 'Where the sun is between sunrise and sunset.',
    sizes: ['m'], size: 'm', topics: ['clock', 'integ:weather'],
    tile(ctx, { 'integ:weather': w }) {
      if (!w?.connected) return weatherTile(ctx, w, 'main');
      const sr = new Date(w.daily.sunrise[0]), ss = new Date(w.daily.sunset[0]); const now = Date.now();
      const p = Math.max(0, Math.min(1, (now - sr) / (ss - sr)));
      const Wd = P(ctx, 64), H = P(ctx, 28); const x = p * Wd; const y = H - Math.sin(p * Math.PI) * (H - 6) - 2;
      const up = now > +sr && now < +ss; const h24 = ctx.cfg.behavior.clock24;
      return `<div class="tin wide"><svg width="${Wd}" height="${H + 4}" style="overflow:visible"><path d="M0 ${H} Q${Wd / 2} ${-H + 12} ${Wd} ${H}" fill="none" stroke="var(--text-3)" stroke-width="1.3" stroke-dasharray="2.5 3"/><line x1="-4" x2="${Wd + 4}" y1="${H}" y2="${H}" stroke="var(--track)" stroke-width="1"/><circle cx="${x}" cy="${up ? y : H}" r="${P(ctx, 5)}" fill="${up ? '#ffd60a' : '#5e5ce6'}" style="filter:drop-shadow(0 0 4px ${up ? '#ffd60a' : '#5e5ce6'})"/></svg>
        <div class="col" style="gap:calc(6px*var(--u))"><span class="t-sub num">↑ ${fmtTimeShort(sr, h24)}</span><span class="t-sub num">↓ ${fmtTimeShort(ss, h24)}</span></div></div>`;
    },
    ...W,
  },
];
