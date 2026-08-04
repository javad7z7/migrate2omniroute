const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { runMigration } = require('./migrator');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#0f1115',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));

  if (process.env.NODE_ENV === 'dev') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC handlers ────────────────────────────────────────────

ipcMain.handle('pick-source-db', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select 9router data.sqlite',
    filters: [{ name: 'SQLite DB', extensions: ['sqlite', 'db'] }],
    properties: ['openFile'],
    defaultPath: getDefault9routerDir(),
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('pick-target-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select OmniRoute data directory (or output folder)',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getDefaultOmnirouteDir(),
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('run-migration', async (event, opts) => {
  const log = (msg) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('migration-log', msg);
    }
  };
  try {
    log(`▶ Starting migration from: ${opts.sourceDb}`);
    const result = await runMigration(opts, log);
    log('✓ Migration complete.');
    return { ok: true, result };
  } catch (err) {
    log(`✗ Error: ${err.message}`);
    return { ok: false, error: err.message, stack: err.stack };
  }
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  if (fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
    return true;
  }
  return false;
});

ipcMain.handle('show-in-folder', async (event, filePath) => {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('detect-9router', async () => {
  return detect9router();
});

ipcMain.handle('detect-omniroute', async () => {
  return detectOmniroute();
});

// ─── Helpers ─────────────────────────────────────────────────

function getDefault9routerDir() {
  const home = app.getPath('home');
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), '9router', 'db');
  }
  if (process.platform === 'darwin') {
    return path.join(home, '.9router', 'db');
  }
  return path.join(home, '.9router', 'db');
}

function getDefaultOmnirouteDir() {
  const home = app.getPath('home');
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'omniroute');
  }
  return path.join(home, '.omniroute');
}

function detect9router() {
  const home = app.getPath('home');
  const candidates = [
    path.join(home, '.9router', 'db', 'data.sqlite'),
    path.join(process.env.APPDATA || '', '9router', 'db', 'data.sqlite'),
    '/opt/9router/data/db/data.sqlite',
    path.join(home, 'Library', 'Application Support', '9router', 'db', 'data.sqlite'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return { found: true, path: p, size: fs.statSync(p).size };
      }
    } catch {}
  }
  return { found: false };
}

function detectOmniroute() {
  const home = app.getPath('home');
  const candidates = [
    path.join(home, '.omniroute'),
    path.join(process.env.APPDATA || '', 'omniroute'),
    path.join(home, 'Library', 'Application Support', 'omniroute'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return { found: true, path: p };
      }
    } catch {}
  }
  return { found: false };
}
