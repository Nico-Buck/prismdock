const { app, BrowserWindow, ipcMain, screen, protocol, net, shell, Tray, Menu, nativeImage, dialog, desktopCapturer, clipboard, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Store } = require('./config');
const native = require('./native/bridge');
const providers = require('./providers');
const integrations = require('./integrations');
const spotify = require('./spotify');
const { dockBounds, targetDisplays, autohideOn, displayInfo, displayKeys } = require('./displays');
const taskbar = require('./taskbar');
const { setTaskbarHidden, restoreTaskbar, appbar, TB_FILE } = taskbar;

const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(__dirname, '..', '..', 'assets');

// development/testing: run against a separate profile instead of %APPDATA%\prismdock
if (process.env.PRISM_USER_DATA) app.setPath('userData', path.resolve(process.env.PRISM_USER_DATA));
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
// the same ID as the installer's Start menu shortcut (build.appId), or Windows drops the notifications
app.setAppUserModelId('local.prismdock');
// Windows build: acrylic backgrounds need Windows 11 22H2, round corners Windows 11
const WIN_BUILD = Number(require('os').release().split('.')[2]) || 0;
const ACRYLIC = WIN_BUILD >= 22621; const WIN11 = WIN_BUILD >= 22000;
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let store;
let tray;
let settingsWin = null;
const docks = new Map(); // displayId -> BrowserWindow
let wallpaper = null;
let quitting = false;

// ---------------- mouse forwarding ----------------
// A dock window is click-through except over its glass. To notice the pointer entering the glass, Chromium
// has to receive every mouse move over the whole (mostly empty) window, which costs CPU in the main, renderer
// and GPU processes. The renderer reports the zone that is interactive right now (bar, open panel, menu,
// edge sensor); moves are forwarded only while the cursor is near that zone.
const NEAR = 24; // px around the zone
function applyMouse(w) {
  const m = w.mouse;
  if (!m.ignore) w.setIgnoreMouseEvents(false);
  else w.setIgnoreMouseEvents(true, { forward: m.near });
}
let cursorTimer = null;
function watchCursor() {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    if (!docks.size) { clearInterval(cursorTimer); cursorTimer = null; return; }
    const p = screen.getCursorScreenPoint();
    for (const w of docks.values()) {
      if (w.isDestroyed()) continue;
      const b = w.getBounds(); const z = w.mouse.zone;
      const near = !z || (p.x >= b.x + z.x - NEAR && p.x <= b.x + z.x + z.w + NEAR && p.y >= b.y + z.y - NEAR && p.y <= b.y + z.y + z.h + NEAR);
      if (near !== w.mouse.near) { w.mouse.near = near; applyMouse(w); }
    }
  }, 60);
}

