const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('prism', {
  config: {
    get: () => ipcRenderer.invoke('cfg:get'),
    defaults: () => ipcRenderer.invoke('cfg:defaults'),
    patch: (p) => ipcRenderer.invoke('cfg:patch', p),
    replace: (c) => ipcRenderer.invoke('cfg:replace', c),
    reset: (section) => ipcRenderer.invoke('cfg:reset', section),
    layout: (action, args) => ipcRenderer.invoke('layout:action', action, args),
    export: () => ipcRenderer.invoke('cfg:export'),
    import: () => ipcRenderer.invoke('cfg:import'),
    onChange: on('config'),
  },
  data: {
    get: (k) => ipcRenderer.invoke('data:get', k),
    set: (k, v) => ipcRenderer.invoke('data:set', k, v),
    onChange: on('data'),
  },
  secrets: {
    set: (k, v) => ipcRenderer.invoke('secret:set', k, v),
    keys: () => ipcRenderer.invoke('secret:keys'),
  },
  sys: (name) => ipcRenderer.invoke('sys', name),
  onSysPush: on('sys:push'),
  onIntegrationsChanged: on('integ:changed'),
  icon: (p, size) => ipcRenderer.invoke('icon', p, size),
  windows: () => ipcRenderer.invoke('windows'),
  startApps: () => ipcRenderer.invoke('startApps'),
  recent: () => ipcRenderer.invoke('recent'),
  aiLocal: () => ipcRenderer.invoke('aiLocal'),
  screentime: () => ipcRenderer.invoke('screentime'),
  integration: (name, opts) => ipcRenderer.invoke('integration', name, opts),
  geocode: (q) => ipcRenderer.invoke('geocode', q),
  customJson: (url, ttl) => ipcRenderer.invoke('customJson', url, ttl),
  wallpaper: () => ipcRenderer.invoke('wallpaper'),
  onWallpaper: on('wallpaper'),
  appInfo: () => ipcRenderer.invoke('appInfo'),
  metrics: () => ipcRenderer.invoke('metrics'),
  act: (name, args) => ipcRenderer.invoke('act', name, args),
  dock: {
    ignore: (v) => ipcRenderer.send('dock:ignore', v),
    zone: (rect) => ipcRenderer.send('dock:zone', rect),
    cursor: () => ipcRenderer.invoke('dock:cursor'),
    focus: () => ipcRenderer.send('dock:focus'),
    blurSelf: () => ipcRenderer.send('dock:blurSelf'),
    onBlur: on('dock:blur'),
    onDisplay: on('dock:display'),
    onFullscreen: on('dock:fullscreen'),
    onEditor: on('dock:editor'),
    display: () => ipcRenderer.invoke('display:get'),
    list: () => ipcRenderer.invoke('displays:list'),
  },
  openSettings: (section) => ipcRenderer.send('settings:open', section),
  openEditor: (tab) => ipcRenderer.send('editor:open', tab),
  onSettingsSection: on('settings:section'),
});
