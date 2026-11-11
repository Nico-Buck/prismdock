// Widget registry. Built-in packs + user-defined custom widgets from config.customWidgets.
import system from './system.js';
import productivity from './productivity.js';
import media from './media.js';
import time from './time.js';
import apps from './apps.js';
import online from './online.js';
import { icon, esc, fmtNum } from '../shared/ui.js';

export const CATEGORIES = [
  ['system', 'System', 'cpu'], ['productivity', 'Productivity', 'check'], ['media', 'Media & Audio', 'music'], ['time', 'Clocks', 'clock'],
  ['weather', 'Weather', 'cloud'], ['apps', 'Apps & Files', 'grid'], ['developer', 'Developer', 'code'], ['social', 'Social', 'user'],
  ['ai', 'AI', 'sparkles'], ['finance', 'Finance', 'dollar'], ['custom', 'Custom', 'plus'],
];

const BUILTIN = [...apps, ...system, ...productivity, ...media, ...time, ...online];

function getPath(obj, path) {
  return (path || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
}

// Custom widget kinds: link (opens a URL/app), json (shows a value from a JSON endpoint), text (static label)
function customDef(c) {
  const tileIcon = `<span class="glyph-tile" style="background:${esc(c.color || '#0a84ff')};color:#fff">${c.emoji ? `<span style="font-size:calc(20px*var(--u))">${esc(c.emoji)}</span>` : icon(c.icon || 'sparkles')}</span>`;
  return {
    type: 'custom:' + c.id, name: c.name || 'Custom widget', cat: 'custom', icon: c.icon || 'sparkles', desc: c.kind === 'json' ? `Value from ${c.url}` : c.kind === 'link' ? `Opens ${c.target || c.url}` : 'Custom text',
    sizes: ['s', 'm'], size: 'm', custom: true,
    topics: c.kind === 'json' && c.url ? ['custom:' + c.url] : [],
    noPanel: c.kind !== 'json',
    tile(ctx, d) {
      if (ctx.size === 's') return `<div class="tin sq">${tileIcon}</div>`;
      let value = c.text || '';
      if (c.kind === 'json') {
        const raw = d['custom:' + c.url];
        const v = raw === undefined ? '…' : getPath(raw, c.path);
        value = typeof v === 'number' ? fmtNum(v) : v == null ? '–' : String(v).slice(0, 40);
        value = `${c.prefix || ''}${value}${c.suffix || ''}`;
      }
      return `<div class="tin wide">${tileIcon}<div class="col" style="gap:calc(6px*var(--u))">${c.kind === 'json' ? `<span class="t-big" style="font-weight:650">${esc(value)}</span><span class="t-sub">${esc(c.label || c.name)}</span>` : `<span class="t-title">${esc(c.name)}</span>${value ? `<span class="t-sub">${esc(value)}</span>` : ''}`}</div></div>`;
    },
    onClick(ctx) { if (c.kind === 'link' && (c.target || c.url)) { ctx.act('open', { target: c.target || c.url }); return true; } return false; },
    panel(ctx, d) {
      const raw = d['custom:' + c.url];
      return `<div class="pn"><div class="pn-head"><h3>${esc(c.name)}</h3><button class="btn icon" data-a="refresh">${icon('refresh', 13)}</button></div><pre style="margin:0;max-height:300px;overflow:auto;font-size:11px;background:var(--fill-1);padding:10px;border-radius:10px;white-space:pre-wrap">${esc(JSON.stringify(raw, null, 2)?.slice(0, 4000))}</pre></div>`;
    },
    on: { refresh: (ctx) => ctx.hub.refresh('custom:' + c.url) },
  };
}

export function registry(config) {
  const map = new Map(BUILTIN.map((w) => [w.type, w]));
  for (const c of config.customWidgets || []) map.set('custom:' + c.id, customDef(c));
  return map;
}

export function defaultsFor(def) {
  const s = {};
  for (const f of def.settings || []) if (f.default !== undefined) s[f.key] = f.default;
  return s;
}
