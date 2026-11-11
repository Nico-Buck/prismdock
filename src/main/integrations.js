// Online integrations. Each one talks directly to its own service with the user's own key.
// Without a key a widget receives { connected: false } and shows clearly marked demo data.
const { cached, invalidate } = require('./providers');

let store;
const init = (s) => { store = s; };
const cfg = () => store.config.integrations;
const sec = (k) => store.getSecret(k);
const ttl = () => (store.config.performance.powerSaver ? 3 : 1) * store.config.performance.intervals.online * 1000;

async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'PrismDock/1.0', ...(opts.headers || {}) } });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!r.ok) {
      const msg = (body && (body.message || body.error?.message || body.error_description || body.error)) || r.statusText;
      throw new Error(`${r.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return body;
  } finally { clearTimeout(t); }
}
const notConnected = (reason) => ({ connected: false, reason });
const days = (n) => { const out = []; const d = new Date(); d.setHours(0, 0, 0, 0); for (let i = n - 1; i >= 0; i--) out.push(new Date(d - i * 864e5).toISOString().slice(0, 10)); return out; };
const series = (n, rows) => { const map = Object.fromEntries(days(n).map((k) => [k, 0])); for (const [date, v] of rows) if (date in map) map[date] += v; return Object.entries(map).map(([date, value]) => ({ date, value })); };

// ---------- weather (Open-Meteo, no key needed) ----------
async function weather() {
  const w = cfg().weather;
  return cached(`weather:${w.lat},${w.lon},${w.unit}`, Math.max(600000, store.config.performance.intervals.weather * 1000), async () => {
    const q = new URLSearchParams({
      latitude: w.lat, longitude: w.lon, timezone: 'auto', temperature_unit: w.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day',
      hourly: 'temperature_2m,weather_code,precipitation_probability', forecast_hours: '12',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max', forecast_days: '7',
    });
    const r = await http(`https://api.open-meteo.com/v1/forecast?${q}`);
    return { connected: true, city: w.city, utcOffset: r.utc_offset_seconds, current: r.current, hourly: r.hourly, daily: r.daily, fetchedAt: Date.now() };
  });
}
async function geocode(name) {
  const r = await http(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=${encodeURIComponent(name)}`);
  return (r.results || []).map((x) => ({ name: x.name, country: x.country, admin: x.admin1, lat: x.latitude, lon: x.longitude, timezone: x.timezone }));
}

// ---------- GitHub ----------
async function github() {
  const token = sec('github.token');
  if (!token) return notConnected('GitHub token missing');
  return cached('github', ttl(), async () => {
    const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    const user = await http('https://api.github.com/user', { headers: h });
    const [notifications, prs, repos, gql] = await Promise.all([
      http('https://api.github.com/notifications?per_page=50', { headers: h }).catch(() => []),
      http(`https://api.github.com/search/issues?q=${encodeURIComponent(`is:pr is:open author:${user.login}`)}&per_page=10`, { headers: h }).catch(() => ({ total_count: 0, items: [] })),
      http('https://api.github.com/user/repos?per_page=100&affiliation=owner', { headers: h }).catch(() => []),
      http('https://api.github.com/graphql', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ viewer { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }' }) }).catch(() => null),
    ]);
    const daysList = gql?.data?.viewer?.contributionsCollection?.contributionCalendar?.weeks?.flatMap((w) => w.contributionDays) || [];
    let streak = 0;
    for (let i = daysList.length - 1; i >= 0; i--) {
      if (daysList[i].contributionCount > 0) streak++;
      else if (i !== daysList.length - 1) break;
    }
    const today = daysList.at(-1)?.contributionCount || 0;
    const week = daysList.slice(-7).reduce((a, d) => a + d.contributionCount, 0);
    return {
      connected: true, login: user.login, avatar: user.avatar_url,
      notifications: (Array.isArray(notifications) ? notifications : []).map((n) => ({ title: n.subject.title, type: n.subject.type, repo: n.repository.full_name, reason: n.reason, updated: n.updated_at })),
      prs: { count: prs.total_count, items: (prs.items || []).map((p) => ({ title: p.title, url: p.html_url, repo: p.repository_url.split('/').slice(-2).join('/') })) },
      stars: (Array.isArray(repos) ? repos : []).reduce((a, r) => a + r.stargazers_count, 0),
      contributions: daysList.slice(-119).map((d) => d.contributionCount), today, week, streak,
      total: gql?.data?.viewer?.contributionsCollection?.contributionCalendar?.totalContributions || 0,
    };
  });
}

