// Graph rendering (src/renderer/shared/graph.js) - pure string output, no DOM needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, dualLineChart, barChart, spark, sparkBars } from '../src/renderer/shared/graph.js';

const pathOf = (html) => html.match(/class="gr-line"[^>]*/)?.[0] && html.match(/<path d="([^"]+)" class="gr-line"/)[1];
const points = (d) => d.split(/[ML]/).filter(Boolean).map((p) => p.trim().split(/\s+/).map(Number));

test('line chart scales with its container: no fixed pixel width', () => {
  const html = lineChart([1, 2, 3], { h: 64 });
  assert.match(html, /class="graph[^"]*" style="height:64px"/);
  assert.doesNotMatch(html, /width="\d+"/, 'the svg must not have a fixed width');
  assert.match(html, /preserveAspectRatio="none"/);
});

test('values map into the padded plot area and never leave it', () => {
  const html = lineChart([0, 50, 100, 150], { h: 70, max: 100 });
  for (const [x, y] of points(pathOf(html))) {
    assert.ok(x >= 0 && x <= 1000, `x ${x} inside`);
    assert.ok(y >= 6 - 1e-9 && y <= 64 + 1e-9, `y ${y} inside the padding`);
  }
  // 150 is clamped to the fixed max: same height as 100
  const pts = points(pathOf(html));
  assert.equal(pts[3][1], pts[2][1]);
});

test('a short history is aligned to the right edge (slots)', () => {
  const pts = points(pathOf(lineChart([10, 20], { h: 50, max: 100, slots: 48 })));
  assert.equal(pts.at(-1)[0], 1000, 'newest sample at the right edge');
  assert.ok(pts[0][0] > 900, 'older samples follow to the left, not stretched over the width');
});

test('the "now" dot is positioned in percent so it cannot be clipped or distorted', () => {
  const html = lineChart([0, 100], { h: 40, max: 100, dot: true });
  const m = html.match(/class="gr-dot" style="left:([\d.]+)%;top:([\d.]+)%/);
  assert.ok(m, 'dot rendered');
  assert.equal(Number(m[1]), 100);
  assert.ok(Number(m[2]) > 0 && Number(m[2]) < 100);
});

test('grid and labels', () => {
  const html = lineChart([5, 10], { h: 60, max: 100, grid: [0, 0.5, 1], labels: true, fmt: (v) => v + '%' });
  assert.equal((html.match(/class="gr-grid"/g) || []).length, 3);
  assert.match(html, /gr-lbl top">100%</);
  assert.match(html, /gr-lbl bottom">0%</);
  assert.match(html, /graph has-lbl/);
});

test('identical data gives identical markup (lets the DOM patcher skip the update)', () => {
  assert.equal(lineChart([1, 4, 2], { color: '#30d158', fill: true }), lineChart([1, 4, 2], { color: '#30d158', fill: true }));
});

test('empty, single and invalid values do not throw or produce NaN', () => {
  for (const v of [[], [5], [null, NaN, 3, undefined, 4], undefined]) {
    const html = lineChart(v, { h: 30 });
    assert.doesNotMatch(html, /NaN|Infinity/);
  }
  assert.doesNotMatch(barChart([], {}), /NaN/);
  assert.doesNotMatch(spark([1], {}), /NaN/);
});

test('two series share one scale', () => {
  const html = dualLineChart([0, 10], [0, 5], { h: 50, colorA: '#00f', colorB: '#0f0' });
  const [a, b] = [...html.matchAll(/<path d="([^"]+)" class="gr-line"/g)].map((m) => points(m[1]));
  assert.ok(a.at(-1)[1] < b.at(-1)[1], '10 is drawn higher than 5');
});

test('bar charts fill their width and highlight one bar', () => {
  const html = barChart([1, 2, 3, 4], { h: 40, highlight: 2 });
  const rects = [...html.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*opacity="([\d.]+)"/g)];
  assert.equal(rects.length, 4);
  const last = rects.at(-1); assert.ok(Number(last[1]) + Number(last[2]) <= 1000);
  assert.deepEqual(rects.map((r) => Number(r[3])), [0.4, 0.4, 1, 0.4]);
  assert.match(sparkBars([1, 2], { w: 20, h: 10 }), /width="20"/);
});
