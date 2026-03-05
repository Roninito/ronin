const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roninClient", {
  platform: process.platform,
  onStatus: (callback) => {
    ipcRenderer.on("ronin-client-status", (_event, payload) => callback(payload));
  },
  action: (name) => ipcRenderer.invoke("ronin-client-action", name),
});
