const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("teleport", {
  settings: (value) => ipcRenderer.invoke("settings", value),
  cancel: () => ipcRenderer.invoke("cancel"),
  onProgress: (callback) =>
    ipcRenderer.on("progress", (_event, value) => callback(value)),
  choose: (kind) => ipcRenderer.invoke("choose", kind),
  operation: (input) => ipcRenderer.invoke("operation", input),
});
