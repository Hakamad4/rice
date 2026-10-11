const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alertApi', {
  uiLanguage: ipcRenderer.sendSync('i18n:language'),
  onLanguage: (fn) => ipcRenderer.on('ui:language', (_e, language) => fn(language)),
  onData: (fn) => ipcRenderer.on('alert:data', (_e, payload) => fn(payload)),
  act: (action) => ipcRenderer.invoke('alert:action', action),
});
