const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("teleport", {
  data: () => ipcRenderer.invoke("desktop-data"),
  libraryAction: (input) => ipcRenderer.invoke("library-action", input),
  savePath: (input) => ipcRenderer.invoke("save-path", input),
  openProject: () => ipcRenderer.invoke("open-project"),
  exportDiagnostics: () => ipcRenderer.invoke("export-diagnostics"),
  onNavigate: (callback) =>
    ipcRenderer.on("navigate", (_event, view) => callback(view)),
  checkUpdates: () => ipcRenderer.invoke("update-check"),
  license: () => ipcRenderer.invoke("license"),
  onOpenSnapshot: (callback) =>
    ipcRenderer.on("open-snapshot", (_event, file) => callback(file)),
  settings: (value) => ipcRenderer.invoke("settings", value),
  cancel: () => ipcRenderer.invoke("cancel"),
  onProgress: (callback) =>
    ipcRenderer.on("progress", (_event, value) => callback(value)),
  choose: (kind) => ipcRenderer.invoke("choose", kind),
  operation: (input) => ipcRenderer.invoke("operation", input),
});
