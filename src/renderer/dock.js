// Entry for the dock window: wires DockView to the real desktop (wallpaper glass, click-through, focus).
import { DockView, DataStore } from './shared/dock-view.js';
import { Hub } from './shared/hub.js';
import { placeWallpaper } from './shared/glass.js';

const api = window.prism;
const root = document.getElementById('root');
let cfg = await api.config.get();
const store = new DataStore(api);
await store.load();
const hub = new Hub(api, () => cfg);
const view = new DockView(root, { api, hub, store, canvas: root.querySelector('.glass-canvas') });
api.dock.display().then((d) => { view.timerOwner = d?.timerOwner !== false; });
view.setConfig(cfg);

api.config.onChange((c) => { cfg = c; view.setConfig(c); applyGlassSource(); updateSensor?.(); });

// ---------- wallpaper as the glass backdrop ----------
let wallImg = null; let wp = null; let display = await api.dock.display();
function applyGlassSource() {
  if (cfg.appearance.glassEngine === 'flat' || !wp) { view.glass.setSource({ img: null, color: wpColor() }); return; }
  view.glass.setSource({
    img: wallImg, color: wpColor(),
    place: () => placeWallpaper(wallImg, wp.style, display.bounds, { x: window.screenX, y: window.screenY }),
  });
}
function wpColor() {
  const c = (wp?.color || '30 30 34').split(' ').map(Number);
  return `rgb(${c[0] || 0},${c[1] || 0},${c[2] || 0})`;
}
let wallReq = 0;
function loadWallpaper(w) {
  wp = w;
  const req = ++wallReq; // an older image that finishes loading later must not win
  if (!w?.url) { wallImg = null; applyGlassSource(); return; }
  const img = new Image();
  img.onload = () => { if (req !== wallReq) return; wallImg = img; applyGlassSource(); };
  img.onerror = () => { if (req !== wallReq) return; wallImg = null; applyGlassSource(); };
  img.src = w.url;
}
loadWallpaper(await api.wallpaper());
api.onWallpaper(loadWallpaper);
// Show-on-hover sensor: on a real screen edge the pointer stops there, so 3 px are enough. When another
// display continues below/above (stacked monitors) the pointer passes through, so the strip is taller and
// needs a short dwell, so the dock does not pop up while you move to the other display.
function updateSensor() {
  const b = display?.bounds; if (!b) return;
  const top = cfg.layout.edge === 'top';
  view.sensorShared = (display.all || []).some((o) => o.x < b.x + b.width && o.x + o.width > b.x && (top ? o.y + o.height === b.y : o.y === b.y + b.height));
  view.sensor.style.height = view.sensorShared ? '10px' : '';
}
view.setDisplayKey(display?.key); updateSensor();
// While hidden, watch the real cursor: forwarded mouse events of a click-through window are not delivered
// reliably on the last pixel rows, which is exactly where the pointer rests at a screen edge.
let edgeHits = 0;
setInterval(async () => {
  if (!view.hidden || !view._ahOn() || view.root.classList.contains('fs-hidden')) { edgeHits = 0; return; }
  const p = await api.dock.cursor().catch(() => null); if (!p) return;
  const x = p.x - window.screenX, y = p.y - window.screenY, zone = view.sensorShared ? 10 : 3;
  const inZone = x >= 0 && x < window.innerWidth && (cfg.layout.edge === 'top' ? y >= 0 && y < zone : y >= window.innerHeight - zone && y < window.innerHeight);
  edgeHits = inZone ? edgeHits + 1 : 0;
  if (edgeHits >= (view.sensorShared ? 2 : 1)) { edgeHits = 0; view._hovering = true; view._reveal(); watchLeave(); }
}, 100);
api.dock.onDisplay(async () => { display = await api.dock.display(); view.timerOwner = display?.timerOwner !== false; view.setDisplayKey(display?.key); updateSensor(); applyGlassSource(); });
window.addEventListener('resize', async () => { display = await api.dock.display(); applyGlassSource(); });

// ---------- click-through: only glass surfaces take the mouse ----------
let ignoring = true; let sensorT = null; let leaveT = null;
// A click-through window gets no mouseleave when the pointer exits through the screen edge into the next
// display. While a show-on-hover dock is hovered, check the real cursor so it still hides afterwards.
function watchLeave() {
  if (leaveT || !view._ahOn()) return;
  leaveT = setInterval(async () => {
    if (!view._hovering) { clearInterval(leaveT); leaveT = null; return; }
    const p = await api.dock.cursor(); const x = p.x - window.screenX, y = p.y - window.screenY;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) { clearInterval(leaveT); leaveT = null; view._hovering = false; view._maybeAutohide(); }
  }, 300);
}
function setIgnore(v) { if (v !== ignoring) { ignoring = v; api.dock.ignore(v); } }
// tell the main process where the interactive surfaces are (see "mouse forwarding" in main.js)
let zoneRaf = 0; let lastZone = '';
view.onZone = () => {
  if (zoneRaf) return;
  zoneRaf = requestAnimationFrame(() => {
    zoneRaf = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of root.querySelectorAll('[data-hit]')) {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    const z = x1 > x0 ? { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) } : { x: 0, y: 0, w: 0, h: 0 };
    const key = JSON.stringify(z); if (key === lastZone) return; lastZone = key;
    api.dock.zone(z);
  });
};
window.addEventListener('resize', () => view.onZone());
view.onZone();
document.addEventListener('mousemove', (e) => {
  const hit = e.target.closest?.('[data-hit]');
  let visible = false;
  if (hit) { const cs = getComputedStyle(hit); visible = cs.visibility !== 'hidden' && cs.pointerEvents !== 'none'; }
  setIgnore(!(visible || view._drag));
  const onSensor = !!e.target.closest?.('.sensor');
  if (onSensor && view.hidden && view.sensorShared) {
    if (!sensorT) sensorT = setTimeout(async () => {
      sensorT = null;
      // the pointer may have left through the edge without a mouseleave (click-through window): check where it is now
      const p = await api.dock.cursor(); const r = view.sensor.getBoundingClientRect();
      const x = p.x - window.screenX, y = p.y - window.screenY;
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return;
      view._hovering = true; view._reveal(); watchLeave();
    }, 140);
    return;
  }
  clearTimeout(sensorT); sensorT = null;
  const overDock = onSensor || !!e.target.closest?.('.dock, .panel, .ctx');
  if (overDock !== view._hovering) {
    view._hovering = overDock;
    if (overDock) { view._reveal(); watchLeave(); } else view._maybeAutohide();
  }
});
document.addEventListener('mouseleave', () => { clearTimeout(sensorT); sensorT = null; if (!view._drag) setIgnore(true); view._hovering = false; view._maybeAutohide(); });

// ---------- focus ----------
api.dock.onBlur(() => { if (cfg.behavior.closeOnBlur) view.onBlur(); });

// Layout Editor can be opened from Settings or the tray
api.dock.onEditor((tab) => view.openEditor(tab || 'arrange'));

// fullscreen game/video in front: step out of the way
api.dock.onFullscreen((on) => {
  if (on) { view.closeCtx(); view.closePanel(); }
  root.classList.toggle('fs-hidden', on);
  view.syncDockVisible();
});

// used by the PRISM_DEBUG test harness (CONTRIBUTING.md)
window.__view = view;

// pause polling when the dock is hidden by the system (e.g. tray toggle)
document.addEventListener('visibilitychange', () => view.updatePause());
