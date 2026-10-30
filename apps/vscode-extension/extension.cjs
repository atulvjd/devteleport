const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
function activate(context) {
  const ui = {};
  for (const method of [
    "showInputBox",
    "showOpenDialog",
    "showInformationMessage",
    "showWarningMessage",
  ])
    ui[method] = (...args) => vscode.window[method](...args);
  let dialogResponses = null,
    lastResult = null,
    lastError = null;
  if (context.extensionMode === vscode.ExtensionMode.Test)
    for (const method of [
      "showInputBox",
      "showOpenDialog",
      "showInformationMessage",
      "showWarningMessage",
    ]) {
      ui[method] = async (...args) => {
        if (!dialogResponses) return vscode.window[method](...args);
        if (!dialogResponses[method]?.length)
          throw new Error("Missing test response: " + method);
        return dialogResponses[method].shift();
      };
    }

  let activeChild = null,
    activeCancel = null;
  context.subscriptions.push({ dispose: () => activeCancel?.() });
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    20,
  );
  status.text = "$(package) DevTeleport";
  status.command = "devteleport.inspect";
  status.show();
  context.subscriptions.push(status);
  context.subscriptions.push(
    vscode.commands.registerCommand("devteleport.cancel", () => {
      activeCancel?.();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devteleport.openDesktop", () =>
      vscode.env.openExternal(vscode.Uri.parse("devteleport://open")),
    ),
  );
  const out = vscode.window.createOutputChannel("DevTeleport");
  context.subscriptions.push(out);
  let last = "No operation yet";
  const emitter = new vscode.EventEmitter();
  const tree = {
    onDidChangeTreeData: emitter.event,
    getTreeItem: (x) => x,
    getChildren: () => [
      new vscode.TreeItem(
        vscode.workspace.workspaceFolders?.[0]?.name || "No workspace",
      ),
      ...["inspect", "capture", "restore", "verify", "history"].map(
        (action) => {
          const i = new vscode.TreeItem(
            action[0].toUpperCase() + action.slice(1),
          );
          i.command = { command: `devteleport.${action}`, title: action };
          return i;
        },
      ),
      new vscode.TreeItem(last),
    ],
  };
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("devteleport.workspace", tree),
  );
  async function call(args, password, token) {
    const c = vscode.workspace.getConfiguration("devteleport");
    // Executable paths are machine/user settings. Never trust paths supplied by a snapshot's workspace settings.
    const setting = (key) => {
      const value = c.inspect(key);
      return value?.globalValue ?? value?.defaultValue;
    };
    let cli = setting("cliPath");
    if (!cli) {
      for (const directory of (process.env.PATH || "").split(path.delimiter)) {
        try {
          cli = await fs.realpath(path.join(directory, "devteleport"));
          break;
        } catch {}
      }
    }
    if (!path.isAbsolute(cli || ""))
      throw new Error(
        "Install DevTeleport on PATH or configure its absolute CLI path in user settings.",
      );
    const node = setting("nodePath") || "node";
    if (process.platform === "darwin" && process.arch === "arm64") {
      const resolved = path.isAbsolute(node)
        ? node
        : (
            await Promise.all(
              (process.env.PATH || "")
                .split(path.delimiter)
                .map(async (directory) => {
                  try {
                    const file = path.join(directory, node);
                    await fs.access(file, 1);
                    return file;
                  } catch {
                    return null;
                  }
                }),
            )
          ).find(Boolean);
      if (resolved) {
        const kind = await new Promise((resolve, reject) =>
          execFile(
            "/usr/bin/file",
            ["-b", "-L", resolved],
            { timeout: 5000 },
            (error, stdout) => (error ? reject(error) : resolve(stdout)),
          ),
        );
        if (kind.includes("x86_64") && !kind.includes("arm64"))
          throw new Error(
            "Configured CLI Node is Intel-only. Select a native Apple Silicon Node executable.",
          );
      }
    }
    return new Promise((resolve, reject) => {
      let cancelled = false;
      let cancellation;
      activeChild = execFile(
        node,
        [cli, ...args],
        {
          env: { ...process.env, DEVTELEPORT_PASSWORD: password || "" },
          maxBuffer: 24 * 1024 * 1024,
          timeout: 180000,
        },
        (err, stdout, stderr) => {
          activeChild = null;
          activeCancel = null;
          cancellation?.dispose();
          if (cancelled) {
            reject(
              new Error(
                "Operation cancelled. Inspect recovery evidence before retrying.",
              ),
            );
            return;
          }
          if (err) {
            reject(
              new Error(
                stderr
                  .split("\n")
                  .filter((x) => x.startsWith("DevTeleport:"))
                  .join("\n") ||
                  "CLI failed; check native Node and installed CLI settings.",
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("Invalid CLI response"));
          }
        },
      );
      activeCancel = () => {
        cancelled = true;
        activeChild?.kill("SIGTERM");
      };
      cancellation = token?.onCancellationRequested(() => activeCancel?.());
    });
  }
  for (const action of ["inspect", "capture", "restore", "verify", "history"])
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `devteleport.${action}`,
        async (directory) => {
          try {
            const root =
              typeof directory === "string"
                ? directory
                : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root && action !== "restore")
              throw new Error("Open a workspace folder first.");
            let args = [action],
              password;
            if (action === "capture") {
              if (!vscode.workspace.isTrusted)
                throw new Error("Trust the workspace before capture.");
              if (vscode.workspace.textDocuments.some((d) => d.isDirty)) {
                const a = await ui.showWarningMessage(
                  "Unsaved buffers cannot be captured. Save all files first?",
                  "Save all",
                );
                if (a !== "Save all" || !(await vscode.workspace.saveAll()))
                  return;
              }
              const name = await ui.showInputBox({
                prompt: "Snapshot name",
                value: path.basename(root),
              });
              if (!name) return;
              const destination = await ui.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                openLabel: "Snapshot output folder",
              });
              if (!destination) return;
              const review = await call([
                "capture",
                "--root",
                root,
                "--name",
                name,
                "--dry-run",
              ]);
              out.appendLine(JSON.stringify(review, null, 2));
              out.show(true);
              if (
                (await ui.showInformationMessage(
                  `Capture ${review.fileCount} entries? Review exclusions in DevTeleport output.`,
                  "Capture",
                )) !== "Capture"
              )
                return;
              password = await ui.showInputBox({
                prompt: "Encryption passphrase (12+ characters)",
                password: true,
                ignoreFocusOut: true,
              });
              if (!password) return;
              // Public API state: saved relative editor paths only. No buffer text or arbitrary extension state.
              const tabs = vscode.window.tabGroups.all
                .flatMap((g) => g.tabs)
                .map((t) => t.input?.uri)
                .filter(
                  (u) =>
                    u?.scheme === "file" &&
                    u.fsPath.startsWith(root + path.sep),
                )
                .map((u) => path.relative(root, u.fsPath));
              await fs.mkdir(path.join(root, ".vscode"), { recursive: true });
              await fs.writeFile(
                path.join(root, ".vscode", "devteleport-session.json"),
                JSON.stringify({
                  tabs,
                  active: vscode.window.activeTextEditor
                    ? path.relative(
                        root,
                        vscode.window.activeTextEditor.document.uri.fsPath,
                      )
                    : null,
                }),
              );
              args.push(
                "--root",
                root,
                "--name",
                name,
                "--output",
                destination[0].fsPath,
              );
            } else if (action === "restore") {
              const file = await ui.showOpenDialog({
                filters: { DevTeleport: ["dtp"] },
                canSelectMany: false,
              });
              if (!file) return;
              const target = await ui.showInputBox({
                prompt: "New absolute restore directory (must not exist)",
              });
              if (!target) return;
              password = await ui.showInputBox({
                prompt: "Snapshot passphrase",
                password: true,
                ignoreFocusOut: true,
              });
              if (!password) return;
              const plan = await call(
                ["restore", file[0].fsPath, "--target", target, "--dry-run"],
                password,
              );
              out.appendLine(JSON.stringify(plan, null, 2));
              out.show(true);
              if (
                (await ui.showInformationMessage(
                  `Restore ${plan.fileCount} entries to ${target}?`,
                  "Restore",
                )) !== "Restore"
              )
                return;
              args.push(file[0].fsPath, "--target", target);
            } else args.push(root);
            status.text = "$(sync~spin) DevTeleport: " + action;
            status.command = "devteleport.cancel";
            const result = await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `DevTeleport: ${action}`,
                cancellable: true,
              },
              (_progress, token) => call(args, password, token),
            );
            password = undefined;
            lastResult = result;
            lastError = null;
            out.appendLine(JSON.stringify(result, null, 2));
            out.show(true);
            last = `${action}: completed`;
            status.text = "$(check) DevTeleport: " + action;
            status.command = "devteleport.inspect";
            status.tooltip = last;
            emitter.fire();
            if (
              action === "restore" &&
              (await ui.showInformationMessage(
                "Workspace restored. Open it?",
                "Open",
              )) === "Open"
            )
              await vscode.commands.executeCommand(
                "vscode.openFolder",
                vscode.Uri.file(result.target),
                { forceNewWindow: true },
              );
            return result;
          } catch (e) {
            last = e.message;
            status.text = "$(warning) DevTeleport";
            status.tooltip = e.message;
            status.command = "devteleport.inspect";
            lastError = e.message;
            emitter.fire();
            out.appendLine(e.message);
            if (context.extensionMode !== vscode.ExtensionMode.Test)
              vscode.window.showErrorMessage(`DevTeleport: ${e.message}`);
          }
        },
      ),
    );
  const api = {
    isBusy: () => Boolean(activeChild),
    getLastResult: () => lastResult,
    getLastError: () => lastError,
  };
  if (context.extensionMode === vscode.ExtensionMode.Test)
    api.setDialogResponses = (value) => {
      dialogResponses = value;
    };
  async function reopenSavedFiles(root) {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust the workspace before reopening saved files.");
    const state = JSON.parse(
      await fs.readFile(
        path.join(root, ".vscode", "devteleport-session.json"),
        "utf8",
      ),
    );
    if (
      !Array.isArray(state.tabs) ||
      state.tabs.some((p) => typeof p !== "string") ||
      (state.active !== null && typeof state.active !== "string")
    )
      throw new Error("Invalid editor session metadata");
    if (
      (await ui.showInformationMessage(
        "DevTeleport saved editor context found. Reopen saved files?",
        "Reopen",
      )) !== "Reopen"
    )
      return [];
    const paths = [
        ...state.tabs.filter((p) => p !== state.active),
        state.active,
      ]
        .filter(Boolean)
        .slice(0, 50),
      opened = [];
    const realRoot = await fs.realpath(root);
    for (const p of paths) {
      const absolute = path.resolve(root, p);
      if (!absolute.startsWith(path.resolve(root) + path.sep)) continue;
      try {
        const real = await fs.realpath(absolute);
        if (!real.startsWith(realRoot + path.sep)) continue;
        await vscode.window.showTextDocument(vscode.Uri.file(real), {
          preview: false,
          preserveFocus: p !== state.active,
        });
        opened.push(real);
      } catch {}
    }
    return opened;
  }
  api.reopenSavedFiles = reopenSavedFiles;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root && vscode.workspace.isTrusted)
    reopenSavedFiles(root).catch((error) => {
      if (error.code !== "ENOENT")
        out.appendLine("Editor session: " + error.message);
    });
  return api;
}
module.exports = { activate };
