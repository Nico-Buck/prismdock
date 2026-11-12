// Small shared toolkit: escaping, formatting, SVG icons, rings, gauges and bars.
// Line and bar charts live in graph.js.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const C = { blue: '#0a84ff', green: '#30d158', red: '#ff453a', orange: '#ff9f0a', yellow: '#ffd60a', purple: '#bf5af2', pink: '#ff375f', teal: '#64d2ff', indigo: '#5e5ce6', mint: '#66d4cf', gray: '#8e8e93' };

export function fmtBytes(b, digits = 1) {
  if (b == null || isNaN(b)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : digits)} ${u[i]}`;
}
export function fmtRate(bps) {
  if (bps == null) return '–';
  const bits = bps * 8;
  if (bits >= 1e9) return (bits / 1e9).toFixed(1) + ' Gb/s';
  if (bits >= 1e6) return (bits / 1e6).toFixed(1) + ' Mb/s';
  if (bits >= 1e3) return (bits / 1e3).toFixed(0) + ' kb/s';
  return bits.toFixed(0) + ' b/s';
}
export function fmtNum(n) {
  if (n == null || isNaN(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toLocaleString('en-US');
}
export function fmtMoney(v, cur = 'EUR') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v); } catch { return v.toFixed(0) + ' ' + cur; }
}
export function fmtDur(sec, short = false) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (short) return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtClock(d, h24 = true, seconds = false) {
  return d.toLocaleTimeString(h24 ? 'en-GB' : 'en-US', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: !h24 });
}
export function relTime(ts) {
  const diff = (ts - Date.now()) / 1000;
  const a = Math.abs(diff);
  const s = a < 60 ? 'now' : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.floor(a / 3600)}h ${Math.round((a % 3600) / 60)}m` : `${Math.round(a / 86400)} d`;
  if (a < 60) return s;
  return diff > 0 ? `in ${s}` : `${s} ago`;
}
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => d.toLocaleDateString('en-US', opts);
// Open-Meteo gives sunrise/sunset as the city's wall-clock time ("2026-11-12T07:21"); as moments in time
// they need the city's UTC offset, or the sun is placed wrong when the city is in another time zone
export const sunMoments = (w) => [w.daily.sunrise[0], w.daily.sunset[0]].map((s) => (w.utcOffset == null ? new Date(s) : new Date(Date.parse(s + 'Z') - w.utcOffset * 1000)));
export const fmtTimeShort = (d, h24 = true) => d.toLocaleTimeString(h24 ? 'en-GB' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: !h24 });

