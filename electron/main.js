const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');
const { getBackupsDirectory, performDatabaseBackup, startDailyBackupTimer } = require('./backup');
const { createPrinterService } = require('./printing/printerService');
const { ALLOWED_ORIGINS } = require('./printing/constants');

let mainWindow = null;
let backendProcess = null;
let persistentDbFilePath = null;
let backupsDirectoryPath = null;
let dailyBackupTimer = null;
let printerService = null;
let printSettingsWindow = null;
const BACKEND_PORT = process.env.PORT || 3000;
const SERVER_URL = `http://127.0.0.1:${BACKEND_PORT}`;

// Enforce single instance lock for POS application
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/**
 * Ensures SQLite database is located in persistent app.getPath('userData')
 * Copies bundled template database on first launch if not already present.
 */
function setupPersistentDatabase() {
  const userDataPath = app.getPath('userData');
  const databaseDir = path.join(userDataPath, 'database');

  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }

  const targetDbPath = path.join(databaseDir, 'dev.db');

  // Candidate paths where bundled database template might be located
  const candidateBundledDbPaths = [
    path.join(process.resourcesPath, 'prisma', 'dev.db'),
    path.join(process.resourcesPath, 'apps', 'backend', 'prisma', 'dev.db'),
    path.join(__dirname, '..', 'apps', 'backend', 'prisma', 'dev.db'),
    path.join(__dirname, 'prisma', 'dev.db'),
  ];

  let foundBundledDb = null;
  for (const candidate of candidateBundledDbPaths) {
    if (fs.existsSync(candidate)) {
      foundBundledDb = candidate;
      break;
    }
  }

  if (!fs.existsSync(targetDbPath)) {
    if (foundBundledDb) {
      try {
        fs.copyFileSync(foundBundledDb, targetDbPath);
        console.log(`[Electron] Initialized persistent database in userData: ${targetDbPath}`);
      } catch (err) {
        console.error('[Electron] Failed to copy bundled database template:', err);
      }
    } else {
      console.warn('[Electron] No bundled database template found. Prisma will create empty database.');
    }
  } else {
    console.log(`[Electron] Using existing persistent database: ${targetDbPath}`);
  }

  persistentDbFilePath = targetDbPath;
  backupsDirectoryPath = getBackupsDirectory(userDataPath);

  // Format database path for SQLite Prisma URL
  const normalizedPath = targetDbPath.replace(/\\/g, '/');
  return `file:${normalizedPath}`;
}

/**
 * Resolves the backend entry point file across packaged and development environments.
 */
