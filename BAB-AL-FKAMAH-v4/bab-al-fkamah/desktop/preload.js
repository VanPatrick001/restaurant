// Expose à la page web un pont minimal et sûr : window.RestoDesktop
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('RestoDesktop', {
  print: () => ipcRenderer.send('imprimer'),
  reglages: () => ipcRenderer.send('reglages'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (c) => ipcRenderer.invoke('config:set', c)
});