// ---------------- icons (24x24, 1.8 stroke, rounded) ----------------
const P = {
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  ram: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v10M11 7v10M15 7v10M6 17v3M18 17v3"/>',
  gpu: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="9" cy="12" r="3"/><path d="M15 10h3M15 14h3M5 18v2"/>',
  temp: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>',
  net: '<path d="M8 4v15M4.5 15.5 8 19l3.5-3.5M16 20V5M12.5 8.5 16 5l3.5 3.5"/>',
  disk: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 14h18"/><circle cx="17" cy="16.5" r=".8" fill="currentColor"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="3"/><path d="M22 10.5v3"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor"/>',
  bluetooth: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M10 11v6M14 11v6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.7L16.5 9.5"/>',
  checkSmall: '<path d="m6 12.5 4 4L18 8"/>',
  note: '<path d="M6 3.5h9l4 4v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-14A2 2 0 0 1 6 3.5Z"/><path d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16h5"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 2.5h5M18.5 6.5l1.5-1.5"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5 15 11M10 2.5h4M12 2.5V6"/>',
  hourglass: '<path d="M6.5 3h11M6.5 21h11M7.5 3c0 5 9 5 9 9s-9 4-9 9M16.5 3c0 5-9 5-9 9s9 4 9 9"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  screen: '<rect x="3" y="4" width="18" height="12.5" rx="2.5"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  sunrise: '<path d="M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0M12 3v4M9.5 5.5 12 3l2.5 2.5M4 11l1.5 1M20 11l-1.5 1"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  play: '<path d="M6.6 5.2v13.6a1 1 0 0 0 1.5.86l11.2-6.8a1 1 0 0 0 0-1.72L8.1 4.34a1 1 0 0 0-1.5.86Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 6.2v11.6a.8.8 0 0 0 1.25.66L14.5 13a1.2 1.2 0 0 0 0-2L6.25 5.54A.8.8 0 0 0 5 6.2Z" fill="currentColor" stroke="none"/><rect x="16.5" y="5.5" width="2.6" height="13" rx="1.2" fill="currentColor" stroke="none"/>',
  prev: '<path d="M19 6.2v11.6a.8.8 0 0 1-1.25.66L9.5 13a1.2 1.2 0 0 1 0-2l8.25-5.46A.8.8 0 0 1 19 6.2Z" fill="currentColor" stroke="none"/><rect x="4.9" y="5.5" width="2.6" height="13" rx="1.2" fill="currentColor" stroke="none"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 11 3.75 3.75 0 0 0 7 18.5Z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z"/><circle cx="12" cy="12.8" r="3.5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10Z"/>',
  file: '<path d="M6.5 3h7l5 5v11.5A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3Z"/><path d="M13 3v5.5h5.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1Z"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5ZM12 14v6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  chevronUp: '<path d="m6 14.5 6-6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  power: '<path d="M12 3v9M7 5.8a8 8 0 1 0 10 0"/>',
  chart: '<path d="M4 19.5h16M6.5 16l4-5 3.5 3 4.5-6.5"/>',
  dollar: '<path d="M12 3v18M16.5 7.5C16 5.8 14.3 5 12 5c-2.6 0-4.5 1.2-4.5 3.3 0 4.7 9.3 2.6 9.3 7.4 0 2.1-2 3.3-4.8 3.3-2.5 0-4.2-.9-4.8-2.7"/>',
  sparkles: '<path d="M12 3.5 13.6 9l5.4 1.5-5.4 1.6L12 17.5l-1.6-5.4L5 10.5 10.4 9 12 3.5ZM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/>',
  layers: '<path d="m12 3.5 9 4.8-9 4.8-9-4.8 9-4.8Z"/><path d="m3 12.3 9 4.8 9-4.8M3 16.3l9 4.8 9-4.8"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z"/>',
  drop: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3Z"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5"/>',
  flag: '<path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
  flame: '<path d="M12 21.5c4 0 6.5-2.6 6.5-6.2 0-4.8-5-6.8-4.3-12.3C10 5 7.5 8.3 8.2 12.2 6.8 11.6 6 10.3 6 9c-1 1.4-.5 4-.5 6.3 0 3.6 2.5 6.2 6.5 6.2Z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  airplane: '<path d="M10.5 3.8c0-.8.7-1.3 1.5-1.3s1.5.5 1.5 1.3V9l7.5 4.5v2L13.5 13v5l2.5 2v1.5L12 20.5 8 21.5V20l2.5-2v-5L3 15.5v-2L10.5 9V3.8Z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9"/>',
  window: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18"/>',
  winlogo: '<path d="M3.5 5.3 10.6 4.3v7H3.5ZM11.6 4.15 20.5 2.9v8.4h-8.9ZM3.5 12.3h7.1v7l-7.1-1ZM11.6 12.3h8.9v8.8l-8.9-1.25Z" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.6"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.6"/>',
  sliders: '<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="14" r="2" fill="currentColor"/><circle cx="12" cy="8" r="2" fill="currentColor"/><circle cx="19" cy="15" r="2" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  drag: '<circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/>',
};
// labels of the widget sizes, used by the context menu and the Layout Editor
export const SIZE_LABEL = { s: 'Small', m: 'Medium', l: 'Large' };

