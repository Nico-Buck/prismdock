// Graph rendering: line charts and bar charts as inline SVG.
//
// The charts scale with their container. The SVG uses a fixed internal coordinate system
// (viewBox) with preserveAspectRatio="none", so it can be stretched to any width; strokes
// use vector-effect:non-scaling-stroke so they keep their thickness. Elements that must
// not be distorted (the "now" dot, labels) are HTML positioned in percent on top of it.
// All markup is deterministic (no random ids), so an unchanged chart produces identical
// markup and the DOM patcher leaves it alone; a changed chart only updates attributes.

import { clamp } from './ui.js';

const VW = 1000; // internal width of the coordinate system
const PAD = 6;   // inner vertical padding (in internal units, ≈ px at the usual heights)

const finite = (v) => (v || []).filter((x) => x != null && Number.isFinite(x));
const gid = (color) => 'gr' + String(color).replace(/[^a-z0-9]/gi, '').slice(0, 24);

/**
 * Line chart that fills its container's width.
 * @param {number[]} values   oldest → newest
 * @param {object}   o
 *   h      height in px (the width always follows the container)
 *   max    fixed upper bound (e.g. 100 for percentages); otherwise the data max
 *   color  line colour; fill: area under the line; dot: mark the latest value
 *   grid   horizontal guide lines (fractions of the range), labels: show 0 / max labels
 *   fmt    label formatter, slots: number of samples the x axis spans (keeps a
 *          growing history from stretching while it fills up)
 */
export function lineChart(values, o = {}) {
  const { h = 64, max = null, color = '#0a84ff', fill = true, dot = false, grid = [], labels = false, fmt = (v) => Math.round(v), slots = 0, cls = '' } = o;
  const v = finite(values);
  const H = h;
  const top = max ?? Math.max(...v, 1e-9);
  const n = Math.max(slots, v.length);
  const x = (i) => (n <= 1 ? VW : ((i + (n - v.length)) / (n - 1)) * VW);
  const y = (val) => H - PAD - (clamp(val, 0, top) / (top || 1)) * (H - 2 * PAD);
  const pts = v.map((val, i) => [x(i), y(val)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const id = gid(color);
  const guides = grid.map((f) => `<line x1="0" x2="${VW}" y1="${y(top * f).toFixed(1)}" y2="${y(top * f).toFixed(1)}" class="gr-grid"/>`).join('');
  const last = pts.at(-1);
  return `<div class="graph ${labels ? 'has-lbl' : ''} ${cls}" style="height:${H}px"><div class="gr-plot">
    <svg viewBox="0 0 ${VW} ${H}" preserveAspectRatio="none" aria-hidden="true">
      ${guides}
      ${pts.length > 1 && fill ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${last[0].toFixed(1)} ${H}L${pts[0][0].toFixed(1)} ${H}Z" fill="url(#${id})"/>` : ''}
      ${pts.length > 1 ? `<path d="${d}" class="gr-line" style="stroke:${color}"/>` : ''}
    </svg>
    ${dot && last ? `<i class="gr-dot" style="left:${(last[0] / VW) * 100}%;top:${(last[1] / H) * 100}%;background:${color}"></i>` : ''}</div>
    ${labels ? `<span class="gr-lbl top">${fmt(top)}</span><span class="gr-lbl bottom">${fmt(0)}</span>` : ''}
  </div>`;
}

/** Two series on one shared scale (e.g. download / upload). */
export function dualLineChart(a, b, o = {}) {
  const top = o.max ?? Math.max(...finite(a), ...finite(b), 1e-9);
  return `<div class="graph-stack" style="height:${o.h || 64}px">${lineChart(a, { ...o, max: top, color: o.colorA })}${lineChart(b, { ...o, max: top, color: o.colorB, fill: false, labels: false, grid: [] })}</div>`;
}

/** Bar chart that fills its container's width. highlight: index drawn at full opacity. */
export function barChart(values, { h = 48, color = '#0a84ff', gap = 0.25, highlight = -1, cls = '' } = {}) {
  const v = (values || []).map((x) => (Number.isFinite(x) ? x : 0));
  if (!v.length) return `<div class="graph ${cls}" style="height:${h}px"></div>`;
  const mx = Math.max(...v, 1e-9);
  const slot = VW / v.length, bw = slot * (1 - gap);
  return `<div class="graph ${cls}" style="height:${h}px"><svg viewBox="0 0 ${VW} ${h}" preserveAspectRatio="none" aria-hidden="true">${v.map((val, i) => {
    const bh = Math.max(1.5, (val / mx) * (h - 2));
    return `<rect x="${(i * slot + (slot - bw) / 2).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" opacity="${highlight < 0 || i === highlight ? 1 : 0.4}"/>`;
  }).join('')}</svg></div>`;
}

/** Small fixed-size sparkline for tiles (tiles have an exact pixel width anyway). */
export function spark(values, { w = 80, h = 24, color = '#0a84ff', max = null } = {}) {
  const v = finite(values);
  if (v.length < 2) return `<svg width="${w}" height="${h}" class="spark"></svg>`;
  const mx = max ?? Math.max(...v, 1e-9);
  const pts = v.map((val, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * (w - 2) + 1).toFixed(1)} ${(h - 2 - (clamp(val, 0, mx) / (mx || 1)) * (h - 4)).toFixed(1)}`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="spark" aria-hidden="true"><path d="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/** Small fixed-size bars for tiles. */
export function sparkBars(values, { w = 56, h = 24, color = '#0a84ff', gap = 1.5, highlight = -1 } = {}) {
  const v = (values || []).map((x) => (Number.isFinite(x) ? x : 0)); if (!v.length) return '';
  const mx = Math.max(...v, 1e-9); const bw = (w - gap * (v.length - 1)) / v.length;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="spark" aria-hidden="true">${v.map((x, i) => {
    const bh = Math.max(1.5, (x / mx) * (h - 2));
    return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(1.5, bw / 2)}" fill="${color}" opacity="${highlight < 0 || i === highlight ? 1 : 0.45}"/>`;
  }).join('')}</svg>`;
}