// ---------------- dock windows ----------------
function createDock(display) {
  const cfg = store.config;
  const win = new BrowserWindow({
    ...dockBounds(display, cfg),
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, focusable: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, additionalArguments: [`--display=${display.id}`] },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.mouse = { ignore: true, near: true, zone: null };
  applyMouse(win);
  win.displayId = display.id;
  win.loadURL(`app://prism/dock.html?display=${display.id}`);
  win.once('ready-to-show', () => { win.setBounds(dockBounds(display, store.config, win)); win.showInactive(); setTimeout(() => { if (!win.isDestroyed()) win.setBounds(dockBounds(screen.getAllDisplays().find((x) => x.id === win.displayId) || display, store.config, win)); }, 400); });
  win.on('blur', () => win.webContents.send('dock:blur'));
  // a dock is part of the shell: only quitting PrismDock closes it (not WM_CLOSE from other programs)
  win.on('close', (e) => { if (!quitting) e.preventDefault(); });
  // Windows is logging off or shutting down: give the taskbar back while we still can
  win.on('session-end', () => { quitting = true; restoreTaskbar().catch(() => {}); });
  if (process.env.PRISM_DEBUG) win.webContents.on('console-message', (_e, level, msg, line, src) => console.log(`[dock ${level}] ${msg} (${src}:${line})`));
  win.on('closed', () => docks.delete(display.id));
  // a crashed or killed renderer (GPU reset, out of memory) would leave the display without a bar: rebuild it
  win.webContents.on('render-process-gone', (_e, d) => {
    if (quitting || d.reason === 'clean-exit') return;
    console.warn('dock renderer gone:', d.reason);
    setTimeout(() => { if (!win.isDestroyed()) { appbar(win, false); win.destroy(); } docks.delete(display.id); layoutDocks(); }, 500);
  });
  docks.set(display.id, win);
  fsState.delete(display.id);
  win.webContents.once('did-finish-load', () => applyFullscreen()); // a new dock starts out of full-screen state
  return win;
}

// Timers (Pomodoro, Timer) run in one dock only, or every monitor would notify: the main display's dock,
// or the first dock when the main display has none.
function timerOwner(d) {
  const wanted = targetDisplays(store.config);
  const owner = wanted.find((x) => x.id === screen.getPrimaryDisplay().id) || wanted[0];
  return !!owner && owner.id === d.id;
}
const dockInfo = (d) => ({ ...displayInfo(d), timerOwner: timerOwner(d) });

function layoutDocks() {
  const cfg = store.config;
  const wanted = targetDisplays(cfg);
  const ids = new Set(wanted.map((d) => d.id));
  for (const [id, win] of docks) if (!ids.has(id)) { appbar(win, false); win.destroy(); docks.delete(id); }
  for (const d of wanted) {
    const win = docks.get(d.id) || createDock(d);
    win.setBounds(dockBounds(d, cfg, win));
    win.webContents.send('dock:display', dockInfo(d));
    // a dock that hides itself reserves no space, like an auto-hide taskbar
    appbar(win, cfg.behavior.reserveSpace && !autohideOn(cfg, d), d).then(() => { if (!win.isDestroyed()) { win.setBounds(dockBounds(d, cfg, win)); win.webContents.send('dock:display', dockInfo(d)); } });
  }
  setTaskbarHidden(cfg.behavior.hideTaskbar);
}


function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

// ---------------- Layout Editor (lives in the dock on the primary display) ----------------
function openEditor(tab) {
  const primary = screen.getPrimaryDisplay().id;
  const win = docks.get(primary) || [...docks.values()][0];
  if (!win) return;
  win.showInactive(); win.focus();
  win.webContents.send('dock:editor', tab || 'arrange');
}

// ---------------- settings window ----------------
function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show(); settingsWin.focus();
    if (section) settingsWin.webContents.send('settings:section', section);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1220, height: 820, minWidth: 980, minHeight: 640, show: false,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#f5f5f7', height: 46 },
    // without acrylic (Windows 10, early Windows 11) the transparent page would show plain black: draw it solid
    backgroundMaterial: ACRYLIC ? 'acrylic' : 'none', backgroundColor: ACRYLIC ? '#00000000' : '#141418', title: 'PrismDock',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  settingsWin.loadURL(`app://prism/settings.html${ACRYLIC ? '' : '?solid'}${section ? '#' + section : ''}`);
  settingsWin.once('ready-to-show', () => settingsWin.show());
  // round window corners like every Windows 11 window (the custom title bar opts out of them)
  if (WIN11) settingsWin.once('show', () => native.call('round', { hwnd: Number(settingsWin.getNativeWindowHandle().readBigUInt64LE(0)) }).catch((e) => console.warn('round corners:', e.message)));
  if (process.env.PRISM_DEBUG) settingsWin.webContents.on('console-message', (_e, level, msg, line, src) => console.log(`[settings ${level}] ${msg} (${src}:${line})`));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------------- wallpaper ----------------
async function refreshWallpaper() {
  try {
    const w = await native.call('wallpaper');
    const key = `${w.path}|${w.mtime}|${w.style}`;
    if (!wallpaper || wallpaper.key !== key) {
      wallpaper = { ...w, key, url: fs.existsSync(w.path) ? `app://prism/__wallpaper?v=${encodeURIComponent(w.mtime)}` : null };
      broadcast('wallpaper', wallpaper);
    }
  } catch { /* keep last */ }
}

// ---------------- fullscreen apps: step aside like the taskbar does ----------------
// The helper pushes the monitors whose top window is full screen whenever that changes (WinEvent hooks).
let fsTimer = null; const fsState = new Map(); let fsRects = [];
function applyFullscreen() {
  const on = store.config.behavior.fullscreenHide;
  for (const [id, w] of docks) {
    const d = screen.getAllDisplays().find((x) => x.id === id); if (!d) continue;
    const p = screen.dipToScreenRect(null, d.bounds);
    let fs = false;
    for (let i = 0; on && i + 3 < fsRects.length; i += 4) {
      const r = fsRects.slice(i, i + 4);
      if (Math.abs(r[0] - p.x) < 4 && Math.abs(r[1] - p.y) < 4 && Math.abs(r[2] - (p.x + p.width)) < 4 && Math.abs(r[3] - (p.y + p.height)) < 4) fs = true;
    }
    if (fsState.get(id) !== fs) { fsState.set(id, fs); w.webContents.send('dock:fullscreen', fs); w.setAlwaysOnTop(!fs, 'pop-up-menu'); }
  }
}
native.on('fullscreen', (m) => { fsRects = m.rects || []; applyFullscreen(); });
let helperStarts = 0;
native.on('ready', () => {
  native.call('fswatch').catch(() => {}); native.call('volwatch').catch(() => {});
  // a restarted helper starts without the hidden taskbar and the reserved strips: apply them again
  // (the first start is handled by the normal startup)
  if (helperStarts++ && store && (store.config.behavior.hideTaskbar || docks.size)) layoutDocks();
});
// live volume from Core Audio: coalesced to one update per frame, merged into the cached 'volume' value
let volPush = null;
native.on('volume', (m) => {
  if (m.device) providers.invalidate('volume'); // other output device: name and mic come with the next poll
  const v = providers.patchCached('volume', { level: m.level, muted: m.muted });
  if (!v || volPush) return;
  volPush = setTimeout(() => { volPush = null; broadcast('sys:push', { topic: 'volume', value: providers.patchCached('volume', {}) }); }, 16);
});
function watchFullscreen() {
  clearTimeout(fsTimer);
  const c = store.config;
  applyFullscreen();
  if (!c.behavior.hideTaskbar) return;
  // the taskbar check stays a slow poll; full screen itself is event-driven
  fsTimer = setTimeout(async () => {
    try { const t = await native.call('tick', {}, 3000); if (t.taskbarFixed) layoutDocks(); } catch { /* helper busy */ }
    watchFullscreen();
  }, (c.performance.powerSaver ? 2.5 : 1) * 1500);
}

// ---------------- tray ----------------
function createTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('PrismDock');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Settings', click: () => openSettings() },
    { label: 'Edit layout', click: () => openEditor('arrange') },
    { label: 'Add widgets', click: () => openEditor('add') },
    { type: 'separator' },
    { label: 'Show / hide dock', click: () => { for (const w of docks.values()) w.isVisible() ? w.hide() : w.showInactive(); } },
    { label: 'Reload dock', click: () => { for (const w of docks.values()) w.reload(); } },
    { type: 'separator' },
    { label: 'Quit PrismDock', click: () => app.quit() },
  ]);
  tray.on('click', () => openSettings());
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
}

