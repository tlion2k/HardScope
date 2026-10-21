const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { collect } = require('./collector');
const { LiveMonitor } = require('./monitor');
const profiles = require('./profiles');
const { analyze, liveBottleneck } = require('../analysis/engine');
const pkg = require('../../package.json');

let win;
let profile = null;
const monitor = new LiveMonitor();
const history = [];

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#070a12',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#c7d2fe', height: 42 },
    icon: path.join(__dirname, '../../build/icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Los errores vuelven como { error } para que la interfaz muestre el problema y ofrezca reintentar.
ipcMain.handle('scan', async (_e, settings) => {
  try {
    profile = await collect();
  } catch (err) {
    return { error: `No se pudo leer el hardware: ${err.message}` };
  }
  try {
    return { profile, report: analyze(profile, settings) };
  } catch (err) {
    return { error: `Se leyó el hardware, pero falló el análisis: ${err.message}` };
  }
});

ipcMain.handle('reanalyze', (_e, settings) => {
  if (!profile) return null;
  try {
    return { profile, report: analyze(profile, settings) };
  } catch (err) {
    return { error: `Falló el análisis: ${err.message}` };
  }
});

ipcMain.handle('monitor:start', () => {
  history.length = 0;
  const gpu = profile?.gpus?.slice().sort((a, b) => (b.vram || 0) - (a.vram || 0))[0];
  monitor.start((sample) => {
    history.push(sample);
    if (history.length > 10) history.shift();
    if (!win.isDestroyed()) win.webContents.send('monitor:sample', { sample, diagnosis: liveBottleneck(history.slice(-8)) });
  }, gpu?.vram);
});
ipcMain.handle('monitor:stop', () => monitor.stop());

ipcMain.handle('export', async (_e, html) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Guardar reporte',
    defaultPath: `HardScope-reporte-${stamp}.html`,
    filters: [{ name: 'Página web', extensions: ['html'] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, html, 'utf8');
  shell.showItemInFolder(filePath);
  return filePath;
});

ipcMain.handle('profiles:load', () => profiles.load());
ipcMain.handle('profiles:save', (_e, p) => profiles.save(p));
ipcMain.handle('profiles:remove', (_e, id) => profiles.remove(id));
ipcMain.handle('profiles:activate', (_e, id) => profiles.activate(id));
ipcMain.handle('brands', () => require('../data/brands.json'));

ipcMain.handle('app:info', () => ({ version: pkg.version, repo: pkg.hardscope?.repo || null }));

ipcMain.handle('update:check', async () => {
  const repo = pkg.hardscope?.repo;
  if (!repo) return { error: 'Repositorio no configurado' };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'HardScope' } });
    if (res.status === 404) return { current: pkg.version, latest: null };
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    return { current: pkg.version, latest, newer: isNewer(latest, pkg.version), url: rel.html_url };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('open-external', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

function isNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  monitor.stop();
  app.quit();
});
