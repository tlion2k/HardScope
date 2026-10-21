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
  exportReport: (html) => ipcRenderer.invoke('export', html),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
