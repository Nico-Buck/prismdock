// Display geometry: which monitors get a dock, where the dock window sits, stable display keys.
const { screen } = require('electron');

const PANEL_SPACE = 760; // transparent room above/below the bar where panels open

function barHeight(cfg) {
  const l = cfg.layout;
  return l.size === 'custom' ? l.height : ({ S: 46, M: 54, L: 64 })[l.size] || 54;
}
function dockBounds(display, cfg, win) {
  const top = cfg.layout.edge === 'top';
  // never taller than the display, or panels and menus would open above the screen (1080p at 150 % is 720 px)
  const h = Math.min(barHeight(cfg) + cfg.layout.margin * 2 + PANEL_SPACE, display.bounds.height);
  // with a reserved AppBar strip, sit exactly in the strip Windows granted us
  if (win?.appbarRect) {
    const r = win.appbarRect;
    const dip = screen.screenToDipRect(null, { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] });
    // horizontally too: with a vertical Windows taskbar on this display the granted strip is narrower
    return { x: Math.round(dip.x), y: Math.round(top ? dip.y : dip.y + dip.height - h), width: Math.round(dip.width), height: h };
  }
  const area = cfg.behavior.hideTaskbar ? display.bounds : display.workArea;
  return { x: area.x, y: top ? area.y : area.y + area.height - h, width: area.width, height: h };
}
// A display key that survives restarts and re-plugging (Electron's display.id may change):
// monitor name + native resolution, with a counter for identical monitors.
function displayKeys() {
  const seen = {};
  const list = [...screen.getAllDisplays()].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return list.map((d) => {
    const base = `${d.label || 'Display'}|${Math.round(d.size.width * d.scaleFactor)}x${Math.round(d.size.height * d.scaleFactor)}`;
    seen[base] = (seen[base] || 0) + 1;
    return { d, key: seen[base] > 1 ? `${base}#${seen[base]}` : base };
  });
}
function targetDisplays(cfg) {
  const mode = cfg.behavior.monitors;
  const primary = screen.getPrimaryDisplay();
  if (mode === 'primary') return [primary];
  if (mode === 'custom') {
    const chosen = displayKeys().filter((x) => (cfg.behavior.monitorList || []).includes(x.key)).map((x) => x.d);
    return chosen.length ? chosen : [primary];
  }
  return screen.getAllDisplays();
}
const keyOf = (d) => displayKeys().find((x) => x.d.id === d.id)?.key || '';
// "show only on hover" is chosen per display; displays without a choice follow behavior.autohide
function autohideOn(cfg, d) { const per = cfg.behavior.autohidePer || {}; const k = keyOf(d); return k in per ? !!per[k] : !!cfg.behavior.autohide; }
// physical monitor rects, used by the helper to pick which taskbars to replace
const physRect = (d) => { const p = screen.dipToScreenRect(null, d.bounds); return [p.x, p.y, p.x + p.width, p.y + p.height]; };

function displayInfo(d) {
  return { id: d.id, key: keyOf(d), bounds: d.bounds, workArea: d.workArea, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id, all: screen.getAllDisplays().map((x) => x.bounds) };
}

module.exports = { PANEL_SPACE, barHeight, dockBounds, displayKeys, targetDisplays, keyOf, autohideOn, physRect, displayInfo };
