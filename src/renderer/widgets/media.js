import { icon, ring, esc, fmtDur, clamp, bar, slider, brandTile } from '../shared/ui.js';
import { soundPanel, soundOn, soundWheel } from './system.js';

const P = (ctx, n) => Math.round(n * ctx.u);
// icon size with the same parity as its box, so it sits on whole pixels in the middle
const fit = (box, n) => n + ((box - n) & 1);
const keyOf = (m) => `${m?.app}|${m?.title}|${m?.artist}`;
const isSpotify = (m) => /spotify/i.test(m?.app || '');
// Play/pause shows the new state at once: Windows publishes the player's status with a delay, so the
// requested state is held until the player reports it (or 3 s pass, then the real status wins again).
let wanted = null; // { key, playing, at }
const playing = (m) => {
  const real = m?.status === 'Playing';
  if (wanted && wanted.key === keyOf(m) && Date.now() - wanted.at < 3000 && real !== wanted.playing) return wanted.playing;
  wanted = null;
  return real;
};
// re-render every media tile and the open panel (the panel's tile is among them)
const rerenderAll = (ctx) => ctx.rerenderType?.(['nowplaying', 'nowplayingMini', 'nowplayingBar', 'mediacontrols', 'albumart']) ?? ctx.rerender(true);

// ---- playback position ----
// Windows reports the timeline only on events; between them we extrapolate from LastUpdatedTime.
// After a seek the player can take a moment to publish the new position, so the requested
// position is held until the player confirms it (or 6 s pass) - no jumping back.
const seekHold = new Map(); // track key -> { pos, at }
function rawPos(m, sp) {
  // a connected Spotify account knows the exact progress of the same track
  if (sp?.active && sp.track && isSpotify(m) && sp.track.title === m.title) return sp.progress + (sp.playing ? (Date.now() - sp.at) / 1000 : 0);
  return m.position + (playing(m) ? (Date.now() - m.updated) / 1000 : 0);
}
function pos(m, sp) {
  if (!m?.active || !m.duration) return 0;
  const k = keyOf(m); const h = seekHold.get(k);
  if (h) {
    const expect = h.pos + (playing(m) ? (Date.now() - h.at) / 1000 : 0);
    const reported = rawPos(m, sp);
    const confirmed = (m.updated > h.at || (sp?.at > h.at + 400)) && Math.abs(reported - expect) < 2.5;
    if (!confirmed && Date.now() - h.at < 6000) return clamp(expect, 0, m.duration);
    seekHold.delete(k);
  }
  return clamp(rawPos(m, sp), 0, m.duration);
}

// ---- cover colour, used for the progress fill, play button and a soft wash behind the artwork ----
const colors = new Map();
function coverColor(url, done) {
  if (!url) return null;
  if (colors.has(url)) return colors.get(url);
  if (colors.size > 50) colors.delete(colors.keys().next().value); // one entry per track: keep the recent ones
  colors.set(url, null);
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); const w = 1 + (mx - mn) / 32; r += d[i] * w; gg += d[i + 1] * w; b += d[i + 2] * w; n += w; }
      let [R, G, B] = [r / n, gg / n, b / n];
      // keep it readable on dark glass: lift very dark colours, tame very light ones
      const l = (Math.max(R, G, B) + Math.min(R, G, B)) / 2;
      const k = l < 90 ? 90 / Math.max(l, 1) : l > 200 ? 200 / l : 1;
      [R, G, B] = [R, G, B].map((v) => Math.round(clamp(v * k, 0, 255)));
      colors.set(url, `rgb(${R},${G},${B})`); done?.();
    } catch { colors.set(url, null); }
  };
  img.src = url;
  return null;
}

const cover = (m, size, cls = '') => (m?.coverUrl
  ? `<span class="np-cover ${cls}" style="width:${size};height:${size}"><img src="${m.coverUrl}" alt="">${isSpotify(m) ? `<i class="np-src">${brandTile('spotify', 12)}</i>` : ''}</span>`
  : `<span class="np-cover ph ${cls}" style="width:${size};height:${size}">${icon('music', 16)}</span>`);
