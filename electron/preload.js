const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, isolated APIs to the renderer window
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:version'),
  print: {
    status: () => ipcRenderer.invoke('print:status'),
    printReceipt: (payload) => ipcRenderer.invoke('print:print', payload),
    testPrint: () => ipcRenderer.invoke('print:test'),
    listPrinters: () => ipcRenderer.invoke('print:list-printers'),
    getSettings: () => ipcRenderer.invoke('print:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('print:save-settings', settings),
    openSettings: () => ipcRenderer.invoke('print:open-settings'),
  },
});
