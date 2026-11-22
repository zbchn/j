const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jessengerDesktop', {
  isDesktop: true,
  serverUrl: process.env.JESSENGER_SERVER_URL || 'https://mered.ro',
  saveOfflineData: (key, data) => ipcRenderer.invoke('cache:save', key, data),
  loadOfflineData: (key) => ipcRenderer.invoke('cache:load', key),
  downloadAndCacheFile: (remoteUrl, originalKey, suggestedName) =>
    ipcRenderer.invoke('file:downloadAndCache', remoteUrl, originalKey, suggestedName),
  getCachedFileUrlSync: (originalKey) => ipcRenderer.sendSync('file:getCachedUrlSync', originalKey),
  listCachedFiles: () => ipcRenderer.invoke('file:listCached'),
  openExternalUrl: (url) => ipcRenderer.send('app:openExternal', url)
});
