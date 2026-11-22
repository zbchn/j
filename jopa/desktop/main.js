const { app, BrowserWindow, ipcMain, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const SERVER_URL = process.env.JESSENGER_SERVER_URL || 'https://mered.ro';

let mainWindow = null;

function getCacheDir() {
  const dir = path.join(app.getPath('userData'), 'jessenger-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFilesDir() {
  const dir = path.join(getCacheDir(), 'files');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFileIndexPath() {
  return path.join(getCacheDir(), 'file-index.json');
}

function loadFileIndex() {
  try {
    const p = getFileIndexPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch {}
  return {};
}

function saveFileIndex(idx) {
  try {
    fs.writeFileSync(getFileIndexPath(), JSON.stringify(idx, null, 2), 'utf8');
  } catch {}
}

function downloadToLocal(remoteUrl, destPath) {
  return new Promise((resolve, reject) => {
    const client = remoteUrl.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(destPath);
    client
      .get(remoteUrl, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          return downloadToLocal(response.headers.location, destPath).then(resolve).catch(reject);
        }
        if (response.statusCode && response.statusCode >= 400) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`HTTP ${response.statusCode}`));
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve(destPath));
        });
      })
      .on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 580,
    backgroundColor: '#0d0d12',
    title: 'Jessenger',
    icon: path.join(__dirname, 'renderer', 'favicon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  const rendererIndex = path.join(__dirname, 'renderer', 'index.html');
  if (fs.existsSync(rendererIndex)) {
    mainWindow.loadFile(rendererIndex);
  } else {
    mainWindow.loadURL(SERVER_URL);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // Протокол для доступа к локально закэшированным файлам в офлайн-режиме
  protocol.handle('jessenger-file', (request) => {
    const relName = decodeURIComponent(request.url.replace('jessenger-file://', ''));
    const fullPath = path.join(getFilesDir(), path.basename(relName));
    return net.fetch(`file://${fullPath}`);
  });

  ipcMain.handle('cache:save', (_event, key, data) => {
    try {
      const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(getCacheDir(), `${safeKey}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('cache:load', (_event, key) => {
    try {
      const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(getCacheDir(), `${safeKey}.json`);
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch {}
    return null;
  });

  ipcMain.handle('file:downloadAndCache', async (_event, remoteUrl, originalKey, suggestedName) => {
    try {
      const safeName = `${Date.now()}_${String(suggestedName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const destPath = path.join(getFilesDir(), safeName);
      await downloadToLocal(remoteUrl, destPath);
      const index = loadFileIndex();
      index[originalKey] = {
        localPath: destPath,
        fileName: suggestedName || safeName,
        protocolUrl: `jessenger-file://${encodeURIComponent(safeName)}`,
        savedAt: new Date().toISOString()
      };
      saveFileIndex(index);
      return index[originalKey];
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.on('file:getCachedUrlSync', (event, originalKey) => {
    const index = loadFileIndex();
    const entry = index[originalKey];
    if (entry && fs.existsSync(entry.localPath)) {
      event.returnValue = entry.protocolUrl;
    } else {
      event.returnValue = null;
    }
  });

  ipcMain.handle('file:listCached', () => {
    const index = loadFileIndex();
    return Object.entries(index)
      .filter(([, entry]) => fs.existsSync(entry.localPath))
      .map(([key, entry]) => ({ key, ...entry }));
  });

  ipcMain.on('app:openExternal', (_event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
