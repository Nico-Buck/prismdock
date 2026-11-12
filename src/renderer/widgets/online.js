// Account-based widgets. Without a connection each shows sample numbers with a visible
// DEMO badge and its panel says what is needed - never invented "live" values.
import { icon, brandTile, esc, fmtNum, fmtMoney, bar, meter, C, relTime, fmtDur, fmtDate, fmtTimeShort } from '../shared/ui.js';
import { lineChart, spark } from '../shared/graph.js';

const DEMO = '<span class="demo-badge">Demo</span>';
const isLive = (d) => d && d.connected;
// the sources in the currency with the most revenue (amounts in different currencies are never added up)
const mainCurrency = (list) => {
  const by = {}; for (const r of list) (by[r.currency || ''] ||= []).push(r);
  return Object.values(by).sort((a, b) => b.reduce((x, r) => x + r.total, 0) - a.reduce((x, r) => x + r.total, 0))[0] || [];
};
// a Codex window whose reset time has passed since the last log line is empty again
const codexExpired = (w, c) => w.resets_in_seconds != null && w.resets_in_seconds - (Date.now() - c.rateAt) / 1000 <= 0;
const P = (ctx, n) => Math.round(n * ctx.u);
const BRAND = 40; // brand tile size in tile units (the CSS scales it to the bar)

function demoNote(ctx, d, what) {
  if (isLive(d)) return '';
  return `${d?.error ? `<div class="err-note"><b>Connection error:</b> ${esc(d.error)}</div>` : ''}<div class="demo-note">${icon('sparkles', 16)}<div><b>Sample data.</b> ${what} <a data-a="connect" style="color:var(--accent);cursor:default">Connect now →</a></div></div>`;
}
const connectOn = { connect: (ctx) => ctx.openSettings('integrations'), refresh: (ctx, el) => ctx.hub.refresh(el.dataset.v) };

function statTile(ctx, brand, big, label, live) {
  return `<div class="tin wide">${brandTile(brand, BRAND)}<div class="col" style="gap:calc(5px*var(--u))"><span class="t-huge" style="font-size:calc(21px*var(--fu))">${big}</span><span class="t-sub">${label}</span></div>${live ? '' : DEMO}</div>`;
}
function socialPanel(ctx, d, brand, title, unit, demoText, topic) {
  return `<div class="pn"><div class="pn-head"><h3>${brandTile(brand, 26)} ${title}</h3>${isLive(d) ? `<button class="btn icon" data-a="refresh" data-v="${topic}" data-tip="Refresh">${icon('refresh', 13)}</button>` : ''}</div>
    <div class="pn-big">${fmtNum(d.followers)}</div><div class="pn-muted">${unit}${d.name ? ' · @' + esc(d.name) : ''}</div>
    ${d.extra ? `<div class="pn-grid c2">${d.extra.map(([k, v]) => `<div class="pn-stat"><b>${fmtNum(v)}</b><span>${k}</span></div>`).join('')}</div>` : ''}
    ${demoNote(ctx, d, demoText)}</div>`;
}

// ---------- demo payloads (shown only with the DEMO badge) ----------
const DEMOS = {
  github: { login: 'octocat', notifications: [{ title: 'Fix race in cache invalidation', type: 'PullRequest', repo: 'you/app', reason: 'review_requested' }, { title: 'Release v2.3.0', type: 'Release', repo: 'org/lib', reason: 'subscribed' }, { title: 'Crash on startup', type: 'Issue', repo: 'you/app', reason: 'mention' }], prs: { count: 3, items: [] }, stars: 184, contributions: Array.from({ length: 119 }, (_, i) => [0, 1, 3, 0, 6, 2, 9, 4, 0, 5][(i * 7) % 10]), today: 6, week: 37, streak: 23 },
  leetcode: { user: 'demo', solved: 412, easy: 160, medium: 210, hard: 42, totals: { Easy: 860, Medium: 1800, Hard: 800 }, streak: 12 },
  linear: { issues: [{ identifier: 'ENG-142', title: 'Onboarding flow polish', state: { name: 'In Progress', type: 'started' }, priority: 2 }, { identifier: 'ENG-150', title: 'Rate limit retries', state: { name: 'Todo', type: 'unstarted' }, priority: 3 }, { identifier: 'ENG-133', title: 'Billing webhook', state: { name: 'In Review', type: 'started' }, priority: 1 }], inProgress: 2 },
  supabase: { name: 'my-project', status: 'ACTIVE_HEALTHY', requests: 48210, health: [{ name: 'db', healthy: true }, { name: 'auth', healthy: true }, { name: 'rest', healthy: true }, { name: 'storage', healthy: true }], series: [5200, 6100, 5800, 7400, 6900, 8100, 8700] },
  youtube: { followers: 12400, extra: [['Views', 1840000], ['Videos', 86]] },
  instagram: { followers: 5300, extra: [['Posts', 214]] },
  tiktok: { followers: 21800, extra: [['Likes', 410000], ['Videos', 132]] },
  x: { followers: 2400, extra: [['Following', 312], ['Posts', 4100]] },
  revenue: (seed) => ({ currency: 'EUR', series: Array.from({ length: 30 }, (_, i) => ({ date: '', value: Math.max(0, 60 + Math.sin(i / 3 + seed) * 25 + i * 2.2 + ((i * 37 + seed * 11) % 17)) })) }),
};
const sumSeries = (r) => r.series.reduce((a, d) => a + d.value, 0);

