// Configuration defaults, migration and sanitising (src/main/config.js).
// Runs in plain Node: the Electron APIs used by the store are only touched when a Store is created.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DEFAULTS, migrate, sanitize, deepMerge } = require('../src/main/config');

test('defaults are at the current schema version', () => {
  assert.equal(DEFAULTS().version, 4);
});

test('a v1 config gains the Start widget, taskbar replacement and docks on all monitors', () => {
  const c = migrate({ layout: { height: 72, margin: 10 }, widgets: [{ uid: 'a', type: 'apps', settings: {} }], behavior: {} });
  assert.equal(c.version, 4);
  assert.equal(c.widgets[0].type, 'winkey');
  assert.equal(c.widgets[1].settings.showStart, false);
  assert.equal(c.layout.height, 54);
  assert.equal(c.behavior.hideTaskbar, true);
  assert.equal(c.behavior.monitors, 'all');
});

test('v3 -> v4 turns the removed glow hover effect into the highlight', () => {
  const c = migrate({ version: 3, behavior: { hoverEffect: 'glow' }, widgets: [{ type: 'winkey' }] });
  assert.equal(c.behavior.hoverEffect, 'lift');
  assert.equal(c.version, 4);
});

test('migration never duplicates the Start widget (also in saved layouts)', () => {
  const c = migrate({ version: 2, widgets: [{ type: 'winkey' }], profiles: [{ widgets: [{ type: 'clock' }] }, { widgets: [{ type: 'winkey' }] }] });
  assert.equal(c.widgets.filter((w) => w.type === 'winkey').length, 1);
  assert.equal(c.profiles[0].widgets[0].type, 'winkey');
  assert.equal(c.profiles[1].widgets.filter((w) => w.type === 'winkey').length, 1);
});

test('non-finite numbers fall back to their defaults', () => {
  const c = deepMerge(DEFAULTS(), { layout: { gap: null, margin: NaN }, performance: { intervals: { system: 'x' } } });
  sanitize(c);
  assert.equal(c.layout.gap, DEFAULTS().layout.gap);
  assert.equal(c.layout.margin, DEFAULTS().layout.margin);
  assert.equal(c.performance.intervals.system, DEFAULTS().performance.intervals.system);
});

test('deepMerge replaces arrays and keeps unknown defaults', () => {
  const m = deepMerge({ a: [1, 2], b: { c: 1, d: 2 } }, { a: [3], b: { c: 5 } });
  assert.deepEqual(m, { a: [3], b: { c: 5, d: 2 } });
});

test('config.example.json matches the built-in defaults and holds no secrets', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'));
  const d = JSON.parse(JSON.stringify(DEFAULTS()));
  // widget uids are generated per run
  const strip = (c) => ({ ...c, widgets: c.widgets.map(({ uid, ...w }) => w) });
  assert.deepEqual(strip(ex), strip(d));
  const text = JSON.stringify(ex);
  assert.doesNotMatch(text, /"(token|secret|password|apiKey)"\s*:\s*"[^"]+"/i);
});