// ---------------- config side effects ----------------
// A new key, token, user name or channel: drop that service's cached answer and tell every window, so
// widgets swap their sample data for the real thing at once instead of at the next online poll (5 min).
const INTEG_NAME = { calendarIcs: 'calendar' }; // config section -> integration (topic integ:<name>)
function integrationsChanged(names) {
  if (!names.length) return;
  for (const n of names) { integrations.invalidate(n === 'calendar' ? 'ics' : n); providers.invalidate(n); }
  broadcast('integ:changed', names);
}
// The portable build runs from a folder in %TEMP% that is deleted when it exits; the login item must point
// to the portable .exe itself (electron-builder passes its path), otherwise Windows starts nothing at login.
function launcherPath() { return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; }
function setStartWithWindows(on) {
  if (!app.isPackaged) return; // `npm start` would register electron.exe
  try {
    // The Run value keeps its name 'PrismDock' (Electron would name it after the AppUserModelId), so the
    // entry of older versions with the temp path is overwritten, not duplicated. A user who disabled it in
    // Task Manager keeps it disabled: Electron would re-enable it on every write.
    const opts = { path: launcherPath(), args: ['--autostart'], name: 'PrismDock' };
    const item = app.getLoginItemSettings(opts).launchItems?.find((i) => i.name === 'PrismDock');
    app.setLoginItemSettings({ ...opts, openAtLogin: on, enabled: item?.enabled ?? true });
  } catch (e) { console.warn('start with Windows:', e.message); }
}
function applyConfig(prev) {
  const c = store.config;
  if (prev) integrationsChanged(Object.keys(c.integrations).filter((k) => JSON.stringify(prev.integrations?.[k]) !== JSON.stringify(c.integrations[k])).map((k) => INTEG_NAME[k] || k));
  // written at every start too, so the entry follows the exe when it is moved or updated
  if (!prev || prev.behavior.startWithWindows !== c.behavior.startWithWindows) setStartWithWindows(c.behavior.startWithWindows);
  if (!prev || JSON.stringify(prev.layout) !== JSON.stringify(c.layout) || JSON.stringify(prev.behavior) !== JSON.stringify(c.behavior)) layoutDocks();
  if (c.performance.screenTime) providers.startScreenTime(store); else providers.stopScreenTime();
  watchFullscreen();
  broadcast('config', c);
}
function updateConfig(fn) {
  const prev = JSON.parse(JSON.stringify(store.config));
  fn();
  applyConfig(prev);
  return store.config;
}

