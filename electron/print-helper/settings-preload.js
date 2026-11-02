'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printHelper', {
  getState: () => ipcRenderer.invoke('print-helper:get-state'),
  saveSettings: (settings) => ipcRenderer.invoke('print-helper:save-settings', settings),
  testPrint: () => ipcRenderer.invoke('print-helper:test-print'),
  listPrinters: () => ipcRenderer.invoke('print-helper:list-printers'),
});
