// Preload for static/picker.html (the screen-share picker)

import {contextBridge, ipcRenderer} from 'electron';

export interface PickerSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
}

contextBridge.exposeInMainWorld('picker', {
  onSources(callback: (sources: PickerSource[]) => void) {
    ipcRenderer.on('picker:sources', (_event, sources: PickerSource[]) => callback(sources));
  },
  choose(id: string | null) {
    ipcRenderer.send('picker:choose', id);
  },
});
