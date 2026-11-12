// Spotify Web API (official): playlist / album context, up-next queue and precise seeking.
// Sign-in is OAuth "authorization code with PKCE" against the user's own Spotify developer app:
// no client secret, the browser handles the login, a one-shot loopback server receives the code.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const REDIRECT_PORT = 43117;
const REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = 'user-read-playback-state user-read-currently-playing user-modify-playback-state playlist-read-private playlist-read-collaborative';

let store; let token = null; let tokenExp = 0;
const init = (s) => { store = s; };
const clientId = () => (store.config.integrations.spotify?.clientId || '').trim();
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function form(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || r.statusText);
  return j;
}

// Opens the Spotify consent page and resolves once the browser comes back to the loopback address.
function connect() {
  const id = clientId();
  if (!id) return Promise.reject(new Error('Enter your Spotify app’s Client ID first'));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(12));
  return new Promise((resolve, reject) => {
    const page = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>PrismDock</title><body style="font:15px Segoe UI,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div><h2 style="margin:0 0 8px">${ok ? 'Spotify connected' : 'Spotify connection failed'}</h2><p style="opacity:.7">${msg}</p></div></body>`;
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.statusCode = 404; res.end(); return; }
      const done = (ok, msg, err) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page(ok, msg)); srv.close(); clearTimeout(timer); err ? reject(err) : resolve(true); };
      if (u.searchParams.get('state') !== state) return done(false, 'The sign-in response did not match. Please try again.', new Error('State mismatch'));
      if (u.searchParams.get('error')) return done(false, 'Access was not granted.', new Error(u.searchParams.get('error')));
      try {
        const t = await form('https://accounts.spotify.com/api/token', { grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: REDIRECT, client_id: id, code_verifier: verifier });
        token = t.access_token; tokenExp = Date.now() + (t.expires_in - 60) * 1000;
        store.setSecret('spotify.refresh', t.refresh_token);
        done(true, 'You can close this tab and return to PrismDock.');
      } catch (e) { done(false, e.message, e); }
    });
    const timer = setTimeout(() => { srv.close(); reject(new Error('Sign-in timed out')); }, 5 * 60 * 1000);
    srv.on('error', (e) => { clearTimeout(timer); reject(new Error(`Port ${REDIRECT_PORT} is busy (${e.code})`)); });
    srv.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state });
      shell.openExternal(`https://accounts.spotify.com/authorize?${q}`);
    });
  });
}

function disconnect() { token = null; tokenExp = 0; store.setSecret('spotify.refresh', ''); }

// one refresh at a time: Spotify rotates refresh tokens, and two parallel refreshes with the same one
// (player + queue are requested together) could leave a revoked token stored
let refreshing = null;
async function accessToken() {
  if (token && Date.now() < tokenExp) return token;
  const refresh = store.getSecret('spotify.refresh');
  if (!refresh || !clientId()) return null;
  refreshing ||= (async () => {
    try {
      const t = await form('https://accounts.spotify.com/api/token', { grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId() });
      token = t.access_token; tokenExp = Date.now() + (t.expires_in - 60) * 1000;
      if (t.refresh_token) store.setSecret('spotify.refresh', t.refresh_token);
      return token;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

async function api(path, opts = {}) {
  const tk = await accessToken();
  if (!tk) throw Object.assign(new Error('Not connected'), { code: 'NOCONN' });
  const r = await fetch('https://api.spotify.com/v1' + path, { ...opts, headers: { Authorization: `Bearer ${tk}`, ...(opts.headers || {}) } });
  if (r.status === 204) return null;
  if (r.status === 401) { token = null; tokenExp = 0; } // revoked or expired early: refresh on the next call
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || `${r.status} ${r.statusText}`);
  return j;
}

const img = (images, size = 64) => { if (!images?.length) return null; const s = [...images].sort((a, b) => (a.width || 0) - (b.width || 0)); return (s.find((i) => (i.width || 0) >= size) || s.at(-1)).url; };
const track = (t) => (t ? { title: t.name, artist: (t.artists || t.show ? (t.artists || []).map((a) => a.name).join(', ') || t.show?.name : ''), cover: img(t.album?.images || t.images, 64), duration: (t.duration_ms || 0) / 1000, uri: t.uri } : null);

let contextCache = { uri: null, value: null };
async function context(ctx) {
  if (!ctx?.uri) return null;
  if (contextCache.uri === ctx.uri) return contextCache.value;
  const [, type, id] = ctx.uri.split(':');
  let value = { type, name: null, cover: null };
  try {
    if (type === 'playlist') { const p = await api(`/playlists/${id}?fields=name,images,tracks.total`); value = { type, name: p.name, cover: img(p.images, 64), total: p.tracks?.total }; }
    else if (type === 'album') { const a = await api(`/albums/${id}`); value = { type, name: a.name, cover: img(a.images, 64), total: a.total_tracks }; }
    else if (type === 'artist') { const a = await api(`/artists/${id}`); value = { type, name: a.name, cover: img(a.images, 64) }; }
    else if (type === 'collection') value = { type, name: 'Liked Songs' };
  } catch { /* context details are optional */ }
  contextCache = { uri: ctx.uri, value };
  return value;
}

// Player state + queue. Returns { connected:false } without sign-in, never sample data.
async function state() {
  if (!store.getSecret('spotify.refresh')) return { connected: false, reason: clientId() ? 'Not signed in' : 'No Client ID' };
  try {
    const [p, q] = await Promise.all([api('/me/player?additional_types=episode'), api('/me/player/queue').catch(() => null)]);
    if (!p) return { connected: true, active: false };
    return {
      connected: true, active: true, playing: p.is_playing, progress: (p.progress_ms || 0) / 1000, at: Date.now(),
      track: track(p.item), device: p.device?.name, shuffle: p.shuffle_state, repeat: p.repeat_state,
      context: await context(p.context), queue: (q?.queue || []).slice(0, 6).map(track),
    };
  } catch (e) { return { connected: false, error: e.message }; }
}

async function seek(seconds) { await api(`/me/player/seek?position_ms=${Math.max(0, Math.round(seconds * 1000))}`, { method: 'PUT' }); return true; }

module.exports = { init, connect, disconnect, state, seek, REDIRECT };