function resolveBackendEntry() {
  const candidatePaths = [
    path.join(__dirname, '..', 'apps', 'backend', 'dist', 'index.js'),
    path.join(process.resourcesPath, 'app', 'apps', 'backend', 'dist', 'index.js'),
    path.join(process.resourcesPath, 'apps', 'backend', 'dist', 'index.js'),
    path.join(__dirname, 'backend', 'index.js'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return path.join(__dirname, '..', 'apps', 'backend', 'dist', 'index.js');
}

/**
 * Resolves the frontend dist directory.
 */
function resolveFrontendDist() {
  const candidatePaths = [
    path.join(__dirname, '..', 'apps', 'frontend', 'dist'),
    path.join(process.resourcesPath, 'app', 'apps', 'frontend', 'dist'),
    path.join(process.resourcesPath, 'apps', 'frontend', 'dist'),
    path.join(process.resourcesPath, 'frontend', 'dist'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
      return p;
    }
  }

  return path.join(__dirname, '..', 'apps', 'frontend', 'dist');
}

/**
 * Spawns the Express backend as a hidden internal background process.
 */
function startBackendProcess(databaseUrl) {
  const backendScript = resolveBackendEntry();
  const frontendDistPath = resolveFrontendDist();

  console.log(`[Electron] Starting backend process from: ${backendScript}`);
  console.log(`[Electron] Frontend dist path: ${frontendDistPath}`);
  console.log(`[Electron] Database URL: ${databaseUrl}`);

  const env = {
    ...process.env,
    PORT: String(BACKEND_PORT),
    DATABASE_URL: databaseUrl,
    NODE_ENV: app.isPackaged ? 'production' : 'development',
    FRONTEND_DIST_PATH: frontendDistPath,
    FRONTEND_URL: SERVER_URL,
    ELECTRON_RUN_AS_NODE: '1',
  };

  // Use fork or spawn with windowsHide to avoid popping any terminal windows
  backendProcess = fork(backendScript, [], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  if (backendProcess.stdout) {
    backendProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[Backend stdout] ${msg}`);
    });
  }

  if (backendProcess.stderr) {
    backendProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[Backend stderr] ${msg}`);
    });
  }

  backendProcess.on('error', (err) => {
    console.error('[Electron] Backend process encountered an error:', err);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Backend process exited with code ${code} and signal ${signal}`);
  });
}

/**
 * Polls the backend health check endpoint until it responds with HTTP 200.
 */
function waitForBackendReady(url, maxWaitMs = 30000, intervalMs = 200) {
  const startTime = Date.now();
  const healthUrl = `${url}/health`;

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(healthUrl, (res) => {
        if (res.statusCode === 200) {
          console.log(`[Electron] Backend health check passed at ${healthUrl}`);
          resolve(true);
        } else {
          retry();
        }
      });

      req.on('error', () => {
        retry();
      });

      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startTime > maxWaitMs) {
        reject(new Error(`Backend failed to become ready within ${maxWaitMs / 1000} seconds.`));
      } else {
        setTimeout(check, intervalMs);
      }
    };

    check();
  });
}

/**
 * Creates the primary application BrowserWindow without browser chrome or URL bars.
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Restaurant POS & Management System',
    show: false, // Show only once backend is ready and content finishes loading
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // Remove native window menu bar
  Menu.setApplicationMenu(null);

  // Load the unified local server URL
  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Opens the shared print-helper settings UI inside the offline POS. It uses the
 * same HTML/preload and print service as the standalone tray helper.
 */
function openPrintSettingsWindow() {
  if (printSettingsWindow && !printSettingsWindow.isDestroyed()) {
    if (printSettingsWindow.isMinimized()) printSettingsWindow.restore();
    printSettingsWindow.show();
    printSettingsWindow.focus();
    return;
  }

  printSettingsWindow = new BrowserWindow({
    width: 720,
    height: 780,
    minWidth: 620,
    minHeight: 620,
    title: 'Printer Settings',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'print-helper', 'settings-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  printSettingsWindow.loadFile(path.join(__dirname, 'print-helper', 'settings.html'));
  printSettingsWindow.once('ready-to-show', () => {
    printSettingsWindow.show();
    printSettingsWindow.focus();
  });
  printSettingsWindow.on('closed', () => {
    printSettingsWindow = null;
  });
}

/**
 * Cleanly stops the background backend process.
 */
function stopBackendProcess() {
  if (backendProcess && !backendProcess.killed) {
    console.log('[Electron] Terminating backend process cleanly...');
    try {
      backendProcess.send('shutdown');
    } catch (e) {
      // IPC might not be available if child died
    }

    try {
      backendProcess.kill('SIGTERM');
    } catch (e) {
      // Ignore
    }

    // Force kill if it doesn't exit after 2 seconds
    setTimeout(() => {
      try {
        if (backendProcess && !backendProcess.killed) {
          backendProcess.kill('SIGKILL');
        }
      } catch (e) {}
    }, 2000);
  }
}

// IPC handlers for app info and backups
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:backup:trigger', () => {
  if (persistentDbFilePath && backupsDirectoryPath) {
    return performDatabaseBackup(persistentDbFilePath, backupsDirectoryPath, 'manual ipc trigger');
  }
  return false;
});

// Direct ESC/POS printing for the offline Electron POS. This uses the same
// shared print service as the standalone Windows print helper.
ipcMain.handle('print:status', () => {
  if (!printerService) {
    return { ok: false, app: 'restaurant-pos-print-helper', configured: false };
  }
  return printerService.getStatus();
});

ipcMain.handle('print:print', async (_event, payload) => {
  if (!printerService) {
    return { ok: false, error: 'The desktop print service is not ready.' };
  }
  try {
    return await printerService.print(payload || {});
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('print:test', async () => {
  if (!printerService) {
    return { ok: false, error: 'The desktop print service is not ready.' };
  }
  try {
    return await printerService.testPrint();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('print:list-printers', async () => {
  if (!printerService) return [];
  try {
    return await printerService.getPrinters();
  } catch (error) {
    console.error('[Electron] Could not list printers:', error.message);
    return [];
  }
});

ipcMain.handle('print:get-settings', () => {
  return printerService ? printerService.getSettings() : {};
});

ipcMain.handle('print:save-settings', (_event, nextSettings) => {
  if (!printerService) {
    return { error: 'The desktop print service is not ready.' };
  }
  try {
    return printerService.updateSettings(nextSettings || {});
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('print:open-settings', () => {
  openPrintSettingsWindow();
  return true;
});

// The shared settings window uses these channel names in both apps.
ipcMain.handle('print-helper:get-state', async () => {
  let printers = [];
  let printerError = null;

  if (printerService) {
    try {
      printers = await printerService.getPrinters();
    } catch (error) {
      printerError = error.message;
    }
  }

  return {
    settings: printerService ? printerService.getSettings() : {},
    status: printerService
      ? printerService.getStatus()
      : { ok: false, configured: false, printerName: '' },
    printers,
    printerError,
    allowedOrigins: ALLOWED_ORIGINS,
    port: null,
    transport: 'ipc',
  };
});

ipcMain.handle('print-helper:save-settings', (_event, nextSettings) => {
  if (!printerService) {
    return { error: 'The desktop print service is not ready.' };
  }
  const settings = printerService.updateSettings(nextSettings || {});
  return { settings, status: printerService.getStatus() };
});

ipcMain.handle('print-helper:test-print', async () => {
  if (!printerService) {
    return { ok: false, error: 'The desktop print service is not ready.' };
  }
  try {
    return await printerService.testPrint();
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('print-helper:list-printers', async () => {
  if (!printerService) {
    return { ok: false, error: 'The desktop print service is not ready.', printers: [] };
  }
  try {
    return { ok: true, printers: await printerService.getPrinters() };
  } catch (error) {
    return { ok: false, error: error.message, printers: [] };
  }
});

// Electron App Lifecycle
app.whenReady().then(async () => {
  try {
    const databaseUrl = setupPersistentDatabase();
    printerService = createPrinterService({ userDataPath: app.getPath('userData') });

    // Perform automated SQLite database backup on startup & schedule daily timer
    if (persistentDbFilePath && backupsDirectoryPath) {
      performDatabaseBackup(persistentDbFilePath, backupsDirectoryPath, 'startup');
      dailyBackupTimer = startDailyBackupTimer(persistentDbFilePath, backupsDirectoryPath);
    }

    startBackendProcess(databaseUrl);

    console.log('[Electron] Waiting for backend server to become ready...');
    await waitForBackendReady(SERVER_URL, 30000);

    createMainWindow();
  } catch (err) {
    console.error('[Electron] Failed to launch application:', err);
    dialog.showErrorBox(
      'Startup Error',
      `Failed to initialize the Restaurant POS backend server.\n\nDetails: ${err.message}`
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

let isShuttingDown = false;
function handleCleanShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (dailyBackupTimer) {
    clearInterval(dailyBackupTimer);
    dailyBackupTimer = null;
  }

  // Trigger backup automatically on clean app shutdown
  if (persistentDbFilePath && backupsDirectoryPath) {
    try {
      performDatabaseBackup(persistentDbFilePath, backupsDirectoryPath, 'clean shutdown');
    } catch (backupErr) {
      console.error('[Electron] Error during shutdown database backup:', backupErr);
    }
  }

  stopBackendProcess();
}

// App shutdown lifecycle
app.on('before-quit', () => {
  handleCleanShutdown();
});

app.on('window-all-closed', () => {
  handleCleanShutdown();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