export function icon(name, size = 18, extra = '') {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${P[name] || P.grid}</svg>`;
}
export const ICON_NAMES = Object.keys(P);

// Brand-coloured app tiles (own simplified glyphs, not vendor logos)
const BRAND = {
  claude: ['#d97757', '<path d="M12 3.2v17.6M3.2 12h17.6M5.8 5.8l12.4 12.4M18.2 5.8 5.8 18.2" stroke="#fff" stroke-width="2.1"/>'],
  chatgpt: ['#ffffff', '<path d="M12 4.2a3.6 3.6 0 0 1 6.2 2.5 3.6 3.6 0 0 1 1.2 6.4 3.6 3.6 0 0 1-5 4.7 3.6 3.6 0 0 1-6.6-.4 3.6 3.6 0 0 1-3.2-5.9A3.6 3.6 0 0 1 7.3 5a3.6 3.6 0 0 1 4.7-.8Z" stroke="#111" stroke-width="1.6"/><circle cx="12" cy="12" r="2.4" stroke="#111" stroke-width="1.6"/>'],
  gemini: ['#ffffff', '<path d="M12 3c.6 4.8 4.2 8.4 9 9-4.8.6-8.4 4.2-9 9-.6-4.8-4.2-8.4-9-9 4.8-.6 8.4-4.2 9-9Z" fill="url(#gg)" stroke="none"/><defs><linearGradient id="gg" x1="3" y1="3" x2="21" y2="21"><stop offset="0" stop-color="#4285f4"/><stop offset=".5" stop-color="#9b72cb"/><stop offset="1" stop-color="#d96570"/></linearGradient></defs>'],
  cursor: ['#0c0c0e', '<path d="M12 3.5 19.5 7.8v8.4L12 20.5l-7.5-4.3V7.8L12 3.5Z" stroke="#fff" stroke-width="1.5"/><path d="M4.5 7.8 12 12l7.5-4.2M12 12v8.5" stroke="#fff" stroke-width="1.5"/>'],
  grok: ['#0c0c0e', '<path d="M6 18 18 6M9.5 6.5a6 6 0 0 1 8.3 8.3M14.5 17.5a6 6 0 0 1-8.3-8.3" stroke="#fff" stroke-width="1.8"/>'],
  deepseek: ['#4d6bfe', '<path d="M4 13c2 4 8 6 12 3 2.5-1.8 3.5-5 3-8-1.5 2-3 2.3-4.5 2-2-.5-4-1.5-6.5-.5S4 11 4 13Z" fill="#fff" stroke="none"/>'],
  github: ['#f5f5f7', '<path d="M12 3a9 9 0 0 0-2.85 17.54c.45.08.62-.2.62-.43v-1.6c-2.5.54-3.04-1.06-3.04-1.06-.41-1.04-1-1.32-1-1.32-.82-.56.06-.55.06-.55.9.07 1.38.93 1.38.93.8 1.38 2.11.98 2.62.75.08-.58.32-.98.57-1.2-2-.23-4.1-1-4.1-4.45 0-.98.35-1.79.93-2.42-.1-.23-.4-1.14.08-2.38 0 0 .76-.24 2.48.92a8.6 8.6 0 0 1 4.5 0c1.72-1.16 2.47-.92 2.47-.92.49 1.24.18 2.15.09 2.38.58.63.92 1.44.92 2.42 0 3.46-2.1 4.22-4.1 4.44.32.28.61.83.61 1.67v2.48c0 .24.16.52.62.43A9 9 0 0 0 12 3Z" fill="#111" stroke="none"/>'],
  leetcode: ['#1f1f22', '<path d="M14.5 5 8 11.5a1.5 1.5 0 0 0 0 2.1l4.4 4.4a1.5 1.5 0 0 0 2.1 0l2-2" stroke="#ffa116" stroke-width="2"/><path d="M10.5 13h7" stroke="#b3b3b3" stroke-width="2"/>'],
  linear: ['#5e6ad2', '<path d="M4.6 13.6 10.4 19.4M4.2 10.6l9.2 9.2M5.4 7.6l11 11M7.6 5.4l11 11M10.6 4.2l9.2 9.2M13.6 4.6l5.8 5.8" stroke="#fff" stroke-width="1.6"/>'],
  supabase: ['#1c1c1c', '<path d="M13 3 5 13.5h7l-1 7.5 8-10.5h-7l1-7.5Z" fill="#3ecf8e" stroke="none"/>'],
  youtube: ['#ff0033', '<path d="M10 8.8v6.4l5.5-3.2L10 8.8Z" fill="#fff" stroke="none"/>'],
  instagram: ['linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)', '<rect x="5" y="5" width="14" height="14" rx="4" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="3.3" stroke="#fff" stroke-width="1.8"/><circle cx="16.3" cy="7.7" r=".9" fill="#fff" stroke="none"/>'],
  tiktok: ['#010101', '<path d="M13.5 4v10.2a2.8 2.8 0 1 1-2.8-2.8" stroke="#25f4ee" stroke-width="2"/><path d="M14 4c.4 2.5 2 4 4.5 4.2" stroke="#fe2c55" stroke-width="2"/>'],
  x: ['#000000', '<path d="M5 4.5h3.8l10.2 15H15.2L5 4.5ZM18.5 4.5l-5.6 6.4M5.5 19.5l5.6-6.4" stroke="#fff" stroke-width="1.6"/>'],
  stripe: ['#635bff', '<path d="M14.8 8.6c-.8-.4-1.8-.7-2.9-.7-1.1 0-1.8.4-1.8 1.1 0 2 5.9 1 5.9 5 0 1.9-1.6 3.1-4 3.1-1.3 0-2.6-.3-3.6-.9" stroke="#fff" stroke-width="2"/>'],
  paypal: ['#ffffff', '<path d="M8 19.5 10.3 5h5c2.6 0 3.9 1.6 3.4 3.9-.6 2.7-2.6 3.8-5.2 3.8h-2.2L10.4 19.5H8Z" fill="#003087" stroke="none"/><path d="M6.2 17 8.5 3.5h5c2.4 0 3.6 1.3 3.3 3.3" stroke="#009cde" stroke-width="1.6"/>'],
  shopify: ['#95bf47', '<path d="M7 7.5 9.5 6c.4-2 1.5-3 2.6-3 1.3 0 2 1 2.3 2.6l1.6.4 1 13.5-11 1.5L7 7.5Z" fill="#fff" stroke="none"/><path d="M11 13.5c.6.4 1.3.6 2 .3.9-.4.4-1.4-.6-1.6-1.1-.3-1.6-1.6-.4-2.3.6-.3 1.3-.2 1.8 0" stroke="#5e8e3e" stroke-width="1.2"/>'],
  spotify: ['#1ed760', '<path d="M6.5 9.5c3.8-1.2 8-1 11.2.9M7.2 12.8c3.1-.9 6.3-.6 9 .8M7.8 15.8c2.4-.6 4.8-.4 6.8.6" stroke="#000" stroke-width="1.8"/>'],
  google: ['#ffffff', '<path d="M20 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.5a3.9 3.9 0 0 1-1.7 2.5v2.1h2.7c1.6-1.5 2.5-3.6 2.5-6.2Z" fill="#4285f4" stroke="none"/><path d="M12 20.3c2.3 0 4.2-.8 5.5-2l-2.7-2.1c-.8.5-1.7.8-2.8.8a4.8 4.8 0 0 1-4.6-3.4H4.6v2.2A8.3 8.3 0 0 0 12 20.3Z" fill="#34a853" stroke="none"/><path d="M7.4 13.6a5 5 0 0 1 0-3.2V8.2H4.6a8.3 8.3 0 0 0 0 7.6l2.8-2.2Z" fill="#fbbc05" stroke="none"/><path d="M12 7c1.3 0 2.4.4 3.3 1.3l2.4-2.4A8.3 8.3 0 0 0 4.6 8.2l2.8 2.2A4.8 4.8 0 0 1 12 7Z" fill="#ea4335" stroke="none"/>'],
};
export function brandTile(name, size = 36) {
  const [bg, glyph] = BRAND[name] || ['#2c2c2e', '<circle cx="12" cy="12" r="5" stroke="#fff"/>'];
  return `<span class="brand" style="width:${size}px;height:${size}px;background:${bg}"><svg viewBox="0 0 24 24" width="${Math.round(size * 0.64)}" height="${Math.round(size * 0.64)}" fill="none" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg></span>`;
}


// ---------------- rings, gauges, progress bars ----------------
export function ring(pct, { size = 40, stroke = 4, color = C.blue, track = 'var(--track)', label = '', sub = '', cls = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = clamp(pct ?? 0, 0, 100);
  return `<span class="ring ${cls}" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})" class="ring-arc"/>
    </svg>
    ${label ? `<span class="ring-label">${label}${sub ? `<small>${sub}</small>` : ''}</span>` : ''}
  </span>`;
}
export function gauge(pct, { size = 46, stroke = 4.5, color = C.green, label = '', sub = '' } = {}) {
  // 270° arc
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, arc = c * 0.75;
  const p = clamp(pct ?? 0, 0, 100);
  return `<span class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(135deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${arc} ${c}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${arc * p / 100} ${c}" class="ring-arc"/>
    </svg>
    <span class="ring-label">${label}${sub ? `<small>${sub}</small>` : ''}</span>
  </span>`;
}
export function bar(pct, color = C.green, cls = '') {
  return `<span class="pbar ${cls}"><i style="width:${clamp(pct ?? 0, 0, 100)}%;background:${color}"></i></span>`;
}
// label | bar | value, on a fixed grid so values of any length never shift the bar
export function meter(label, pct, value, color = C.green, sub = '') {
  return `<span class="meter"><b>${label}</b>${bar(pct, color)}${sub ? `<em>${sub}</em>` : ''}<i>${value}</i></span>`;
}
// range input with a filled track (--p is kept in sync by the dock's input handler)
export function slider(value, attrs = "", { min = 0, max = 100, step = 1, color = "var(--text)", cls = "" } = {}) {
  const p = ((value - min) / (max - min || 1)) * 100;
  return `<input type="range" class="rng ${cls}" min="${min}" max="${max}" step="${step}" value="${value}" style="--p:${p}%;--fill:${color}" ${attrs}>`;
}
// Weather codes (WMO) -> label + glyph
export function wmo(code, isDay = 1) {
  const m = {
    0: ['Clear', isDay ? '☀️' : '🌙'], 1: ['Mostly clear', isDay ? '🌤️' : '🌙'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
    56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'], 61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
    66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'], 71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
    80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '⛈️'], 85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'],
    95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm with hail', '⛈️'], 99: ['Thunderstorm with hail', '⛈️'],
  };
  const [label, glyph] = m[code] || ['–', '☁️'];
  return { label, glyph };
}
