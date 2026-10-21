const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hardscope', {
  scan: (settings) => ipcRenderer.invoke('scan', settings),
  reanalyze: (settings) => ipcRenderer.invoke('reanalyze', settings),
  startMonitor: () => ipcRenderer.invoke('monitor:start'),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  onSample: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('monitor:sample', handler);
    return () => ipcRenderer.removeListener('monitor:sample', handler);
  },
  loadProfiles: () => ipcRenderer.invoke('profiles:load'),
  saveProfile: (p) => ipcRenderer.invoke('profiles:save', p),
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  activateProfile: (id) => ipcRenderer.invoke('profiles:activate', id),
  brands: () => ipcRenderer.invoke('brands'),
  catalogInfo: () => ipcRenderer.invoke('catalog:info'),
  checkCatalog: () => ipcRenderer.invoke('catalog:check'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  exportReport: (html) => ipcRenderer.invoke('export', html),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