const appName = (id = '') => {
  const s = id.toLowerCase();
  if (s.includes('spotify')) return 'Spotify'; if (s.includes('edge')) return 'Microsoft Edge'; if (s.includes('chrome')) return 'Google Chrome'; if (s.includes('firefox')) return 'Firefox';
  if (s.includes('zune') || s.includes('media')) return 'Media Player'; if (s.includes('vlc')) return 'VLC';
  return id.split('!')[0].split('.').pop() || 'App';
};
// one control style everywhere: icon-only prev/next, a solid circular play button
const ctl = (ctx, a, ic, d, primary = false, disabled = false, color) => `<button class="np-btn ${primary ? 'primary' : ''}" data-a="${a}" ${disabled ? 'disabled' : ''} style="width:${P(ctx, d)}px;height:${P(ctx, d)}px;${primary && color ? `background:${color}` : ''}">${icon(ic, fit(P(ctx, d), P(ctx, 13)))}</button>`;

// a new track fades in once (opacity only, no movement)
function swapClass(ctx, m) {
  const k = keyOf(m);
  if (ctx.state.key !== k) { const first = ctx.state.key === undefined; ctx.state.key = k; if (!first) return 'np-swap'; }
  return '';
}

const on = {
  toggle: async (ctx) => {
    const m = ctx.hub.peek('media'); if (!m?.active) return;
    wanted = { key: keyOf(m), playing: !playing(m), at: Date.now() };
    rerenderAll(ctx);
    await ctx.act('media', { action: 'toggle' }).catch(() => { wanted = null; rerenderAll(ctx); });
    for (const ms of [300, 900, 1800]) setTimeout(() => ctx.hub.refresh('media'), ms);
    setTimeout(() => rerenderAll(ctx), 3050); // if the player never confirmed, show its real state again
  },
  next: async (ctx) => { await ctx.act('media', { action: 'next' }); for (const ms of [400, 1200]) setTimeout(() => ctx.hub.refresh('media'), ms); },
  prev: async (ctx) => { await ctx.act('media', { action: 'prev' }); for (const ms of [400, 1200]) setTimeout(() => ctx.hub.refresh('media'), ms); },
  // dragging only moves the time label; the seek happens once, on release
  scrubMove: (ctx, el) => { const m = ctx.hub.peek('media'); if (!m?.duration) return; const p = (Number(el.value) / 1000) * m.duration; const row = el.closest('.np-scrub'); row.querySelector('.cur').textContent = fmtDur(p); row.querySelector('.rem').textContent = '-' + fmtDur(m.duration - p); },
  scrubDone: async (ctx, el) => {
    const m = ctx.hub.peek('media'); if (!m?.duration) return;
    const target = (Number(el.value) / 1000) * m.duration;
    seekHold.set(keyOf(m), { pos: target, at: Date.now() });
    const sp = ctx.hub.peek('integ:spotify');
    let ok = false;
    if (isSpotify(m) && sp?.connected) ok = await ctx.act('spotifySeek', { position: target }).catch(() => false);
    if (!ok) ok = await ctx.act('media', { action: 'seek', position: target }).catch(() => false);
    if (!ok) { seekHold.delete(keyOf(m)); ctx.toast('This player does not accept seeking'); }
    setTimeout(() => ctx.hub.refresh('media'), 350);
  },
  vol: (ctx, el) => { clearTimeout(ctx.state.vt); ctx.state.vt = setTimeout(() => ctx.act('volume', { level: Number(el.value), flow: 0 }), 30); el.closest('.ctl-row').querySelector('.val').textContent = el.value + '%'; },
  spotify: (ctx) => ctx.act('open', { target: 'spotify:' }),
  connect: (ctx) => ctx.openSettings('integrations'),
};

function upNext(ctx, m, sp) {
  if (!isSpotify(m) && !sp?.connected) return '';
  if (!sp?.connected) return `<div class="np-next"><div class="np-next-head"><span>Up next</span></div><div class="np-hint">${brandTile('spotify', 16)}<span>Connect your Spotify account to see the playlist and what plays next.</span><button class="btn sm" data-a="connect">Connect</button></div></div>`;
  if (!sp.active) return '';
  const c = sp.context;
  const list = (sp.queue || []).filter(Boolean).slice(0, 4);
  return `<div class="np-next"><div class="np-next-head"><span>Up next</span>${c?.name ? `<em title="${esc(c.name)}">${c.type === 'playlist' ? icon('layers', 11) : c.type === 'album' ? icon('music', 11) : ''} ${esc(c.name)}</em>` : ''}</div>
    ${list.length ? list.map((t) => `<div class="np-q">${t.cover ? `<img src="${esc(t.cover)}" alt="">` : `<span class="ph">${icon('music', 11)}</span>`}<span class="grow"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></span><span class="kbd num">${fmtDur(t.duration)}</span></div>`).join('') : '<div class="pn-muted">Nothing queued.</div>'}</div>`;
}