function revenueOf(d, seed) {
  if (isLive(d)) return d;
  const r = DEMOS.revenue(seed); return { ...r, total: sumSeries(r) };
}
function change(series) {
  const v = series.map((x) => x.value); const a = v.slice(-7).reduce((s, x) => s + x, 0), b = v.slice(-14, -7).reduce((s, x) => s + x, 0);
  return b ? ((a - b) / b) * 100 : 0;
}
function revenueTile(ctx, brand, label, d, seed, chart = false) {
  const r = revenueOf(d, seed); const ch = change(r.series);
  if (chart) return `<div class="tin wide"><div class="col" style="gap:calc(6px*var(--u))"><div class="row" style="gap:calc(6px*var(--u))">${brandTile(brand, 16)}<span class="t-title">${label}</span></div>${spark(r.series.slice(-14).map((x) => x.value), { w: P(ctx, 96), h: P(ctx, 22), color: C.green })}</div><div class="col" style="align-items:flex-end;gap:calc(6px*var(--u))"><span class="t-big" style="font-weight:650">${fmtMoney(r.total, r.currency)}</span><span class="t-xs ${ch >= 0 ? 'green' : 'red'}" style="font-weight:700">${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(0)}%</span></div>${isLive(d) ? '' : DEMO}</div>`;
  return `<div class="tin wide">${brandTile(brand, BRAND)}<div class="col" style="gap:calc(5px*var(--u))"><span class="t-big" style="font-weight:650">${fmtMoney(r.total, r.currency)}</span><span class="t-sub">${label} · 30 days</span></div>${isLive(d) ? '' : DEMO}</div>`;
}
function revenuePanel(ctx, brand, title, d, seed, topic, what) {
  const r = revenueOf(d, seed); const ch = change(r.series);
  const best = r.series.reduce((a, x) => (x.value > a.value ? x : a), r.series[0]);
  return `<div class="pn"><div class="pn-head"><h3>${brandTile(brand, 26)} ${title}</h3>${isLive(d) ? `<button class="btn icon" data-a="refresh" data-v="${topic}" data-tip="Refresh">${icon('refresh', 13)}</button>` : ''}</div>
    <div class="row" style="align-items:flex-end;gap:12px"><div class="pn-big">${fmtMoney(r.total, r.currency)}</div><span class="${ch >= 0 ? 'green' : 'red'}" style="font-weight:700;padding-bottom:4px">${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(1)}% vs. last week</span></div>
    <div class="pn-sec chart">${lineChart(r.series.map((x) => x.value), { h: 90, color: C.green, dot: true, grid: [0.5, 1] })}<div class="row" style="justify-content:space-between"><span class="kbd">30 days ago</span><span class="kbd">today</span></div></div>
    <div class="pn-grid c3"><div class="pn-stat"><b>${fmtMoney(r.series.slice(-7).reduce((a, x) => a + x.value, 0), r.currency)}</b><span>7 days</span></div><div class="pn-stat"><b>${fmtMoney(r.total / 30, r.currency)}</b><span>Daily average</span></div><div class="pn-stat"><b>${fmtMoney(best.value, r.currency)}</b><span>Best day</span></div></div>
    ${demoNote(ctx, d, what)}</div>`;
}

