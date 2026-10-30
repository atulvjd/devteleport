const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  utilityProcess,
  Menu,
  nativeTheme,
  shell,
  Notification,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const applicationRoot = app.isPackaged
  ? app.getAppPath()
  : path.join(__dirname, "../..");
const applicationVersion = require(
  path.join(applicationRoot, "package.json"),
).version;
let running = null;
if (process.env.DEVTELEPORT_USER_DATA)
  app.setPath("userData", process.env.DEVTELEPORT_USER_DATA);
let win;
let creatingWindow = false,
  pendingSnapshot = null;
const { pathToFileURL } = require("node:url");
const backendRoot = app.isPackaged
  ? path.join(process.resourcesPath, "backend")
  : path.join(__dirname, "../../dist/backend");
let discoveredDirectories = [];
const platformModule = () =>
  import(
    pathToFileURL(path.join(backendRoot, "packages/core/platform.js")).href
  );

const cli = app.isPackaged
  ? path.join(process.resourcesPath, "backend/entry.cjs")
  : path.join(__dirname, "../../dist/backend/entry.cjs");
async function createWindow() {
  if (creatingWindow) return;
  creatingWindow = true;
  try {
    discoveredDirectories = await (await platformModule()).searchDirectories();
    win = new BrowserWindow({
      width: 1140,
      height: 820,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    app.setName("DevTeleport");
    if (app.isPackaged && !process.env.DEVTELEPORT_USER_DATA)
      app.setAsDefaultProtocolClient("devteleport");
    const route = (view) => sendToWindow("navigate", view);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "DevTeleport",
          submenu: [
            { label: "About DevTeleport", click: () => route("about") },
            { type: "separator" },
            {
              label: "Settings…",
              accelerator: "CmdOrCtrl+,",
              click: () => route("settings"),
            },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "File",
          submenu: [
            {
              label: "Capture Workspace…",
              accelerator: "CmdOrCtrl+N",
              click: () => route("capture"),
            },
            {
              label: "Restore Snapshot…",
              accelerator: "CmdOrCtrl+O",
              click: () => route("restore"),
            },
            {
              label: "Snapshot Library",
              accelerator: "CmdOrCtrl+L",
              click: () => route("library"),
            },
            { type: "separator" },
            {
              label: "Transfer…",
              accelerator: "CmdOrCtrl+Shift+T",
              click: () => route("transfer"),
            },
            { role: "close" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Window",
          submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
        },
        {
          label: "Help",
          submenu: [
            {
              label: "Documentation",
              click: () =>
                shell.openExternal(
                  "https://github.com/atulvjd/devteleport#readme",
                ),
            },
            { label: "Privacy and limitations", click: () => route("about") },
          ],
        },
      ]),
    );
    win.on("close", () => {
      running?.cancel();
      try {
        const sync = require("node:fs"),
          file = path.join(app.getPath("userData"), "window.json");
        sync.mkdirSync(path.dirname(file), { recursive: true });
        sync.writeFileSync(file, JSON.stringify(win.getBounds()), {
          mode: 0o600,
        });
      } catch {}
    });
    try {
      const bounds = JSON.parse(
        await fs.readFile(
          path.join(app.getPath("userData"), "window.json"),
          "utf8",
        ),
      );
      if (
        [bounds.x, bounds.y, bounds.width, bounds.height].every(
          Number.isFinite,
        ) &&
        bounds.width >= 800 &&
        bounds.height >= 600
      ) {
        const screen = require("electron").screen;
        if (
          screen
            .getAllDisplays()
            .some(
              (d) =>
                bounds.x < d.bounds.x + d.bounds.width &&
                bounds.x + bounds.width > d.bounds.x &&
                bounds.y < d.bounds.y + d.bounds.height &&
                bounds.y + bounds.height > d.bounds.y,
            )
        )
          win.setBounds(bounds);
      }
    } catch {}
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.once("did-finish-load", () => {
      if (pendingSnapshot) {
        sendToWindow("open-snapshot", pendingSnapshot);
        pendingSnapshot = null;
      }
    });
    win.loadFile(path.join(__dirname, "index.html"));
  } finally {
    creatingWindow = false;
  }
}
app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
ipcMain.handle("choose", async (event, kind) => {
  sender(event);
  const result = await dialog.showOpenDialog(win, {
    properties: [kind === "directory" ? "openDirectory" : "openFile"],
    ...(kind === "snapshot"
      ? { filters: [{ name: "DevTeleport snapshot", extensions: ["dtp"] }] }
      : {}),
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("operation", async (event, input) => {
  sender(event);
  if (
    !input ||
    ![
      "inspect",
      "capture",
      "restore",
      "verify",
      "history",
      "services",
      "snapshot-info",
      "send",
      "receive",
      "pairing-info",
      "diagnostics",
      "recover",
    ].includes(input.action)
  )
    throw new Error("Unsupported action");
  if (
    !["receive", "diagnostics", "pairing-info"].includes(input.action) &&
    (typeof input.source !== "string" || !path.isAbsolute(input.source))
  )
    throw new Error("Choose an absolute workspace or snapshot path");
  if (running) throw new Error("An operation is already running.");
  const args = [input.action];
  if (input.action === "capture") args.push("--format", "2");
  if (input.action === "capture") {
    args.push(
      "--root",
      input.source,
      "--name",
      input.name,
      "--output",
      input.output,
    );
    if (input.dryRun) args.push("--dry-run");
    if (input.includeDb) args.push("--include-db");
    if (input.includeVolumes) args.push("--include-volumes");
    for (const prefix of (input.exclusions || "").split("\n").filter(Boolean))
      args.push("--exclude", prefix);
  } else if (input.action === "receive") {
    if (!input.approveReceive)
      throw new Error("Explicit receiver approval is required");
    if (!path.isAbsolute(input.target) || !path.isAbsolute(input.pairingOutput))
      throw new Error("Select absolute receiver and pairing paths");
    args.push(
      "--target",
      input.target,
      "--pairing-output",
      input.pairingOutput,
      "--approve-receive",
      "--bind",
      input.bind || "127.0.0.1",
    );
    if (input.advertise) args.push("--advertise", input.advertise);
    if (input.resume) args.push("--resume");
  } else if (input.action === "diagnostics") {
  } else if (input.action === "pairing-info") {
    args.push("--pairing", input.pairing);
  } else {
    args.push(input.source);
    if (input.action === "send") {
      if (!input.approvePeer)
        throw new Error(
          "Review and approve the receiving device fingerprint first",
        );
      args.push("--pairing", input.pairing, "--approve-peer");
    }
    if (input.action === "restore") {
      if (!path.isAbsolute(input.target))
        throw new Error("Use an absolute destination path");
      args.push("--target", input.target);
      if (input.dryRun) args.push("--dry-run");
      if (input.restoreDb || input.restoreVolumes) {
        if (
          typeof input.dbConfig !== "string" ||
          !path.isAbsolute(input.dbConfig)
        )
          throw new Error("Select a trusted external destination mapping");
        args.push("--db-config", input.dbConfig);
      }
      if (input.trustedPublicKey)
        args.push("--verify-key", input.trustedPublicKey);
      if (input.restoreDb) args.push("--restore-db", "--approve-db");
      if (input.restoreVolumes)
        args.push("--restore-volumes", "--approve-volumes");
      if (input.install) args.push("--install", "--approve-execution");
    }
  }
  return new Promise((resolve, reject) => {
    const directories = (input.toolDirectories || "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (directories.some((value) => !path.isAbsolute(value)))
      throw new Error("Tool directories must be absolute paths, one per line.");
    const env = {
      ...process.env,
      DEVTELEPORT_PASSWORD: input.password || "",
      DEVTELEPORT_PROGRESS: "1",
      PATH: [
        ...directories,
        ...discoveredDirectories,
        process.env.PATH || "/usr/bin:/bin",
      ].join(path.delimiter),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    const child = utilityProcess.fork(cli, args, {
      env,
      stdio: "pipe",
      serviceName: "DevTeleport workspace engine",
    });
    running = child;
    let stdout = "",
      stderr = "",
      cancelled = false;
    const toolGroups = new Set();
    child.on("message", (message) => {
      if (
        !message ||
        !Number.isSafeInteger(message.pid) ||
        message.pid <= 0 ||
        message.pid === process.pid
      )
        return;
      if (message.type === "tool-start") toolGroups.add(message.pid);
      if (message.type === "tool-exit") toolGroups.delete(message.pid);
    });
    child.cancel = () => {
      cancelled = true;
      for (const pid of toolGroups)
        try {
          process.kill(-pid, "SIGTERM");
        } catch {}
      child.kill();
    };
    sendToWindow("progress", {
      phase: "Running",
      action: input.action,
    });
    const timer = setTimeout(
      () => child.cancel(),
      ["send", "receive", "capture", "restore"].includes(input.action)
        ? 3600000
        : 180000,
    );
    child.stdout.on("data", (data) => {
      stdout += data;
      if (stdout.length > 24 * 1024 * 1024) child.cancel();
    });
    let progressBuffer = "";
    child.stderr.on("data", (data) => {
      progressBuffer += data.toString();
      const lines = progressBuffer.split("\n");
      progressBuffer = lines.pop();
      for (const line of lines)
        if (line.startsWith("DTP_PROGRESS:")) {
          try {
            sendToWindow("progress", {
              action: input.action,
              ...JSON.parse(line.slice(13)),
            });
          } catch {}
        }
      stderr += data;
      if (stderr.length > 24 * 1024 * 1024) child.cancel();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      running = null;
      if (cancelled)
        return reject(
          new Error(
            "Operation cancelled. Review any incomplete new output before retrying; existing data was not overwritten.",
          ),
        );
      if (code !== 0)
        return reject(
          new Error(
            stderr
              .split("\n")
              .filter((s) => s.startsWith("DevTeleport:"))
              .join("\n") ||
              stderr.slice(-2000) ||
              "Workspace engine failed. Review paths, permissions and diagnostics.",
          ),
        );
      try {
        const result = JSON.parse(stdout);
        if (input.action === "history")
          for (const item of result) libraryPaths.add(item.file);
        if (
          !input.dryRun &&
          ["inspect", "capture", "restore", "receive"].includes(input.action)
        )
          awaitSummary(input, result);
        resolve(result);
      } catch {
        reject(new Error("Invalid backend response"));
      }
    });
  });
});
ipcMain.handle("cancel", (event) => {
  sender(event);
  running?.cancel();
  return Boolean(running);
});
ipcMain.handle("settings", async (event, value) => {
  sender(event);
  const file = path.join(app.getPath("userData"), "workspace-settings.json");
  if (value === undefined) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT")
        return {
          toolDirectories: discoveredDirectories.join("\n"),
        };
      throw error;
    }
  }
  const clean = {};
  for (const key of [
    "source",
    "output",
    "name",
    "target",
    "toolDirectories",
    "theme",
    "exclusions",
    "trustedPublicKey",
    "updateManifestUrl",
    "updateSignatureUrl",
    "updatePublicKey",
  ])
    if (typeof value[key] === "string" && value[key].length < 4096)
      clean[key] = value[key];
  for (const key of ["notifications", "onboardingComplete", "startAtLogin"])
    if (typeof value[key] === "boolean") clean[key] = value[key];
  if (clean.theme && ["system", "dark", "light"].includes(clean.theme))
    nativeTheme.themeSource = clean.theme;
  if (
    typeof clean.startAtLogin === "boolean" &&
    !process.env.DEVTELEPORT_USER_DATA
  )
    app.setLoginItemSettings({ openAtLogin: clean.startAtLogin });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify(clean), { mode: 0o600 });
  await fs.rename(file + ".tmp", file);
  return clean;
});
app.on("before-quit", () => running?.cancel());

const libraryPaths = new Set();
async function localData() {
  try {
    return JSON.parse(
      await fs.readFile(
        path.join(app.getPath("userData"), "activity.json"),
        "utf8",
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT")
      return { workspaces: [], snapshots: [], labels: {} };
    throw error;
  }
}
let dataWrites = Promise.resolve();
function updateData(change) {
  dataWrites = dataWrites
    .catch(() => {})
    .then(async () => {
      const data = await localData();
      change(data);
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      const file = path.join(app.getPath("userData"), "activity.json"),
        temp = file + ".tmp";
      await fs.writeFile(temp, JSON.stringify(data), { mode: 0o600 });
      await fs.rename(temp, file);
    });
  return dataWrites;
}
async function desktopData() {
  await dataWrites;
  const data = await localData(),
    storage = await fs.statfs(app.getPath("home"));
  return {
    ...data,
    version: applicationVersion,
    architecture: process.arch,
    electron: process.versions.electron,
    platform: process.platform,
    storage: { available: Number(storage.bavail) * Number(storage.bsize) },
    updates: {
      state: "disabled",
      reason:
        "Production installation requires signed/notarized artifacts and an authenticated release feed. No automatic executable replacement is enabled.",
    },
  };
}
function sender(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents)
    throw new Error("Invalid sender");
}
ipcMain.handle("desktop-data", async (event) => {
  sender(event);
  return desktopData();
});
ipcMain.handle("library-action", async (event, input) => {
  sender(event);
  if (
    !libraryPaths.has(input.file) ||
    !input.file.endsWith(".dtp") ||
    !(await fs.lstat(input.file)).isFile()
  )
    throw new Error(
      "Select a regular snapshot from the current library first.",
    );
  if (input.action === "label") {
    if (
      typeof input.label !== "string" ||
      input.label.length > 100 ||
      /[\x00-\x1f]/.test(input.label)
    )
      throw new Error("Invalid display label");
    await updateData((data) => {
      data.labels ??= {};
      data.labels[input.file] = input.label;
    });
    return { label: input.label };
  }
  if (input.action === "delete") {
    const choice = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Cancel", "Move to Trash"],
      defaultId: 0,
      cancelId: 0,
      message: "Move this encrypted snapshot to the Trash?",
      detail: input.file,
    });
    if (choice.response !== 1) return { cancelled: true };
    await shell.trashItem(input.file);
    libraryPaths.delete(input.file);
    await updateData((data) => {
      data.snapshots = data.snapshots.filter(
        (item) => item.file !== input.file,
      );
      delete data.labels?.[input.file];
    });
    return { trashed: true };
  }
  if (input.action === "export") {
    const result = await dialog.showSaveDialog(win, {
      title: "Export encrypted snapshot",
      defaultPath: path.basename(input.file),
      filters: [{ name: "DevTeleport snapshot", extensions: ["dtp"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    const { constants } = require("node:fs");
    await fs.copyFile(input.file, result.filePath, constants.COPYFILE_EXCL);
    return { exported: result.filePath };
  }
  throw new Error("Unsupported library operation");
});
ipcMain.handle("save-path", async (event, input) => {
  sender(event);
  const result = await dialog.showSaveDialog(win, {
    title:
      input?.kind === "pairing"
        ? "Save protected pairing descriptor"
        : "Choose new snapshot destination",
    filters: [
      {
        name:
          input?.kind === "pairing"
            ? "Pairing descriptor"
            : "DevTeleport snapshot",
        extensions: [input?.kind === "pairing" ? "json" : "dtp"],
      },
    ],
  });
  return result.canceled ? null : result.filePath;
});
ipcMain.handle("open-project", async (event) => {
  sender(event);
  const data = await localData(),
    target = data.lastRestore?.target;
  if (!target || !(await fs.stat(target)).isDirectory())
    throw new Error("No successfully restored project is available");
  const system = await (await platformModule()).diagnostics();
  if (system.editors.length) {
    await require("node:util").promisify(
      require("node:child_process").execFile,
    )("/usr/bin/open", ["-a", system.editors[0], target]);
    return { opened: target, editor: system.editors[0] };
  }
  shell.showItemInFolder(target);
  return { revealed: target };
});
ipcMain.handle("export-diagnostics", async (event) => {
  sender(event);
  const data = await desktopData(),
    system = await (await platformModule()).diagnostics();
  const report = {
    createdAt: new Date().toISOString(),
    version: data.version,
    platform: data.platform,
    architecture: data.architecture,
    electron: data.electron,
    tools: system.tools.map(({ name, version, architecture, status }) => ({
      name,
      version,
      architecture,
      status,
    })),
    updates: data.updates,
    privacy:
      "No snapshot contents, paths, connection URLs, passphrases or pairing tokens included.",
  };
  const selected = await dialog.showSaveDialog(win, {
    title: "Export redacted diagnostics",
    defaultPath: "devteleport-diagnostics.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (selected.canceled) return { cancelled: true };
  await fs.writeFile(selected.filePath, JSON.stringify(report, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  return { exported: selected.filePath };
});
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url === "devteleport://open" || url === "devteleport://open/")
    win?.show();
});

function awaitSummary(input, result) {
  updateData((data) => {
    const timestamp = new Date().toISOString();
    if (input.action === "inspect") {
      data.workspaces = [
        {
          root: result.root,
          name: path.basename(result.root),
          lastUsed: timestamp,
        },
        ...data.workspaces.filter((w) => w.root !== result.root),
      ].slice(0, 12);
    }
    if (input.action === "capture") {
      data.lastCapture = {
        file: result.output,
        fileCount: result.fileCount,
        formatVersion: result.formatVersion ?? 1,
        completedAt: timestamp,
      };
      data.snapshots = [
        data.lastCapture,
        ...data.snapshots.filter((s) => s.file !== result.output),
      ].slice(0, 30);
    }
    if (input.action === "restore")
      data.lastRestore = {
        target: result.target,
        fileCount: result.fileCount,
        verified: result.verification?.ok === true,
        completedAt: timestamp,
      };
  }).catch(() => {});
}

function sendToWindow(channel, value) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
    win.webContents.send(channel, value);
}
ipcMain.handle("update-check", async (event) => {
  sender(event);
  const file = path.join(app.getPath("userData"), "workspace-settings.json");
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const updates = await import(
    pathToFileURL(path.join(backendRoot, "packages/core/updates.js")).href
  );
  return updates.checkSignedRelease({
    currentVersion: applicationVersion,
    manifestUrl: settings.updateManifestUrl,
    signatureUrl: settings.updateSignatureUrl,
    publicKeyPath: settings.updatePublicKey,
  });
});

ipcMain.handle("license", async (event) => {
  sender(event);
  return fs.readFile(path.join(applicationRoot, "LICENSE"), "utf8");
});

app.on("open-file", async (event, file) => {
  event.preventDefault();
  try {
    if (
      !path.isAbsolute(file) ||
      path.extname(file) !== ".dtp" ||
      !(await fs.lstat(file)).isFile()
    )
      return;
    pendingSnapshot = file;
    if (!win || win.isDestroyed()) {
      if (app.isReady()) await createWindow();
    } else {
      win.show();
      if (!win.webContents.isLoading()) {
        sendToWindow("open-snapshot", file);
        pendingSnapshot = null;
      }
    }
  } catch {}
});
