'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
} = require('electron');
const path = require('path');
const { createPrintServer } = require('../printing/printServer');
const { DEFAULT_PORT, ALLOWED_ORIGINS } = require('../printing/constants');

let tray = null;
let settingsWindow = null;
let printServer = null;
let isQuitting = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openSettingsWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.restaurantpos.printhelper');
    Menu.setApplicationMenu(null);

    printServer = createPrintServer({
      userDataPath: app.getPath('userData'),
      port: DEFAULT_PORT,
    });

    registerIpcHandlers();

    try {
      await printServer.start();
    } catch (error) {
      console.error('[Print Helper] Failed to start HTTP server:', error);
      dialog.showErrorBox(
        'Print helper could not start',
        `The local print service could not listen on 127.0.0.1:${DEFAULT_PORT}.\n\n` +
          `${error.message}\n\nClose any other copy of the print helper and try again.`
      );
    }

    createTray();
    updateTrayMenu();

    const settings = printServer.service.getSettings();
    if (!settings.printerName) {
      openSettingsWindow();
    }
  });

  app.on('activate', () => {
    openSettingsWindow();
  });

  // This is a tray app: closing the settings window must not quit it.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    if (isQuitting) return;
    isQuitting = true;
    if (printServer) {
      printServer.stop().catch(() => {});
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'resources', 'tray.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('Restaurant POS Print Helper');
  tray.on('double-click', () => openSettingsWindow());
}

function updateTrayMenu() {
  if (!tray || !printServer) return;

  const status = printServer.getStatus();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Restaurant POS Print Helper', enabled: false },
      {
        label: status.printerName ? `Printer: ${status.printerName}` : 'Printer: not configured',
        enabled: false,
      },
      {
        label: status.configured
          ? `Listening on 127.0.0.1:${printServer.getPort()}`
          : 'Configure a printer to enable printing',
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Open Settings…', click: () => openSettingsWindow() },
      {
        label: 'Test Print',
        click: async () => {
          try {
            const result = await printServer.service.testPrint();
            dialog.showMessageBox({
              type: 'info',
              title: 'Test print sent',
              message: result.message,
            });
          } catch (error) {
            dialog.showErrorBox('Test print failed', error.message);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        },
      },
    ])
  );
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 780,
    minWidth: 620,
    minHeight: 620,
    title: 'Restaurant POS Print Helper',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    settingsWindow.focus();
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('print-helper:get-state', async () => {
    let printers = [];
    let printerError = null;

    try {
      printers = await printServer.service.getPrinters();
    } catch (error) {
      printerError = error.message;
    }

    return {
      settings: printServer.service.getSettings(),
      status: printServer.getStatus(),
      printers,
      printerError,
      allowedOrigins: ALLOWED_ORIGINS,
      port: printServer.getPort(),
      transport: 'http',
    };
  });

  ipcMain.handle('print-helper:save-settings', (_event, nextSettings) => {
    const settings = printServer.service.updateSettings(nextSettings || {});
    updateTrayMenu();
    return {
      settings,
      status: printServer.getStatus(),
    };
  });

  ipcMain.handle('print-helper:test-print', async () => {
    try {
      return await printServer.service.testPrint();
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('print-helper:list-printers', async () => {
    try {
      return { ok: true, printers: await printServer.service.getPrinters() };
    } catch (error) {
      return { ok: false, error: error.message, printers: [] };
    }
  });
}
