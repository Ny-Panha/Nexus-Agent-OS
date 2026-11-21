const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusDesktop', {
  isDesktop: true,
  platform: process.platform,
  pickDirectory: () => ipcRenderer.invoke('nexus:pick-directory'),
  openExternal: (url) => ipcRenderer.invoke('nexus:open-external', url),
  openFolder: (folderPath) => ipcRenderer.invoke('nexus:open-folder', folderPath),
  setOpacity: (value) => ipcRenderer.invoke('nexus:set-opacity', value),
  setTitlebarTheme: (opts) => ipcRenderer.invoke('nexus:set-titlebar-theme', opts),
});
