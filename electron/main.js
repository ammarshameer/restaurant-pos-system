const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');

let mainWindow = null;
let backendProcess = null;
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

// IPC handler for app version
ipcMain.handle('app:version', () => app.getVersion());

// Electron App Lifecycle
app.whenReady().then(async () => {
  try {
    const databaseUrl = setupPersistentDatabase();
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

// App shutdown lifecycle
app.on('before-quit', () => {
  stopBackendProcess();
});

app.on('window-all-closed', () => {
  stopBackendProcess();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