function panel(ctx, { media: m, volume: v, 'integ:spotify': sp }) {
  if (!m?.active) return `<div class="pn"><div class="pn-head"><h3>${icon('music', 18)} Now Playing</h3></div><div class="empty">Nothing is playing.<br><span class="pn-muted">Any app that reports to Windows (Spotify, browsers, Media Player …) shows up here.</span></div><div class="btns center"><button class="btn" data-a="spotify">Open Spotify</button></div></div>`;
  const p = pos(m, sp); const col = coverColor(m.coverUrl, () => ctx.rerender(true));
  const swap = swapClass(ctx, m);
  return `<div class="pn np" style="${col ? `--np:${col}` : ''}">
    ${col ? '<div class="np-wash"></div>' : ''}
    <div class="np-head ${swap}">${cover(m, '96px', 'big')}<div class="np-meta"><span class="np-app">${isSpotify(m) ? brandTile('spotify', 14) : icon('music', 12)} ${esc(appName(m.app))}</span><b title="${esc(m.title)}">${esc(m.title)}</b><span class="np-artist">${esc(m.artist || '')}</span>${m.album ? `<span class="np-album">${esc(m.album)}</span>` : ''}</div></div>
    ${m.duration ? `<div class="np-scrub">${slider((p / m.duration) * 1000, `data-input="scrubMove" data-change="scrubDone" ${m.canSeek === false ? 'disabled' : ''}`, { max: 1000, cls: 'sm', color: col || 'var(--text)' })}<div class="np-times"><span class="cur num">${fmtDur(p)}</span><span class="rem num">-${fmtDur(m.duration - p)}</span></div></div>` : ''}
    <div class="np-ctl">${ctl({ u: 1 }, 'prev', 'prev', 40, false, m.canPrev === false)}${ctl({ u: 1 }, 'toggle', playing(m) ? 'pause' : 'play', 52, true)}${ctl({ u: 1 }, 'next', 'next', 40, false, m.canNext === false)}</div>
    ${v ? `<div class="ctl-row"><span class="ibtn" style="pointer-events:none">${icon(v.muted ? 'mute' : 'volume', 15)}</span>${slider(v.level, 'data-input="vol"', { cls: 'sm' })}<span class="val">${v.level}%</span></div>` : ''}
    ${upNext(ctx, m, sp)}</div>`;
}

