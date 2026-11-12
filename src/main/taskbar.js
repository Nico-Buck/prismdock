// Windows shell integration: replacing the taskbar and reserving screen space (AppBar).
const { app, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const native = require('./native/bridge');
const { targetDisplays, physRect, barHeight } = require('./displays');

let getConfig = () => { throw new Error('taskbar.init() not called'); };
function init(configGetter) { getConfig = configGetter; }

// While PrismDock runs with "Replace Windows taskbar", the taskbar is switched to auto-hide (so Windows
// releases its work area) and its windows are hidden. The original state is written to disk first, so it
// can be restored on quit, by the helper's crash watchdog, or on the next start after a hard crash.
let taskbarHidden = false;
const TB_FILE = () => path.join(app.getPath('userData'), 'taskbar-restore.json');
async function setTaskbarHidden(hide) {
  if (hide === taskbarHidden && !hide) return;
  if (hide) {
    // Record the user's own taskbar setting - but only while the taskbar is visible and no record exists.
    // The record is deleted on every successful restore, so an existing one comes from a session that ended
    // without restoring (crash, shutdown) and still holds the true original - after a reboot the taskbar is
    // visible again but its auto-hide state is still ours.
    if (!taskbarHidden && !fs.existsSync(TB_FILE())) {
      const info = await native.call('tbInfo').catch(() => null);
      if (info && info.visible && info.state >= 0) fs.writeFileSync(TB_FILE(), JSON.stringify({ state: info.state, at: new Date().toISOString() }));
    }
    const monitors = targetDisplays(getConfig()).flatMap(physRect);
    await native.call('taskbar', { show: false, monitors }).catch(() => null);
    // a guardian outside our process job restores the taskbar if PrismDock is killed or crashes
    if (!taskbarHidden && fs.existsSync(TB_FILE())) startGuard();
    taskbarHidden = true;
  } else {
    await restoreTaskbar();
  }
}
function startGuard() {
  const source = native.nativeFile('guard.cs');
  const hash = crypto.createHash('sha1').update(fs.readFileSync(source)).digest('hex').slice(0, 10);
  const exe = path.join(app.getPath('userData'), `guard-${hash}.exe`);
  // guards compiled by older versions
  for (const f of fs.readdirSync(app.getPath('userData'))) if (/^guard-[0-9a-f]+\.exe$/.test(f) && f !== path.basename(exe)) try { fs.unlinkSync(path.join(app.getPath('userData'), f)); } catch { /* still running */ }
  native.call('guard', { pid: process.pid, file: TB_FILE(), source, exe }, 30000).catch((e) => console.warn('taskbar guard not started:', e.message));
}
async function restoreTaskbar({ forget = true } = {}) {
  let restore = -1;
  try { restore = JSON.parse(fs.readFileSync(TB_FILE(), 'utf8')).state; } catch { /* nothing saved */ }
  if (!taskbarHidden && restore < 0) return;
  try { await native.call('taskbar', { show: true, restore }, 4000); } catch {
    return; // helper busy or gone: keep the record so the guardian or the next start restores it
  }
  if (forget) try { fs.unlinkSync(TB_FILE()); } catch { /* already gone */ }
  taskbarHidden = false;
}

// Reserve a strip of the screen for a dock (maximized windows end above it). Windows may grant a
// different rect than requested; the dock window then sits exactly in the granted strip.
async function appbar(win, on, display) {
  if (!win || win.isDestroyed()) return;
  const hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE());
  // the helper answers in order but can be busy for seconds: a newer call supersedes an older one
  const gen = win.appbarGen = (win.appbarGen || 0) + 1;
  if (!on) {
    if (win.appbarRect || win.appbarPending) { win.appbarRect = null; await native.call('appbar', { hwnd, on: false }).catch(() => {}); }
    return;
  }
  const cfg = getConfig(); const s = display.scaleFactor;
  const h = Math.round((barHeight(cfg) + cfg.layout.margin * 2) * s);
  const top = cfg.layout.edge === 'top';
  const p = screen.dipToScreenRect(null, display.bounds);
  const px = { l: p.x, r: p.x + p.width, t: p.y, b: p.y + p.height };
  win.appbarPending = true;
  try {
    const rc = await native.call('appbar', { hwnd, on: true, edge: top ? 1 : 3, l: px.l, r: px.r, t: top ? px.t : px.b - h, b: top ? px.t + h : px.b });
    if (win.isDestroyed()) { native.call('appbar', { hwnd, on: false }).catch(() => {}); return; } // dock gone meanwhile
    if (gen !== win.appbarGen) return; // switched off or re-requested meanwhile: that call decides
    win.appbarRect = rc && rc.length === 4 ? rc : null;
  } catch { if (!win.isDestroyed() && gen === win.appbarGen) win.appbarRect = null; } finally { if (!win.isDestroyed() && gen === win.appbarGen) win.appbarPending = false; }
}

module.exports = { init, setTaskbarHidden, restoreTaskbar, appbar, TB_FILE };