// ---------------- IPC ----------------
const SAFE_URL = /^(https?:|mailto:|ms-settings:|ms-screenclip:|ms-clock:|spotify:|outlookcal:|search-ms:|ms-actioncenter:|ms-availablenetworks:)/i;

function registerIpc() {
  ipcMain.handle('cfg:get', () => store.config);
  ipcMain.handle('cfg:defaults', () => store.defaults());
  ipcMain.handle('cfg:patch', (_e, p) => updateConfig(() => store.patch(p)));
  ipcMain.handle('cfg:replace', (_e, c) => updateConfig(() => store.replace(c)));
  ipcMain.handle('cfg:reset', (_e, section) => updateConfig(() => store.reset(section)));
  ipcMain.handle('layout:action', (_e, action, a) => updateConfig(() => store.profileAction(action, a)));
  ipcMain.handle('cfg:export', async () => {
    const r = await dialog.showSaveDialog({ title: 'Export configuration', defaultPath: `prismdock-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'PrismDock', extensions: ['json'] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(store.exportBundle(), null, 2));
    return r.filePath;
  });
  ipcMain.handle('cfg:import', async () => {
    const r = await dialog.showOpenDialog({ title: 'Import configuration', properties: ['openFile'], filters: [{ name: 'PrismDock', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const bundle = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    updateConfig(() => store.importBundle(bundle));
    broadcast('data', null);
    return r.filePaths[0];
  });

  ipcMain.handle('data:get', (_e, key) => (key === '*' ? { ...store.data, screentime: undefined } : store.data[key]));
  ipcMain.handle('data:set', (e, key, value) => {
    store.data[key] = value; store.saveData();
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== e.sender) w.webContents.send('data', { key, value });
    return true;
  });

  ipcMain.handle('secret:set', (_e, key, value) => { store.setSecret(key, value); integrationsChanged([key.split('.')[0]]); return store.secretKeys(); });
  ipcMain.handle('secret:keys', () => store.secretKeys());

  ipcMain.handle('sys', (_e, name) => providers.sys[name] ? providers.sys[name]() : null);
  ipcMain.handle('icon', (_e, p, size) => providers.icon(p, size));
  ipcMain.handle('windows', () => providers.windows());
  ipcMain.handle('startApps', () => providers.startApps());
  ipcMain.handle('recent', () => providers.recent());
  ipcMain.handle('aiLocal', () => providers.aiLocal());
  ipcMain.handle('screentime', () => store.data.screentime || {});
  ipcMain.handle('integration', (_e, name, opts) => (name === 'spotify' ? providers.cached('spotify', opts?.refresh ? 0 : 2500, () => spotify.state()) : integrations.get(name, opts)));
  ipcMain.handle('geocode', (_e, q) => integrations.geocode(q));
  ipcMain.handle('customJson', (_e, url, ttl) => integrations.customJson(url, ttl));
  ipcMain.handle('wallpaper', () => wallpaper);
  ipcMain.handle('appInfo', () => ({ version: app.getVersion(), electron: process.versions.electron, userData: app.getPath('userData'), packaged: app.isPackaged, pid: process.pid }));
  ipcMain.handle('metrics', () => {
    const m = app.getAppMetrics();
    return { processes: m.map((p) => ({ type: p.type, cpu: p.cpu.percentCPUUsage, mem: p.memory.workingSetSize * 1024 })), totalMem: m.reduce((a, p) => a + p.memory.workingSetSize * 1024, 0), cpu: m.reduce((a, p) => a + p.cpu.percentCPUUsage, 0), helper: !!native.proc };
  });

  ipcMain.handle('dock:cursor', () => screen.getCursorScreenPoint());
  ipcMain.on('dock:ignore', (e, ignore) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !w.isDestroyed()) { w.mouse.ignore = ignore; applyMouse(w); } });
  ipcMain.on('dock:zone', (e, zone) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !w.isDestroyed()) { w.mouse.zone = zone; watchCursor(); } });
  ipcMain.handle('displays:list', () => {
    const chosen = new Set(targetDisplays(store.config).map((d) => d.id));
    const primary = screen.getPrimaryDisplay().id;
    return displayKeys().map(({ d, key }) => ({ key, label: d.label || 'Display', primary: d.id === primary, width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor), scale: Math.round(d.scaleFactor * 100), x: d.bounds.x, y: d.bounds.y, active: chosen.has(d.id) }));
  });
  ipcMain.handle('display:get', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const d = screen.getAllDisplays().find((x) => x.id === w?.displayId) || screen.getDisplayMatching(w.getBounds());
    return { ...dockInfo(d), window: w.getBounds() };
  });
  ipcMain.on('dock:focus', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.focus(); });
  ipcMain.on('dock:blurSelf', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.blur(); });
  ipcMain.on('settings:open', (_e, section) => openSettings(section));
  ipcMain.on('editor:open', (_e, tab) => openEditor(tab));

  ipcMain.handle('act', async (e, name, a = {}) => {
    switch (name) {
      case 'open': {
        if (!a.target) return false;
        if (a.target === '@downloads') a.target = app.getPath('downloads');
        if (/^shell:/i.test(a.target)) { require('child_process').spawn('explorer.exe', [a.target], { detached: true }); return true; }
        if (SAFE_URL.test(a.target)) { await shell.openExternal(a.target); return true; }
        const err = await shell.openPath(a.target); return !err;
      }
      case 'reveal': shell.showItemInFolder(a.target); return true;
      case 'resolve': return native.call('shortcut', { path: a.path });
      case 'listDir': {
        if (!a.path) return [];
        let ents; try { ents = fs.readdirSync(a.path, { withFileTypes: true }); } catch { return []; } // gone, offline drive or no access
        ents = ents.filter((d) => !d.name.startsWith('.') && !/^desktop\.ini$/i.test(d.name)).slice(0, 200);
        return ents.map((d) => { const p = path.join(a.path, d.name); let size = 0; try { size = d.isFile() ? fs.statSync(p).size : 0; } catch { /* locked */ } return { name: d.name, path: p, dir: d.isDirectory(), size }; })
          .sort((x, y) => (y.dir - x.dir) || x.name.localeCompare(y.name));
      }
      case 'focusWindow': return native.call('focus', { hwnd: a.hwnd, toggle: !!a.toggle });
      case 'closeWindow': providers.invalidate('windows'); return native.call('closeWindow', { hwnd: a.hwnd });
      case 'key': return native.call('key', { vk: a.vk });
      case 'start': return native.call('key', { vk: 0x5B });
      case 'media': providers.invalidate('media'); return native.call('mediaCmd', { action: a.action, position: a.position || 0 }, 12000);
      case 'spotifyConnect': await spotify.connect(); providers.invalidate('spotify'); return true;
      case 'spotifyDisconnect': spotify.disconnect(); providers.invalidate('spotify'); return true;
      case 'spotifySeek': providers.invalidate('spotify'); providers.invalidate('media'); return spotify.seek(a.position);
      case 'spotifyRedirect': return spotify.REDIRECT;
      case 'volume': providers.invalidate('volume'); return native.call('setVolume', { level: a.level, flow: a.flow || 0 });
      case 'mute': providers.invalidate('volume'); return native.call('setMute', { muted: a.muted, flow: a.flow || 0 });
      case 'audioDevice': providers.invalidate('volume'); providers.invalidate('audioDevices'); providers.invalidate('audioSessions'); return native.call('setDefaultDevice', { id: a.id });
      case 'appVolume': providers.invalidate('audioSessions'); return native.call('setSession', { id: a.id, volume: a.volume ?? -1, mute: a.muted === undefined ? -1 : a.muted ? 1 : 0 });
      case 'brightness': providers.invalidate('brightness'); return native.call('setBrightness', { level: a.level }, 10000);
      case 'radio': providers.invalidate('radios'); return native.call('setRadio', { kind: a.kind, on: a.on });
      case 'emptyRecycle': {
        const w = BrowserWindow.fromWebContents(e.sender);
        const r = await dialog.showMessageBox(w, { type: 'warning', buttons: ['Empty Recycle Bin', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Empty Recycle Bin', message: 'Permanently delete all items in the Recycle Bin?', detail: 'This cannot be undone.' });
        if (r.response !== 0) return false;
        providers.invalidate('recycle'); await native.call('recycleEmpty'); return true;
      }
      case 'screenshot': return screenshot(a.mode, e.sender);
      case 'pickApp': {
        const r = await dialog.showOpenDialog({ title: 'Choose an app', properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }, { name: 'All files', extensions: ['*'] }] });
        return r.canceled ? null : r.filePaths[0];
      }
      case 'pickFolder': {
        const r = await dialog.showOpenDialog({ title: 'Choose a folder', properties: ['openDirectory'] });
        return r.canceled ? null : r.filePaths[0];
      }
      case 'lock': require('child_process').spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true }); return true;
      case 'quit': app.quit(); return true;
      case 'reload': for (const w of docks.values()) w.reload(); return true;
      default: throw new Error('unknown action ' + name);
    }
  });
}

async function screenshot(mode, sender) {
  if (mode === 'region') { await shell.openExternal('ms-screenclip:'); return { snip: true }; }
  const win = BrowserWindow.fromWebContents(sender);
  const display = screen.getDisplayMatching(win.getBounds());
  for (const w of docks.values()) w.hide();
  await new Promise((r) => setTimeout(r, 220));
  try {
    const size = { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    const dir = path.join(app.getPath('pictures'), 'Screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `PrismDock ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.png`);
    fs.writeFileSync(file, src.thumbnail.toPNG());
    clipboard.writeImage(src.thumbnail);
    return { file };
  } finally {
    for (const w of docks.values()) w.showInactive();
  }
}

// ---------------- protocol ----------------
function registerProtocol() {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/__media/')) {
      const name = u.pathname.slice(9);
      if (!/^cover-\d+\.img$/.test(name)) return new Response('', { status: 404 });
      return net.fetch(pathToFileURL(path.join(providers.mediaDir(), name)).toString());
    }
    if (u.pathname === '/__wallpaper') {
      if (!wallpaper || !wallpaper.path) return new Response('', { status: 404 });
      return net.fetch(pathToFileURL(wallpaper.path).toString());
    }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const base = rel.startsWith('assets/') ? path.join(ASSETS, '..') : RENDERER;
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------------- lifecycle ----------------
// keep running on a stray rejected promise (e.g. a network call nobody awaited); log it instead
process.on('unhandledRejection', (e) => console.warn('unhandled rejection:', e?.message || e));

app.on('second-instance', () => openSettings());
app.whenReady().then(async () => {
  store = new Store();
  taskbar.init(() => store.config);
  integrations.init(store);
  spotify.init(store);
  registerProtocol();
  registerIpc();
  refreshWallpaper(); // the docks start with a flat glass and pick the wallpaper up as soon as the helper has it
  createTray();
  if (!store.config.behavior.hideTaskbar && fs.existsSync(TB_FILE())) await restoreTaskbar(); // left over from a crash
  applyConfig(null);
  setInterval(refreshWallpaper, 30000);
  // monitors plugged in / removed / rescaled: one debounced relayout (Windows fires bursts of events)
  let relayoutT = null;
  const relayout = () => { clearTimeout(relayoutT); relayoutT = setTimeout(layoutDocks, 350); };
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
  screen.on('display-metrics-changed', relayout);
  // after sleep / unlock Explorer often re-creates or re-shows its taskbar
  for (const ev of ['resume', 'unlock-screen', 'user-did-become-active']) powerMonitor.on(ev, () => { relayout(); setTimeout(() => native.call('tick').catch(() => {}), 800); });
  if (process.argv.includes('--settings') || store.firstRun) openSettings();
  if (store.firstRun) store.saveConfig();
  if (process.env.PRISM_DEBUG) require('./debug').debugServer({ windows: () => ({ docks: [...docks.values()], settings: settingsWin }), openSettings });
});

app.on('window-all-closed', (e) => { if (!quitting) e.preventDefault?.(); });
let cleanedUp = false;
app.on('before-quit', async (e) => {
  quitting = true;
  if (cleanedUp) return;
  e.preventDefault();
  try { store.flush(); } catch { /* ignore */ }
  // give the Windows taskbar and the reserved screen space back before exiting
  const tasks = [...docks.values()].map((w) => appbar(w, false));
  tasks.push(restoreTaskbar());
  await Promise.all(tasks);
  cleanedUp = true;
  native.stop();
  app.quit();
});