export default [
  {
    type: 'nowplaying', name: 'Now Playing', cat: 'media', icon: 'music', desc: 'Cover art, title and full controls for Spotify or any player – with seeking and up next.',
    sizes: ['s', 'm', 'l'], size: 'm', topics: ['media'], panelTopics: ['volume', 'integ:spotify'],
    tile(ctx, { media: m }) {
      const p = m?.duration ? (pos(m, ctx.hub.peek('integ:spotify')) / m.duration) * 100 : 0;
      const col = m?.coverUrl ? coverColor(m.coverUrl, () => ctx.rerender()) : null;
      const swap = swapClass(ctx, m);
      if (ctx.size === 's') return `<div class="tin sq ${swap}">${cover(m, 'calc(38px*var(--u))')}</div>`;
      const title = m?.active ? esc(m.title) : 'Nothing playing';
      const sub = m?.active ? esc(m.artist || appName(m.app)) : 'Media';
      const W = ctx.size === 'l' ? 150 : 96;
      const controls = `<div class="np-ctl-sm">${ctl(ctx, 'prev', 'prev', 26)}${ctl(ctx, 'toggle', playing(m) ? 'pause' : 'play', 30, true)}${ctl(ctx, 'next', 'next', 26)}</div>`;
      return `<div class="tin np-tile ${swap}">${cover(m, 'calc(38px*var(--u))')}<div class="col np-text" style="width:calc(${W}px*var(--u))"><span class="t-title" title="${title}">${title}</span><span class="t-sub">${sub}</span><span class="np-line"><i style="width:${p.toFixed(1)}%"></i></span></div>${controls}</div>`;
    },
    panel, on, panelWidth: 340,
  },
  {
    type: 'nowplayingMini', name: 'Now Playing Mini', cat: 'media', icon: 'play', desc: 'One round play button with the track’s progress.',
    sizes: ['s'], size: 's', topics: ['media'], panelTopics: ['volume', 'integ:spotify'],
    tile(ctx, { media: m }) {
      const p = m?.duration ? (pos(m) / m.duration) * 100 : 0;
      return `<div class="tin sq"><span data-a="toggle" style="display:flex">${ring(p, { size: P(ctx, 42), stroke: Math.max(3, P(ctx, 3.5)), color: 'var(--accent)', label: `<span style="display:flex">${icon(playing(m) ? 'pause' : 'play', fit(P(ctx, 42), P(ctx, 15)))}</span>` })}</span></div>`;
    },
    panel, on, panelWidth: 340,
  },
  {
    type: 'nowplayingBar', name: 'Now Playing Bar', cat: 'media', icon: 'music', desc: 'The track with a progress bar and skip.',
    sizes: ['m'], size: 'm', topics: ['media'], panelTopics: ['volume', 'integ:spotify'],
    tile(ctx, { media: m }) {
      const p = m?.duration ? (pos(m) / m.duration) * 100 : 0;
      return `<div class="tin"><div class="col" style="width:calc(140px*var(--u));gap:calc(7px*var(--u))"><div class="row" style="justify-content:space-between"><span class="t-title">${m?.active ? esc(m.title) : 'Nothing playing'}</span><span class="t-xs num">${m?.duration ? fmtDur(pos(m)) : ''}</span></div>${bar(p, 'var(--text)')}</div><div class="np-ctl-sm">${ctl(ctx, 'toggle', playing(m) ? 'pause' : 'play', 30, true)}${ctl(ctx, 'next', 'next', 26)}</div></div>`;
    },
    panel, on, panelWidth: 340,
  },
  {
    type: 'albumart', name: 'Album Art', cat: 'media', icon: 'layers', desc: 'The current track’s cover as a square tile.',
    sizes: ['s'], size: 's', topics: ['media'], panelTopics: ['volume', 'integ:spotify'],
    tile(ctx, { media: m }) {
      return m?.coverUrl ? `<img src="${m.coverUrl}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"><div class="tin sq"></div>`
        : `<div class="tin sq"><span style="display:flex" class="dim">${icon('music', P(ctx, 22))}</span></div>`;
    },
    panel, on, panelWidth: 340,
  },
  {
    type: 'mediacontrols', name: 'Playback Controls', cat: 'media', icon: 'next', desc: 'Previous, play/pause and next – without the title.',
    sizes: ['m'], size: 'm', topics: ['media'], panelTopics: ['volume', 'integ:spotify'],
    tile(ctx, { media: m }) {
      const s = P(ctx, 40);
      const b = (a, ic, n) => `<button class="ico-btn" data-a="${a}" style="width:${s}px;height:${s}px">${icon(ic, fit(s, P(ctx, n)))}</button>`;
      return `<div class="tin tight">${b('prev', 'prev', 16)}${b('toggle', playing(m) ? 'pause' : 'play', 17)}${b('next', 'next', 16)}</div>`;
    },
    panel, on, panelWidth: 340,
  },
  {
    type: 'audiooutput', name: 'Audio Output', cat: 'media', icon: 'headphones', desc: 'Volume slider right in the dock; click for devices and the app mixer.',
    sizes: ['m'], size: 'm', topics: ['volume'], panelTopics: ['audioDevices', 'audioSessions'],
    tile(ctx, { volume: v }) {
      const muted = v?.muted || v?.level === 0;
      return `<div class="tin" style="gap:calc(8px*var(--u))"><button class="ico-btn" data-a="mute" data-tip="${muted ? 'Unmute' : 'Mute'}" style="width:${P(ctx, 34)}px;height:${P(ctx, 34)}px">${icon(muted ? 'mute' : 'volume', P(ctx, 18))}</button><span style="width:calc(104px*var(--u));display:block" data-noclick>${slider(v?.level ?? 0, 'data-input="out"', { cls: 'sm' })}</span><span class="t-val num" style="width:calc(26px*var(--fu));text-align:right">${v?.muted ? '–' : v?.level ?? ''}</span></div>`;
    },
    panel: soundPanel, on: soundOn, wheel: soundWheel, panelWidth: 340,
  },
];
