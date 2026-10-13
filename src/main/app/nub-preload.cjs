const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['nub:level', 'nub:state', 'nub:delta', 'nub:segment', 'nub:partial', 'nub:collapsed', 'nub:side', 'nub:hover', 'ui:language'];

contextBridge.exposeInMainWorld('nub', {
  uiLanguage: ipcRenderer.sendSync('i18n:language'),
  openMain: () => ipcRenderer.invoke('nub:open-main'),
  stop: () => ipcRenderer.invoke('nub:stop'),
  pause: () => ipcRenderer.invoke('nub:pause'),
  expand: () => ipcRenderer.invoke('nub:expand'),
  collapse: () => ipcRenderer.invoke('nub:collapse'),
  ask: (question) => ipcRenderer.invoke('nub:ask', question),
  cancel: () => ipcRenderer.invoke('nub:cancel'),
  dragEnd: () => ipcRenderer.invoke('nub:drag-end'),
  on: (channel, fn) => {
    if (!EVENTS.includes(channel)) throw new Error(`canal não permitido: ${channel}`);
    ipcRenderer.on(channel, (_e, payload) => fn(payload));
  },
});
