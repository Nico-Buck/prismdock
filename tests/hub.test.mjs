// Data hub (src/renderer/shared/hub.js): one polling chain per topic, whatever happens while a fetch runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hub } from '../src/renderer/shared/hub.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const config = () => ({ performance: { powerSaver: false, intervals: { system: 40, network: 40, media: 40, windows: 40, weather: 900, online: 300 } } });

test('a second subscriber and refreshes during a fetch do not start extra polling chains', async () => {
  const api = { calls: 0, sys: async () => { api.calls++; await sleep(5); return { pct: api.calls }; } };
  const hub = new Hub(api, config);
  const seen = [];
  const u1 = hub.subscribe('cpu', (v) => seen.push(v));
  const u2 = hub.subscribe('cpu', () => {}); // same topic while the first fetch is in flight
  for (let i = 0; i < 5; i++) { await sleep(20); hub.refresh('cpu'); }
  hub.setPaused(true); hub.setPaused(false);
  const c0 = api.calls;
  await sleep(1000);
  const calls = api.calls - c0;
  u1(); u2();
  // one chain polls about every 45-60 ms (16-22 fetches a second); the old hub ran two chains here (~32)
  assert.ok(calls <= 25, `expected a single polling chain, got ${calls} fetches in 1 s`);
  assert.ok(seen.length > 0);
  const after = api.calls;
  await sleep(150);
  assert.equal(api.calls, after, 'polling stops after the last unsubscribe');
});

test('a forced refresh of an online service bypasses its cache', async () => {
  const opts = [];
  const api = { integration: async (_n, o) => { opts.push(o || {}); return { connected: true }; } };
  const hub = new Hub(api, config);
  const u = hub.subscribe('integ:github', () => {});
  await sleep(10);
  hub.refresh('integ:github');
  await sleep(10);
  u();
  assert.equal(opts.at(-1).refresh, true);
});