// ---------- AI usage ----------
function aiTile(ctx, brand, rows, live) {
  return `<div class="tin" style="gap:calc(10px*var(--u))">${brandTile(brand, BRAND)}<div class="meters-col" style="min-width:calc(176px*var(--u));--ml:46px">${rows.map(([l, p, sub, v]) => meter(l, p, v, p > 85 ? C.red : p > 65 ? C.orange : C.green, sub)).join('')}</div>${live ? '' : DEMO}</div>`;
}
function aiPanel(ctx, brand, title, body, d, what) {
  return `<div class="pn"><div class="pn-head"><h3>${brandTile(brand, 26)} ${title}</h3></div>${body}${what ? demoNote(ctx, d, what) : ''}</div>`;
}

export default [
  // ---------------- developer ----------------
  {
    type: 'github', name: 'GitHub', cat: 'developer', icon: 'code', brand: 'github', desc: 'Unread notifications, open pull requests and stars.',
    sizes: ['s', 'm'], size: 'm', topics: ['integ:github'],
    tile(ctx, { 'integ:github': d }) {
      const g = isLive(d) ? d : DEMOS.github;
      if (ctx.size === 's') return `<div class="tin sq"><span style="position:relative;display:flex">${brandTile('github', BRAND)}${g.notifications.length ? `<span style="position:absolute;top:-4px;right:-6px;min-width:16px;height:16px;border-radius:8px;background:#ff3b30;color:#fff;font-size:9.5px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px">${g.notifications.length}</span>` : ''}</span>${isLive(d) ? '' : DEMO}</div>`;
      return `<div class="tin wide">${brandTile('github', BRAND)}<div class="col" style="gap:calc(7px*var(--u))"><span class="t-title">${g.notifications.length} unread</span><span class="t-sub">${g.prs.count} open PRs · ★ ${fmtNum(g.stars)}</span></div>${isLive(d) ? '' : DEMO}</div>`;
    },
    panel(ctx, { 'integ:github': d }) {
      const g = isLive(d) ? d : DEMOS.github;
      return `<div class="pn"><div class="pn-head"><h3>${brandTile('github', 26)} ${esc(g.login)}</h3>${isLive(d) ? `<button class="btn icon" data-a="refresh" data-v="integ:github" data-tip="Refresh">${icon('refresh', 13)}</button>` : ''}<button class="btn icon" data-a="web" data-tip="Open on github.com">${icon('external', 13)}</button></div>
        <div class="pn-grid c3"><div class="pn-stat"><b>${g.notifications.length}</b><span>Notifications</span></div><div class="pn-stat"><b>${g.prs.count}</b><span>Open PRs</span></div><div class="pn-stat"><b>${fmtNum(g.stars)}</b><span>Stars</span></div></div>
        <div class="pn-list">${g.notifications.slice(0, 10).map((n) => `<div class="pn-item"><span class="dim" style="display:flex">${icon(n.type === 'PullRequest' ? 'code' : n.type === 'Release' ? 'flag' : 'note', 16)}</span><div class="grow"><b>${esc(n.title)}</b><span>${esc(n.repo)} · ${esc(n.reason.replace(/_/g, ' '))}</span></div></div>`).join('') || '<div class="empty">All caught up.</div>'}</div>
        ${demoNote(ctx, d, 'Add a personal GitHub token (scopes: notifications, read:user, repo) under Integrations.')}</div>`;
    },
    panelWidth: 360,
    on: { ...connectOn, web: (ctx) => ctx.act('open', { target: 'https://github.com/notifications' }) },
  },
  {
    type: 'githubActivity', name: 'GitHub Activity', cat: 'developer', icon: 'chart', brand: 'github', desc: 'Your contribution grid and streak.',
    sizes: ['m', 'l'], size: 'm', topics: ['integ:github'],
    tile(ctx, { 'integ:github': d }) {
      const g = isLive(d) ? d : DEMOS.github;
      const weeks = ctx.size === 'l' ? 17 : 11;
      const cells = g.contributions.slice(-weeks * 7);
      const max = Math.max(...cells, 1);
      const col = (v) => (v === 0 ? 'var(--fill-1)' : `rgba(48,209,88,${0.3 + (v / max) * 0.7})`);
      const sz = `calc(5.2px*var(--u))`;
      return `<div class="tin wide"><div class="col" style="gap:calc(5px*var(--u))"><span class="t-val">${g.today} <span class="dim" style="font-weight:500">today</span></span><span class="t-val">${g.week} <span class="dim" style="font-weight:500">week</span></span><span class="t-val">🔥 ${g.streak}</span></div>
        <div style="display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,${sz});gap:calc(1.6px*var(--u))">${cells.map((v) => `<i style="width:${sz};height:${sz};border-radius:1.5px;background:${col(v)}"></i>`).join('')}</div>${isLive(d) ? '' : DEMO}</div>`;
    },
    panel(ctx, { 'integ:github': d }) {
      const g = isLive(d) ? d : DEMOS.github; const max = Math.max(...g.contributions, 1);
      return `<div class="pn"><div class="pn-head"><h3>${brandTile('github', 26)} Activity</h3></div>
        <div class="pn-grid c3"><div class="pn-stat"><b>${g.today}</b><span>Today</span></div><div class="pn-stat"><b>${g.week}</b><span>Last 7 days</span></div><div class="pn-stat"><b>🔥 ${g.streak}</b><span>Day streak</span></div></div>
        <div class="pn-sec"><div class="contrib">${g.contributions.map((v) => `<i style="background:${v ? `rgba(48,209,88,${0.3 + (v / max) * 0.7})` : 'var(--fill-1)'}"></i>`).join('')}</div></div>
        ${demoNote(ctx, d, 'Add a GitHub token under Integrations.')}</div>`;
    },
    panelWidth: 340, on: connectOn,
  },
  {
    type: 'leetcode', name: 'LeetCode Stats', cat: 'developer', icon: 'code', brand: 'leetcode', desc: 'Problems solved and your streak (public profile, no key).',
    sizes: ['m'], size: 'm', topics: ['integ:leetcode'],
    tile(ctx, { 'integ:leetcode': d }) {
      const g = isLive(d) ? d : DEMOS.leetcode;
      return `<div class="tin wide">${brandTile('leetcode', BRAND)}<div class="col" style="gap:calc(6px*var(--u))"><span class="t-big" style="font-weight:650">${g.solved}</span><span class="t-sub num"><span style="color:#00b8a3">${g.easy}</span> · <span style="color:#ffc01e">${g.medium}</span> · <span style="color:#ff375f">${g.hard}</span></span></div>${isLive(d) ? '' : DEMO}</div>`;
    },
    panel(ctx, { 'integ:leetcode': d }) {
      const g = isLive(d) ? d : DEMOS.leetcode;
      const row = (l, n, t, c) => `<div class="pn-row"><span style="width:60px;color:${c};font-weight:600">${l}</span>${bar(t ? (n / t) * 100 : 0, c)}<span class="val" style="width:84px;text-align:right">${n}${t ? ' / ' + t : ''}</span></div>`;
      return `<div class="pn"><div class="pn-head"><h3>${brandTile('leetcode', 26)} ${esc(g.user)}</h3></div><div class="pn-big">${g.solved}<span class="pn-muted" style="font-size:14px"> solved · 🔥 ${g.streak} days</span></div>
        <div class="pn-sec">${row('Easy', g.easy, g.totals?.Easy, '#00b8a3')}${row('Medium', g.medium, g.totals?.Medium, '#ffc01e')}${row('Hard', g.hard, g.totals?.Hard, '#ff375f')}</div>
        ${demoNote(ctx, d, 'Enter your LeetCode username under Integrations.')}</div>`;
    },
    on: connectOn,
  },
  {
    type: 'linear', name: 'Linear', cat: 'developer', icon: 'layers', brand: 'linear', desc: 'Issues assigned to you and what is in progress.',
    sizes: ['m'], size: 'm', topics: ['integ:linear'],
    tile(ctx, { 'integ:linear': d }) {
      const g = isLive(d) ? d : DEMOS.linear;
      return `<div class="tin wide">${brandTile('linear', BRAND)}<div class="col" style="gap:calc(6px*var(--u))"><span class="t-title">${g.issues.length} assigned</span><span class="t-sub">${g.inProgress} in progress</span></div>${isLive(d) ? '' : DEMO}</div>`;
    },
    panel(ctx, { 'integ:linear': d }) {
      const g = isLive(d) ? d : DEMOS.linear;
      const pc = ['var(--text-3)', '#ff453a', '#ff9f0a', '#ffd60a', '#8e8e93'];
      return `<div class="pn"><div class="pn-head"><h3>${brandTile('linear', 26)} Linear</h3></div><div class="pn-list">${g.issues.map((i) => `<div class="pn-item" ${i.url ? `data-a="openUrl" data-v="${esc(i.url)}"` : ''}><span style="width:8px;height:8px;border-radius:50%;background:${pc[i.priority] || pc[0]}"></span><div class="grow"><b>${esc(i.title)}</b><span>${esc(i.identifier)} · ${esc(i.state.name)}</span></div></div>`).join('') || '<div class="empty">No open issues.</div>'}</div>
        ${demoNote(ctx, d, 'Add a personal Linear API key under Integrations.')}</div>`;
    },
    panelWidth: 340, on: { ...connectOn, openUrl: (ctx, el) => (/^https:\/\//i.test(el.dataset.v) ? ctx.act('open', { target: el.dataset.v }) : false) /* links from service data: web only */ },
  },
  {
    type: 'supabase', name: 'Supabase', cat: 'developer', icon: 'bolt', brand: 'supabase', desc: 'API requests on your project, and its health.',
    sizes: ['m'], size: 'm', topics: ['integ:supabase'],
    tile(ctx, { 'integ:supabase': d }) {
      const g = isLive(d) ? d : DEMOS.supabase;
      const ok = g.health.every((h) => h.healthy);
      return `<div class="tin wide">${brandTile('supabase', BRAND)}<div class="col" style="gap:calc(6px*var(--u))"><span class="t-title">${fmtNum(g.requests)} requests</span><span class="t-sub"><span style="color:${ok ? C.green : C.red}">●</span> ${ok ? 'Healthy' : 'Degraded'} · 7 days</span></div>${g.series?.length > 1 ? spark(g.series, { w: P(ctx, 48), h: P(ctx, 22), color: '#3ecf8e' }) : ''}${isLive(d) ? '' : DEMO}</div>`;
    },
    panel(ctx, { 'integ:supabase': d }) {
      const g = isLive(d) ? d : DEMOS.supabase;
      return `<div class="pn"><div class="pn-head"><h3>${brandTile('supabase', 26)} ${esc(g.name)}</h3></div><div class="pn-big">${fmtNum(g.requests)}<span class="pn-muted" style="font-size:13px"> requests / 7 days</span></div>
        <div class="pn-sec">${g.health.map((h) => `<div class="pn-row"><span style="color:${h.healthy ? C.green : C.red}">●</span><span class="grow">${esc(h.name)}</span><span class="dim">${h.healthy ? 'OK' : 'Error'}</span></div>`).join('')}</div>
        ${demoNote(ctx, d, 'Add a Supabase access token and project ref under Integrations.')}</div>`;
    },
    on: connectOn,
  },
  // ---------------- social ----------------
  ...[
    ['youtube', 'YouTube', 'Subscribers on your channel, via your own API key.', 'Subscribers', 'Add a YouTube Data API key and your channel ID under Integrations.', (g) => [['Views', g.views], ['Videos', g.videos]]],
    ['instagram', 'Instagram', 'Followers on your Instagram account, with an official token.', 'Followers', 'Add an Instagram Graph API token (Business or Creator account) under Integrations.', (g) => [['Posts', g.posts]]],
    ['tiktok', 'TikTok', 'Followers on your TikTok profile.', 'Followers', 'Add a TikTok Display API user token under Integrations.', (g) => [['Likes', g.likes], ['Videos', g.videos]]],
    ['x', 'X', 'Followers on your X account.', 'Followers', 'Add an X API bearer token (paid API access) and your username under Integrations.', (g) => [['Following', g.following], ['Posts', g.posts]]],
  ].map(([key, name, desc, unit, what, extra]) => ({
    type: key, name, cat: 'social', icon: 'user', brand: key, desc, sizes: ['m'], size: 'm', topics: [`integ:${key}`],
    tile(ctx, d) { const v = d[`integ:${key}`]; const g = isLive(v) ? v : DEMOS[key]; return statTile(ctx, key, fmtNum(g.followers), unit.toLowerCase(), isLive(v)); },
    panel(ctx, d) { const v = d[`integ:${key}`]; const g = isLive(v) ? { ...v, extra: extra(v) } : { ...DEMOS[key], connected: false, error: v?.error }; return socialPanel(ctx, g, key, name, unit, what, `integ:${key}`); },
    on: connectOn,
  })),
  // ---------------- AI ----------------
  {
    type: 'claude', name: 'Claude Usage', cat: 'ai', icon: 'sparkles', brand: 'claude', desc: 'Tokens in your current 5-hour session, today and this week – read from your local Claude Code logs.',
    sizes: ['m'], size: 'm', topics: ['aiLocal', 'clock'],
    tile(ctx, { aiLocal }) {
      const c = aiLocal?.claude;
      if (!c) return aiTile(ctx, 'claude', [['Session', 41, '2h 40m', '41%'], ['Weekly', 64, 'Sun', '64%']], false);
      const left = c.sessionResetsAt ? fmtDur((c.sessionResetsAt - Date.now()) / 1000, true) : '–';
      return `<div class="tin wide">${brandTile('claude', BRAND)}<div class="col" style="gap:calc(6px*var(--u))"><div class="row" style="gap:calc(10px*var(--u))"><span class="t-label">Session</span><span class="t-xs num">${left}</span></div><span class="t-big" style="font-weight:650">${fmtNum(c.session)} <span class="t-xs" style="font-weight:500">tokens</span></span></div></div>`;
    },
    panel(ctx, { aiLocal }) {
      const c = aiLocal?.claude;
      if (!c) return aiPanel(ctx, 'claude', 'Claude', `<div class="pn-grid c2"><div class="pn-stat"><b>41%</b><span>Session (sample)</span></div><div class="pn-stat"><b>64%</b><span>Weekly (sample)</span></div></div>`, null, 'No local Claude Code logs (~/.claude/projects) were found. Anthropic does not offer a public API for plan limits, so PrismDock shows real token counts from your local Claude Code usage as soon as there is any.');
      return aiPanel(ctx, 'claude', 'Claude Code', `<div class="pn-grid c3"><div class="pn-stat"><b>${fmtNum(c.session)}</b><span>Session (5h)</span></div><div class="pn-stat"><b>${fmtNum(c.today)}</b><span>Today</span></div><div class="pn-stat"><b>${fmtNum(c.week)}</b><span>7 days</span></div></div>
        <div class="pn-sec"><div class="pn-row"><span class="grow dim">Session resets</span><span class="val">${c.sessionResetsAt ? relTime(c.sessionResetsAt) : 'no active session'}</span></div><div class="pn-row"><span class="grow dim">Most used model</span><span class="val">${esc(c.topModel || '–')}</span></div><div class="pn-row"><span class="grow dim">Responses today</span><span class="val">${c.messages}</span></div></div>
        <div class="pn-muted">Source: ${esc(c.source)} – input, output and cache-write tokens. Your plan’s percentage limit is not publicly available.</div>`, null);
    },
    panelWidth: 340, on: connectOn,
  },
  {
    type: 'chatgpt', name: 'ChatGPT / Codex Usage', cat: 'ai', icon: 'sparkles', brand: 'chatgpt', desc: 'Your Codex plan’s 5-hour and weekly windows, read from local Codex CLI logs.',
    sizes: ['m'], size: 'm', topics: ['aiLocal'],
    tile(ctx, { aiLocal }) {
      const c = aiLocal?.codex; const r = c?.rate;
      if (!r) return aiTile(ctx, 'chatgpt', [['Session', 34, '2h 12m', '34%'], ['Weekly', 21, 'Thu', '21%']], false);
      const p = r.primary || {}; const s = r.secondary || {};
      const reset = (w) => (w.resets_in_seconds != null && !codexExpired(w, c) ? fmtDur(w.resets_in_seconds - (Date.now() - c.rateAt) / 1000, true) : '');
      const pc = (w) => (codexExpired(w, c) ? 0 : w.used_percent || 0);
      return aiTile(ctx, 'chatgpt', [['Session', pc(p), reset(p), Math.round(pc(p)) + '%'], ['Weekly', pc(s), reset(s), Math.round(pc(s)) + '%']], true);
    },
    panel(ctx, { aiLocal }) {
      const c = aiLocal?.codex;
      if (!c?.rate) return aiPanel(ctx, 'chatgpt', 'ChatGPT / Codex', `<div class="pn-grid c2"><div class="pn-stat"><b>34%</b><span>5-hour window (sample)</span></div><div class="pn-stat"><b>21%</b><span>Weekly (sample)</span></div></div>`, null, c ? 'Codex logs were found but contain no limit data yet. Real values appear after your next Codex response.' : 'No local Codex CLI logs (~/.codex/sessions) were found. The ChatGPT web app does not expose its limits through an API.');
      const p = c.rate.primary || {}, s = c.rate.secondary || {};
      const pc = (w) => Math.round(codexExpired(w, c) ? 0 : w.used_percent || 0);
      return aiPanel(ctx, 'chatgpt', 'Codex', `<div class="pn-grid c2"><div class="pn-stat"><b>${pc(p)}%</b><span>5-hour window</span></div><div class="pn-stat"><b>${pc(s)}%</b><span>Weekly window</span></div></div><div class="pn-grid c2"><div class="pn-stat"><b>${fmtNum(c.today)}</b><span>Tokens today</span></div><div class="pn-stat"><b>${fmtNum(c.week)}</b><span>Tokens, 7 days</span></div></div><div class="pn-muted">Updated ${c.rateAt ? `${fmtDate(new Date(c.rateAt))} ${fmtTimeShort(new Date(c.rateAt), ctx.cfg.behavior.clock24)}` : '–'} · ${esc(c.source)}</div>`, null);
    },
    panelWidth: 340, on: connectOn,
  },
  ...[
    ['gemini', 'Gemini Usage', 'Gemini quota for Pro and Flash.', [['Pro', 18, '13h 54m', '18%'], ['Flash', 6, '13h 54m', '6%']], 'Google does not expose the Gemini subscription quota through a public API.'],
    ['cursor', 'Cursor Usage', 'Cursor spend and tokens.', [['Auto', 39, 'Wed', '39%'], ['Premium', 12, 'Wed', '12%']], 'Cursor offers no official API for usage limits; the numbers in its dashboard are only available with your browser session.'],
    ['grok', 'Grok Usage', 'SuperGrok credit use.', [['Credits', 28, 'Fri', '28%']], 'xAI does not expose the SuperGrok quota through a public API.'],
    ['deepseek', 'DeepSeek Balance', 'Your DeepSeek balance.', null, 'Add your DeepSeek API key under Integrations – the balance is officially available via /user/balance.'],
  ].map(([key, name, desc, rows, why]) => ({
    type: key, name, cat: 'ai', icon: 'sparkles', brand: key, desc: key === 'deepseek' ? desc : desc + ' (sample data – see note)', sizes: ['m'], size: 'm', topics: key === 'deepseek' ? ['integ:deepseek'] : [],
    tile(ctx, d) {
      if (key === 'deepseek') {
        const v = d['integ:deepseek'];
        return `<div class="tin wide">${brandTile('deepseek', BRAND)}<div class="col" style="gap:calc(6px*var(--u))"><span class="t-big" style="font-weight:650">${isLive(v) ? fmtMoney(v.balance, v.currency) : '$18.42'}</span><span class="t-sub">Balance</span></div>${isLive(v) ? '' : DEMO}</div>`;
      }
      return aiTile(ctx, key, rows, false);
    },
    panel(ctx, d) {
      if (key === 'deepseek' && isLive(d['integ:deepseek'])) { const v = d['integ:deepseek']; return aiPanel(ctx, key, name, `<div class="pn-big">${fmtMoney(v.balance, v.currency)}</div><div class="pn-grid c2"><div class="pn-stat"><b>${fmtMoney(v.granted, v.currency)}</b><span>Granted</span></div><div class="pn-stat"><b>${fmtMoney(v.topped, v.currency)}</b><span>Topped up</span></div></div>`, v); }
      return aiPanel(ctx, key, name, rows ? `<div class="pn-sec">${rows.map(([l, p, s, v]) => meter(l, p, v, C.green, s)).join('')}</div>` : '', d[`integ:${key}`], why);
    },
    on: connectOn,
  })),
  // ---------------- finance ----------------
  ...[
    ['stripe', 'Stripe', 'Net revenue over the last 30 days from Stripe.', 1, 'Add a restricted Stripe key (rk_… with read access to Balance) under Integrations.'],
    ['paypal', 'PayPal', 'Incoming payments over the last 30 days from PayPal.', 2, 'Add a PayPal REST app (client ID + secret with “Transaction Search”) under Integrations.'],
    ['shopify', 'Shopify', 'Your store’s net sales over the last 30 days.', 3, 'Add your shop domain and an Admin API token (read_orders) under Integrations.'],
  ].flatMap(([key, name, desc, seed, what]) => [
    { type: key, name, cat: 'finance', icon: 'dollar', brand: key, desc, sizes: ['m'], size: 'm', topics: [`integ:${key}`], tile: (ctx, d) => revenueTile(ctx, key, name, d[`integ:${key}`], seed), panel: (ctx, d) => revenuePanel(ctx, key, name, d[`integ:${key}`], seed, `integ:${key}`, what), panelWidth: 350, on: connectOn },
    { type: key + 'Chart', name: name + ' Chart', cat: 'finance', icon: 'chart', brand: key, desc: `Your ${name} revenue as a 14-day line.`, sizes: ['m'], size: 'm', topics: [`integ:${key}`], tile: (ctx, d) => revenueTile(ctx, key, name, d[`integ:${key}`], seed, true), panel: (ctx, d) => revenuePanel(ctx, key, name, d[`integ:${key}`], seed, `integ:${key}`, what), panelWidth: 350, on: connectOn },
  ]),
  {
    type: 'revenue', name: 'Revenue Dashboard', cat: 'finance', icon: 'dollar', desc: 'Every connected store’s last 30 days added up, with a monthly goal and its pace.',
    sizes: ['m'], size: 'm', topics: ['integ:stripe', 'integ:paypal', 'integ:shopify'],
    tile(ctx, d) {
      const live = mainCurrency(['stripe', 'paypal', 'shopify'].map((k) => d[`integ:${k}`]).filter(isLive));
      const total = live.length ? live.reduce((a, x) => a + x.total, 0) : 2980;
      const cur = live[0]?.currency || 'EUR'; const goal = ctx.cfg.integrations.revenueGoal ?? 5000;
      return `<div class="tin wide"><span class="glyph-tile" style="background:linear-gradient(135deg,#30d158,#0a8f3a);color:#fff">${icon('dollar')}</span><div class="col" style="gap:calc(6px*var(--u));width:calc(120px*var(--u))"><div class="row" style="justify-content:space-between"><span class="t-big" style="font-weight:650;font-size:calc(15px*var(--fu))">${fmtMoney(total, cur)}</span><span class="t-xs num">${Math.round((total / goal) * 100)}%</span></div>${bar((total / goal) * 100, C.green)}</div>${live.length ? '' : DEMO}</div>`;
    },
    panel(ctx, d) {
      const src = ['stripe', 'paypal', 'shopify'].map((k, i) => [k, revenueOf(d[`integ:${k}`], i + 1), isLive(d[`integ:${k}`])]);
      const live = src.filter((x) => x[2]);
      const all = live.length ? live : src;
      const main = mainCurrency(all.map((x) => x[1])); const use = all.filter((x) => main.includes(x[1])); // one currency in the sum
      const cur = use[0][1].currency; const total = use.reduce((a, x) => a + x[1].total, 0);
      const series = use[0][1].series.map((_, i) => use.reduce((a, x) => a + (x[1].series[i]?.value || 0), 0));
      const goal = ctx.cfg.integrations.revenueGoal ?? 5000;
      const dayOfMonth = new Date().getDate(); const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      const pace = (series.slice(-dayOfMonth).reduce((a, x) => a + x, 0) / dayOfMonth) * daysInMonth;
      return `<div class="pn"><div class="pn-head"><h3>${icon('dollar', 18)} Total revenue</h3><span class="sub">30 days</span></div><div class="pn-big">${fmtMoney(total, cur)}</div>
        <div class="pn-sec chart">${lineChart(series, { h: 80, color: C.green, dot: true, grid: [0.5, 1] })}</div>
        <div class="pn-row"><span class="dim">${goal > 0 ? `Goal ${fmtMoney(goal, cur)}` : 'Pace this month'}</span>${goal > 0 ? bar((pace / goal) * 100, pace >= goal ? C.green : C.orange) : '<span class="grow"></span>'}<span class="val">${fmtMoney(pace, cur)}</span></div>
        ${all.length > use.length ? `<div class="pn-muted">Sources in another currency are listed below but not added to the total.</div>` : ''}<div class="pn-sec">${all.map(([k, r, l]) => `<div class="pn-row">${brandTile(k, 22)}<span class="grow">${k[0].toUpperCase() + k.slice(1)}${l ? '' : ' <span class="demo-badge" style="position:static">Demo</span>'}</span><span class="val">${fmtMoney(r.total, r.currency)}</span></div>`).join('')}</div>
        ${live.length ? '' : demoNote(ctx, null, 'Connect Stripe, PayPal or Shopify under Integrations. Only connected sources are added up.')}</div>`;
    },
    panelWidth: 350, on: connectOn,
  },
];
