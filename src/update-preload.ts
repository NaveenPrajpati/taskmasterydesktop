// Preload for static/update.html (the update card)

import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('updateCard', {
  onState(callback: (state: unknown) => void) {
    ipcRenderer.on('update:state', (_event, state) => callback(state));
  },
});
