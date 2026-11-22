const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;

const DEV_URL = process.env.NEXUS_DEV_URL;
const PROD_PORT = process.env.NEXUS_PORT || '4310';

function waitForServer(url, retries = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // retry
      }
      if (attempts >= retries) {
        return reject(new Error(`Server did not respond at ${url}`));
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function isServerHealthy(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function startEmbeddedServerIfNeeded() {
  if (DEV_URL) return;

  const healthUrl = `http://127.0.0.1:${PROD_PORT}/api/health`;
  if (await isServerHealthy(healthUrl)) return;

  const projectRoot = path.join(__dirname, '..');
  const serverEntry = path.join(projectRoot, 'dist-server', 'server', 'index.js');

  const env = {
    ...process.env,
    NEXUS_PORT: PROD_PORT,
    NEXUS_SERVE_STATIC: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  // On Windows/macOS/Linux, try system Node.js first (true console runtime, fast boot).
  // Fall back to process.execPath with ELECTRON_RUN_AS_NODE: '1' if standalone node is missing.
  let spawned = false;
  try {
    const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
    serverProcess = spawn(nodeBin, [serverEntry], {
      cwd: projectRoot,
      env,
      stdio: 'pipe',
    });
    serverProcess.on('error', () => {
      spawned = false;
    });
    if (serverProcess.pid) {
      spawned = true;
    }
  } catch {
    spawned = false;
  }

  if (!spawned || !serverProcess || !serverProcess.pid) {
    serverProcess = spawn(process.execPath, [serverEntry], {
      cwd: projectRoot,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: 'pipe',
    });
  }

  serverProcess.stdout?.on('data', (d) => process.stdout.write(d));
  serverProcess.stderr?.on('data', (d) => process.stderr.write(d));

  await waitForServer(healthUrl, 60);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1060,
    minHeight: 680,
    backgroundColor: '#0B0E17',
    title: 'Nexus Agent OS',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0B0E17',
      symbolColor: '#94A3B8',
      height: 44,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const targetUrl = DEV_URL || `http://127.0.0.1:${PROD_PORT}`;
  mainWindow.loadURL(targetUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('nexus:pick-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('nexus:open-external', async (_event, targetUrl) => {
  if (typeof targetUrl === 'string' && /^https?:\/\//i.test(targetUrl)) {
    await shell.openExternal(targetUrl);
    return true;
  }
  return false;
});

ipcMain.handle('nexus:open-folder', async (_event, folderPath) => {
  if (typeof folderPath === 'string' && folderPath.trim()) {
    const err = await shell.openPath(folderPath.trim());
    return !err;
  }
  return false;
});

ipcMain.handle('nexus:set-opacity', async (_event, value) => {
  if (!mainWindow || typeof value !== 'number' || Number.isNaN(value)) return false;
  const clamped = Math.min(1, Math.max(0.72, value));
  mainWindow.setOpacity(clamped);
  return true;
});

ipcMain.handle('nexus:set-titlebar-theme', async (_event, opts) => {
  if (!mainWindow || !opts || typeof mainWindow.setTitleBarOverlay !== 'function') return false;
  try {
    mainWindow.setTitleBarOverlay({
      color: typeof opts.color === 'string' ? opts.color : '#0B0E17',
      symbolColor: typeof opts.symbolColor === 'string' ? opts.symbolColor : '#94A3B8',
      height: 44,
    });
    return true;
  } catch {
    return false;
  }
});

app.whenReady().then(async () => {
  try {
    await startEmbeddedServerIfNeeded();
    createWindow();
  } catch (err) {
    console.error('Failed to launch Nexus Agent OS:', err);
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    app.quit();
  }
});
