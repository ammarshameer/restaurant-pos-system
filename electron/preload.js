const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, isolated APIs to the renderer window
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:version'),
});