// ---------- LeetCode (public profile, no key) ----------
async function leetcode() {
  const u = cfg().leetcode.user;
  if (!u) return notConnected('LeetCode username missing');
  return cached(`leetcode:${u}`, ttl(), async () => {
    const query = `query($u:String!){ matchedUser(username:$u){ username submitStatsGlobal{ acSubmissionNum{ difficulty count } } userCalendar{ streak totalActiveDays } } allQuestionsCount{ difficulty count } }`;
    const r = await http('https://leetcode.com/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' }, body: JSON.stringify({ query, variables: { u } }) });
    const m = r.data?.matchedUser;
    if (!m) throw new Error('User not found');
    const by = Object.fromEntries(m.submitStatsGlobal.acSubmissionNum.map((x) => [x.difficulty, x.count]));
    const all = Object.fromEntries((r.data.allQuestionsCount || []).map((x) => [x.difficulty, x.count]));
    return { connected: true, user: m.username, solved: by.All || 0, easy: by.Easy || 0, medium: by.Medium || 0, hard: by.Hard || 0, totals: all, streak: m.userCalendar?.streak || 0, activeDays: m.userCalendar?.totalActiveDays || 0 };
  });
}

// ---------- Linear ----------
async function linear() {
  const key = sec('linear.key');
  if (!key) return notConnected('Linear API key missing');
  return cached('linear', ttl(), async () => {
    const query = '{ viewer { name assignedIssues(first: 50, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { identifier title priority url state { name type } } } } }';
    const r = await http('https://api.linear.app/graphql', { method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    if (r.errors) throw new Error(r.errors[0].message);
    const issues = r.data.viewer.assignedIssues.nodes;
    return { connected: true, name: r.data.viewer.name, issues, inProgress: issues.filter((i) => i.state.type === 'started').length };
  });
}

// ---------- Supabase (Management API) ----------
async function supabase() {
  const token = sec('supabase.token'); const ref = cfg().supabase.projectRef;
  if (!token || !ref) return notConnected('Supabase token or project ref missing');
  return cached(`supabase:${ref}`, ttl(), async () => {
    const h = { Authorization: `Bearer ${token}` };
    const base = `https://api.supabase.com/v1/projects/${ref}`;
    const [project, health, usage] = await Promise.all([
      http(base, { headers: h }),
      http(`${base}/health?services=auth&services=db&services=rest&services=storage&services=realtime`, { headers: h }).catch(() => []),
      http(`${base}/analytics/endpoints/usage.api-counts?interval=7day`, { headers: h }).catch(() => null),
    ]);
    const rows = usage?.result || [];
    const requests = rows.reduce((a, r) => a + (r.total_rest_requests || 0) + (r.total_auth_requests || 0) + (r.total_storage_requests || 0) + (r.total_realtime_requests || 0), 0);
    return { connected: true, name: project.name, status: project.status, region: project.region, health: (health || []).map((s) => ({ name: s.name, healthy: s.healthy })), requests, series: rows.map((r) => (r.total_rest_requests || 0) + (r.total_auth_requests || 0)) };
  });
}

// ---------- social ----------
async function youtube() {
  const key = sec('youtube.key'); const id = cfg().youtube.channelId;
  if (!key || !id) return notConnected('YouTube API key or channel ID missing');
  return cached(`youtube:${id}`, ttl(), async () => {
    const r = await http(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
    const c = r.items?.[0];
    if (!c) throw new Error('Channel not found');
    return { connected: true, name: c.snippet.title, followers: Number(c.statistics.subscriberCount), views: Number(c.statistics.viewCount), videos: Number(c.statistics.videoCount) };
  });
}
async function instagram() {
  const token = sec('instagram.token');
  if (!token) return notConnected('Instagram token missing');
  return cached('instagram', ttl(), async () => {
    const r = await http(`https://graph.instagram.com/v21.0/me?fields=username,followers_count,media_count&access_token=${encodeURIComponent(token)}`);
    return { connected: true, name: r.username, followers: r.followers_count, posts: r.media_count };
  });
}
async function tiktok() {
  const token = sec('tiktok.token');
  if (!token) return notConnected('TikTok token missing');
  return cached('tiktok', ttl(), async () => {
    const r = await http('https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,likes_count,video_count', { headers: { Authorization: `Bearer ${token}` } });
    const u = r.data?.user || {};
    return { connected: true, name: u.display_name, followers: u.follower_count, likes: u.likes_count, videos: u.video_count };
  });
}
async function xProfile() {
  const token = sec('x.token'); const user = cfg().x.user;
  if (!token || !user) return notConnected('X bearer token or username missing');
  return cached(`x:${user}`, ttl(), async () => {
    const r = await http(`https://api.x.com/2/users/by/username/${encodeURIComponent(user)}?user.fields=public_metrics`, { headers: { Authorization: `Bearer ${token}` } });
    const m = r.data?.public_metrics || {};
    return { connected: true, name: r.data?.username, followers: m.followers_count, following: m.following_count, posts: m.tweet_count };
  });
}

// ---------- finance ----------
async function stripe() {
  const key = sec('stripe.key');
  if (!key) return notConnected('Stripe key missing');
  return cached('stripe', ttl(), async () => {
    const since = Math.floor((Date.now() - 30 * 864e5) / 1000);
    const rows = []; let after = null; let currency = 'usd';
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ limit: '100', 'created[gte]': String(since) });
      if (after) q.set('starting_after', after);
      const r = await http(`https://api.stripe.com/v1/balance_transactions?${q}`, { headers: { Authorization: `Bearer ${key}` } });
      for (const t of r.data) {
        if (t.type === 'charge' || t.type === 'payment' || t.type === 'refund' || t.type === 'payment_refund') {
          rows.push([new Date(t.created * 1000).toISOString().slice(0, 10), t.net / 100]); currency = t.currency;
        }
      }
      if (!r.has_more) break;
      after = r.data.at(-1).id;
    }
    const s = series(30, rows);
    return { connected: true, currency: currency.toUpperCase(), total: s.reduce((a, d) => a + d.value, 0), series: s };
  });
}
async function paypal() {
  const id = cfg().paypal.clientId; const secret = sec('paypal.secret');
  if (!id || !secret) return notConnected('PayPal client ID or secret missing');
  return cached('paypal', ttl(), async () => {
    const base = cfg().paypal.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const tok = await http(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    const end = new Date(); const start = new Date(Date.now() - 30 * 864e5);
    const q = new URLSearchParams({ start_date: start.toISOString().slice(0, 19) + 'Z', end_date: end.toISOString().slice(0, 19) + 'Z', fields: 'transaction_info', page_size: '500', transaction_status: 'S' });
    const r = await http(`${base}/v1/reporting/transactions?${q}`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    let currency = 'EUR';
    const rows = (r.transaction_details || []).map((t) => {
      const i = t.transaction_info; currency = i.transaction_amount.currency_code;
      const fee = Number(i.fee_amount?.value || 0);
      return [i.transaction_initiation_date.slice(0, 10), Number(i.transaction_amount.value) + fee];
    }).filter(([, v]) => v > 0);
    const s = series(30, rows);
    return { connected: true, currency, total: s.reduce((a, d) => a + d.value, 0), series: s };
  });
}
async function shopify() {
  const domain = cfg().shopify.domain; const token = sec('shopify.token');
  if (!domain || !token) return notConnected('Shopify domain or admin token missing');
  return cached(`shopify:${domain}`, ttl(), async () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const r = await http(`https://${host}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}&fields=created_at,total_price,currency,financial_status`, { headers: { 'X-Shopify-Access-Token': token } });
    let currency = 'EUR';
    const rows = (r.orders || []).filter((o) => o.financial_status !== 'refunded' && o.financial_status !== 'voided').map((o) => { currency = o.currency; return [o.created_at.slice(0, 10), Number(o.total_price)]; });
    const s = series(30, rows);
    return { connected: true, currency, total: s.reduce((a, d) => a + d.value, 0), orders: rows.length, series: s };
  });
}

// ---------- calendar (iCal subscription URL, e.g. Google Calendar "secret address") ----------
function parseIcsDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  return z ? Date.UTC(+y, mo - 1, +d, +h, +mi, +s) : new Date(+y, mo - 1, +d, +h, +mi, +s).getTime();
}
function parseIcs(text, from, to) {
  const lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  const events = []; let ev = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') ev = {};
    else if (l === 'END:VEVENT') { if (ev && ev.start) events.push(ev); ev = null; }
    else if (ev) {
      const i = l.indexOf(':'); if (i < 0) continue;
      const key = l.slice(0, i); const val = l.slice(i + 1);
      const name = key.split(';')[0];
      if (name === 'DTSTART') { ev.start = parseIcsDate(val); ev.allDay = /VALUE=DATE/.test(key) || val.length === 8; }
      else if (name === 'DTEND') ev.end = parseIcsDate(val);
      else if (name === 'SUMMARY') ev.title = val.replace(/\\,/g, ',').replace(/\\n/g, ' ');
      else if (name === 'LOCATION') ev.location = val.replace(/\\,/g, ',');
      else if (name === 'RRULE') ev.rrule = Object.fromEntries(val.split(';').map((p) => p.split('=')));
    }
  }
  const out = [];
  for (const e of events) {
    const dur = (e.end || e.start + 3600e3) - e.start;
    if (!e.rrule) { if (e.start + dur >= from && e.start <= to) out.push({ ...e, end: e.start + dur }); continue; }
    const freq = e.rrule.FREQ; const interval = Number(e.rrule.INTERVAL || 1);
    const until = e.rrule.UNTIL ? parseIcsDate(e.rrule.UNTIL) : Infinity; let count = e.rrule.COUNT ? Number(e.rrule.COUNT) : Infinity;
    const byday = e.rrule.BYDAY ? e.rrule.BYDAY.split(',').map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d.slice(-2))) : null;
    let t = new Date(e.start);
    for (let guard = 0; guard < 2000 && t.getTime() <= Math.min(to, until) && count > 0; guard++) {
      const candidates = [];
      if (freq === 'WEEKLY' && byday) {
        const weekStart = new Date(t); weekStart.setDate(t.getDate() - t.getDay());
        for (const wd of byday) { const c = new Date(weekStart); c.setDate(weekStart.getDate() + wd); if (c.getTime() >= e.start) candidates.push(c); }
      } else candidates.push(new Date(t));
      for (const c of candidates) {
        if (count <= 0 || c.getTime() > until) break;
        count--;
        if (c.getTime() + dur >= from && c.getTime() <= to) out.push({ ...e, start: c.getTime(), end: c.getTime() + dur });
      }
      if (freq === 'DAILY') t.setDate(t.getDate() + interval);
      else if (freq === 'WEEKLY') t.setDate(t.getDate() + 7 * interval);
      else if (freq === 'MONTHLY') t.setMonth(t.getMonth() + interval);
      else if (freq === 'YEARLY') t.setFullYear(t.getFullYear() + interval);
      else break;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
async function calendar() {
  const url = cfg().calendarIcs.url;
  if (!url) return notConnected('No iCal address');
  return cached(`ics:${url}`, ttl(), async () => {
    const text = await http(url.replace(/^webcal:/, 'https:'));
    if (typeof text !== 'string' || !text.includes('BEGIN:VCALENDAR')) throw new Error('Not a valid iCal file');
    const from = new Date(); from.setHours(0, 0, 0, 0);
    return { connected: true, events: parseIcs(text, from.getTime(), from.getTime() + 35 * 864e5) };
  });
}

// ---------- DeepSeek balance ----------
async function deepseek() {
  const key = sec('deepseek.key');
  if (!key) return notConnected('DeepSeek API key missing');
  return cached('deepseek', ttl(), async () => {
    const r = await http('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}` } });
    const b = r.balance_infos?.[0] || {};
    return { connected: true, currency: b.currency || 'USD', balance: Number(b.total_balance || 0), granted: Number(b.granted_balance || 0), topped: Number(b.topped_up_balance || 0) };
  });
}

// ---------- custom JSON widgets ----------
async function customJson(url, ttlSec = 300) {
  return cached(`custom:${url}`, ttlSec * 1000, () => http(url));
}

const registry = { weather, github, leetcode, linear, supabase, youtube, instagram, tiktok, x: xProfile, stripe, paypal, shopify, calendar, deepseek };
async function get(name, opts = {}) {
  const fn = registry[name];
  if (!fn) throw new Error('Unknown integration ' + name);
  if (opts.refresh) invalidate(name === 'calendar' ? 'ics' : name);
  try { return await fn(); } catch (e) { return { connected: false, error: e.message }; }
}

module.exports = { init, get, geocode, customJson, invalidate };
