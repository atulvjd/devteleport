const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  utilityProcess,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
let running = null;
if (process.env.DEVTELEPORT_USER_DATA)
  app.setPath("userData", process.env.DEVTELEPORT_USER_DATA);
let win;
const cli = app.isPackaged
  ? path.join(process.resourcesPath, "backend/entry.cjs")
  : path.join(__dirname, "../../dist/backend/entry.cjs");
app.whenReady().then(() => {
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
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, "index.html"));
});
app.on("window-all-closed", () => app.quit());
ipcMain.handle("choose", async (event, kind) => {
  if (event.sender !== win.webContents) throw new Error("Invalid sender");
  const result = await dialog.showOpenDialog(win, {
    properties: [kind === "directory" ? "openDirectory" : "openFile"],
    ...(kind === "snapshot"
      ? { filters: [{ name: "DevTeleport snapshot", extensions: ["dtp"] }] }
      : {}),
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("operation", async (event, input) => {
  if (event.sender !== win.webContents) throw new Error("Invalid sender");
  if (
    !input ||
    ![
      "inspect",
      "capture",
      "restore",
      "verify",
      "history",
      "services",
    ].includes(input.action)
  )
    throw new Error("Unsupported action");
  if (typeof input.source !== "string" || !path.isAbsolute(input.source))
    throw new Error("Choose an absolute workspace or snapshot path");
  if (running) throw new Error("An operation is already running.");
  const args = [input.action];
  if(input.action==="capture")args.push("--format","2");
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
  } else {
    args.push(input.source);
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
      PATH: [...directories, process.env.PATH || "/usr/bin:/bin"].join(
        path.delimiter,
      ),
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
    child.cancel = () => {
      cancelled = true;
      child.kill();
    };
    win.webContents.send("progress", {
      phase: "Running",
      action: input.action,
    });
    const timer = setTimeout(() => child.cancel(), 180000);
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
            win.webContents.send("progress", {
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
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("Invalid backend response"));
      }
    });
  });
});
ipcMain.handle("cancel", (event) => {
  if (event.sender !== win.webContents) throw new Error("Invalid sender");
  running?.cancel();
  return Boolean(running);
});
ipcMain.handle("settings", async (event, value) => {
  if (event.sender !== win.webContents) throw new Error("Invalid sender");
  const file = path.join(app.getPath("userData"), "workspace-settings.json");
  if (value === undefined) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT")
        return {
          toolDirectories: [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/homebrew/opt/postgresql@15/bin",
            "/usr/local/opt/postgresql@15/bin",
          ].join("\n"),
        };
      throw error;
    }
  }
  const clean = {};
  for (const key of ["source", "output", "name", "target", "toolDirectories"])
    if (typeof value[key] === "string" && value[key].length < 4096)
      clean[key] = value[key];
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify(clean), { mode: 0o600 });
  await fs.rename(file + ".tmp", file);
  return clean;
});
app.on("before-quit", () => running?.cancel());
