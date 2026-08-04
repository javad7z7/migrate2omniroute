const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickSourceDb: () => ipcRenderer.invoke('pick-source-db'),
  pickTargetDir: () => ipcRenderer.invoke('pick-target-dir'),
  runMigration: (opts) => ipcRenderer.invoke('run-migration', opts),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  detect9router: () => ipcRenderer.invoke('detect-9router'),
  detectOmniroute: () => ipcRenderer.invoke('detect-omniroute'),
  onLog: (cb) => {
    ipcRenderer.on('migration-log', (_e, msg) => cb(msg));
  },
});
