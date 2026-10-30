const $ = (id) => document.getElementById(id),
  reviews = new Map();
let preferences = {},
  busy = false,
  lastData = {};
const titles = {
  dashboard: [
    "A new place. The same workspace.",
    "Capture saved development state. Continue independently on another Mac.",
  ],
  workspace: [
    "Know what will travel.",
    "Real compatibility, Git context, services and support boundaries.",
  ],
  capture: [
    "Take your workspace with you.",
    "Review first. Encrypt locally. Verify before you leave.",
  ],
  restore: [
    "Continue where you left off.",
    "Authenticate, approve, and restore into a new destination.",
  ],
  library: [
    "A library that stays private.",
    "Encrypted snapshots, local labels and explicit file operations.",
  ],
  transfer: [
    "From this Mac to the next.",
    "Authenticated TLS pairing with explicit receiving approval.",
  ],
  settings: [
    "Your tools. Your preferences.",
    "No plaintext passwords. No background telemetry.",
  ],
  about: [
    "Built for the way you work.",
    "A transparent local-first developer tool.",
  ],
};
function navigate(view) {
  if (!titles[view]) return;
  for (const pane of document.querySelectorAll("[data-pane]"))
    pane.hidden = pane.dataset.pane !== view;
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("selected", button.dataset.view === view);
    button.setAttribute(
      "aria-current",
      button.dataset.view === view ? "page" : "false",
    );
  }
  $("pageTitle").textContent = titles[view][0];
  $("pageSubtitle").textContent = titles[view][1];
}
for (const button of document.querySelectorAll("[data-view]"))
  button.onclick = () => {
    navigate(button.dataset.view);
    refreshData().catch(showError);
  };
for (const button of document.querySelectorAll("[data-go]"))
  button.onclick = () => navigate(button.dataset.go);
window.teleport.onNavigate(navigate);
function showError(error) {
  $("status").textContent = "Needs attention";
  $("result").textContent = error.message || String(error);
}
function settingsValue() {
  return {
    ...preferences,
    source: $("source").value,
    output: $("output").value,
    name: $("name").value,
    target: $("target").value,
    toolDirectories: $("toolDirectories").value,
    theme: $("theme").value,
    editor: $("editor").value,
    exclusions: $("exclusions").value,
    trustedPublicKey: $("trustedPublicKey").value,
    updateManifestUrl: $("updateManifestUrl").value,
    updateSignatureUrl: $("updateSignatureUrl").value,
    updatePublicKey: $("updatePublicKey").value,
    notifications: $("notifications").checked,
    startAtLogin: $("startAtLogin").checked,
  };
}
async function persist() {
  preferences = await window.teleport.settings(settingsValue());
  document.documentElement.dataset.theme = preferences.theme || "system";
  return preferences;
}
function size(bytes) {
  if (!Number.isFinite(bytes)) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (bytes >= 1024 && unit < 4) {
    bytes /= 1024;
    unit++;
  }
  return bytes.toFixed(unit > 1 ? 1 : 0) + " " + units[unit];
}
function row(title, detail) {
  const element = document.createElement("div");
  element.className = "list-row";
  const text = document.createElement("div");
  text.className = "detail";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = detail;
  text.append(strong, small);
  element.append(text);
  return element;
}
async function refreshData() {
  lastData = await window.teleport.data();
  const editor = $("editor");
  editor.replaceChildren();
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "Automatic discovery / reveal in Finder";
  editor.append(automatic);
  for (const file of lastData.editors ?? []) {
    const option = document.createElement("option");
    option.value = file;
    option.textContent = file.split("/").pop();
    editor.append(option);
  }
  editor.value = preferences.editor || "";
  $("storage").textContent = size(lastData.storage.available);
  $("architecture").textContent =
    lastData.architecture === "arm64"
      ? "Native Apple Silicon"
      : "Runtime: " + lastData.architecture;
  $("sideArchitecture").textContent =
    "macOS · " + lastData.architecture + " · " + lastData.version;
  $("versionInfo").textContent =
    `Version ${lastData.version} · Electron ${lastData.electron} · ${lastData.architecture}`;
  $("updateStatus").textContent = lastData.updates.reason;
  $("lastCapture").textContent = lastData.lastCapture
    ? lastData.lastCapture.file.split("/").pop()
    : "No captures yet";
  $("lastCaptureDetail").textContent = lastData.lastCapture
    ? `${lastData.lastCapture.fileCount} entries · ${new Date(lastData.lastCapture.completedAt).toLocaleString()}`
    : "Your first snapshot will appear here.";
  $("lastRestore").textContent = lastData.lastRestore
    ? lastData.lastRestore.verified
      ? "Verified"
      : "Review result"
    : "No restores yet";
  $("lastRestoreDetail").textContent = lastData.lastRestore
    ? lastData.lastRestore.target
    : "Every restore uses a new destination.";
  const workspaces = $("recentWorkspaces");
  workspaces.replaceChildren();
  if (!lastData.workspaces.length)
    workspaces.textContent = "Inspect a workspace to add it here.";
  for (const workspace of lastData.workspaces) {
    const item = row(workspace.name, workspace.root);
    const button = document.createElement("button");
    button.textContent = "Select";
    button.onclick = () => {
      $("source").value = workspace.root;
      navigate("workspace");
    };
    item.append(button);
    workspaces.append(item);
  }
  const snapshots = $("recentSnapshots");
  snapshots.replaceChildren();
  if (!lastData.snapshots.length)
    snapshots.textContent = "No captured snapshots have been recorded.";
  for (const snapshot of lastData.snapshots.slice(0, 5)) {
    const item = row(
      lastData.labels?.[snapshot.file] || snapshot.file.split("/").pop(),
      snapshot.file,
    );
    const button = document.createElement("button");
    button.textContent = "Restore…";
    button.onclick = () => {
      $("snapshot").value = snapshot.file;
      navigate("restore");
    };
    item.append(button);
    snapshots.append(item);
  }
}
for (const [button, field, kind] of [
  ["chooseWorkspace", "source", "directory"],
  ["chooseOutput", "output", "directory"],
  ["chooseSnapshot", "snapshot", "snapshot"],
  ["chooseConfig", "dbConfig", "file"],
  ["chooseSendSnapshot", "sendSnapshot", "snapshot"],
  ["choosePairing", "pairing", "file"],
])
  $(button).onclick = async () => {
    try {
      const chosen = await window.teleport.choose(kind);
      if (chosen) $(field).value = chosen;
    } catch (error) {
      showError(error);
    }
  };
for (const [button, field, kind] of [
  ["chooseReceiveTarget", "receiveTarget", "snapshot"],
  ["choosePairingOutput", "pairingOutput", "pairing"],
])
  $(button).onclick = async () => {
    try {
      const chosen = await window.teleport.savePath({ kind });
      if (chosen) $(field).value = chosen;
    } catch (error) {
      showError(error);
    }
  };
function inputFor(action, dryRun = false) {
  return {
    action,
    dryRun,
    source:
      action === "restore"
        ? $("snapshot").value
        : action === "history"
          ? $("output").value || $("source").value
          : $("source").value,
    name: $("name").value,
    output: $("output").value,
    target: $("target").value,
    password: $(action === "capture" ? "capturePassword" : "restorePassword")
      .value,
    toolDirectories: $("toolDirectories").value,
    includeDb: $("includeDb").checked,
    includeVolumes: $("includeVolumes").checked,
    restoreDb: $("restoreDb").checked,
    restoreVolumes: $("restoreVolumes").checked,
    install: $("install").checked,
    dbConfig: $("dbConfig").value,
    exclusions: $("exclusions").value,
    trustedPublicKey: $("trustedPublicKey").value,
  };
}
function setBusy(value) {
  busy = value;
  for (const button of document.querySelectorAll("button"))
    if (!button.dataset.view && !button.dataset.go)
      button.disabled = value ? button.id !== "cancel" : button.id === "cancel";
}
async function execute(input) {
  if (busy) throw new Error("An operation is already running.");
  await persist();
  setBusy(true);
  $("status").textContent = "Working…";
  try {
    const reviewKey = JSON.stringify({
      ...input,
      password: undefined,
      dryRun: undefined,
    });
    if (
      ["capture", "restore"].includes(input.action) &&
      !input.dryRun &&
      reviews.get(input.action) !== reviewKey
    )
      throw new Error(
        "Review the capture or restore plan first, after selecting your final options.",
      );
    if (
      input.action === "capture" &&
      (input.includeDb || input.includeVolumes)
    ) {
      const configuration = await window.teleport.operation({
        action: "inspect",
        source: input.source,
        toolDirectories: input.toolDirectories,
      });
      const missing = [];
      if (input.includeDb && !configuration.databases?.length)
        missing.push("PostgreSQL databases");
      if (input.includeVolumes && !configuration.volumes?.length)
        missing.push("Docker volumes");
      if (missing.length)
        throw new Error(
          "No " +
            missing.join(" or ") +
            " configured for this project. Uncheck the corresponding Include options to capture files and Git, or configure them in the project's devteleport.json and review again. Nothing has been captured.",
        );
    }
    let result = await window.teleport.operation(input);
    if (input.action === "capture" && !input.dryRun) {
      $("status").textContent = "Authenticating created archive…";
      await window.teleport.operation({
        action: "snapshot-info",
        source: result.output,
        password: input.password,
        toolDirectories: input.toolDirectories,
      });
      result.archiveVerified = true;
    }
    if (input.dryRun) reviews.set(input.action, reviewKey);
    else reviews.delete(input.action);
    const rendered = JSON.stringify(result, null, 2);
    $("result").textContent =
      rendered.length > 1024 * 1024
        ? rendered.slice(0, 1024 * 1024) +
          "\n[Display truncated at 1 MiB; use the CLI for the complete report.]"
        : rendered;
    $("status").textContent = "Completed";
    if (input.action === "inspect") {
      $("inspectorResult").textContent = JSON.stringify(result, null, 2);
      navigate("workspace");
    }
    if (input.action === "history") await renderLibrary(result);
    if (input.action === "pairing-info")
      $("transferInfo").textContent = JSON.stringify(result, null, 2);
    if (input.action === "receive") {
      $("snapshot").value = result.target;
      $("transferInfo").textContent =
        "Received and checksum-verified: " +
        result.target +
        "\nChoose Restore when ready; authentication and approval remain required.";
    }
    await refreshData();
    return result;
  } catch (error) {
    showError(error);
    throw error;
  } finally {
    input.password = "";
    setBusy(false);
  }
}
for (const button of document.querySelectorAll("[data-action]"))
  button.onclick = () =>
    execute(
      inputFor(button.dataset.action, button.dataset.dry === "true"),
    ).catch(() => {});
function ask(title, password = false) {
  $("inputTitle").textContent = title;
  $("inputValue").type = password ? "password" : "text";
  $("inputValue").value = "";
  $("inputDialog").returnValue = "";
  $("inputDialog").showModal();
  return new Promise((resolve) =>
    $("inputDialog").addEventListener(
      "close",
      () => {
        const result =
          $("inputDialog").returnValue === "ok" ? $("inputValue").value : null;
        $("inputValue").value = "";
        resolve(result);
      },
      { once: true },
    ),
  );
}
async function renderLibrary(items) {
  const container = $("libraryList");
  container.replaceChildren();
  if (!items.length) {
    container.textContent = "No encrypted snapshots found in this folder.";
    return;
  }
  const data = await window.teleport.data();
  for (const item of items) {
    const element = row(
      data.labels?.[item.file] || item.file.split("/").pop(),
      `${size(item.bytes)} · ${item.status} · ${new Date(item.modifiedAt).toLocaleString()}`,
    );
    for (const [label, action] of [
      ["Unlock & verify", "verify"],
      ["Label", "label"],
      ["Export…", "export"],
      ["Trash…", "delete"],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.onclick = async () => {
        try {
          if (action === "verify") {
            const password = await ask("Snapshot passphrase", true);
            if (password === null) return;
            await execute({
              action: "snapshot-info",
              source: item.file,
              password,
              toolDirectories: $("toolDirectories").value,
            });
          } else {
            const value = { file: item.file, action };
            if (action === "label") {
              value.label = await ask("Local display label");
              if (value.label === null) return;
            }
            const result = await window.teleport.libraryAction(value);
            $("result").textContent = JSON.stringify(result, null, 2);
            await execute(inputFor("history"));
          }
        } catch (error) {
          showError(error);
        }
      };
      element.append(button);
    }
    container.append(element);
  }
}
$("saveSettings").onclick = () =>
  persist()
    .then(() => {
      $("status").textContent = "Completed";
      $("result").textContent = "Nonsecret preferences saved.";
    })
    .catch(showError);
$("theme").onchange = () => {
  document.documentElement.dataset.theme = $("theme").value;
};
$("exportDiagnostics").onclick = () =>
  window.teleport
    .exportDiagnostics()
    .then((result) => {
      $("result").textContent = JSON.stringify(result, null, 2);
    })
    .catch(showError);
$("openProject").onclick = () =>
  window.teleport
    .openProject()
    .then((result) => {
      $("result").textContent = JSON.stringify(result, null, 2);
    })
    .catch(showError);
$("inspectRecovery").onclick = () =>
  execute({ ...inputFor("history"), action: "recover" }).catch(() => {});
$("pairingInfo").onclick = () =>
  execute({
    action: "pairing-info",
    pairing: $("pairing").value,
    toolDirectories: $("toolDirectories").value,
  }).catch(() => {});
$("sendButton").onclick = () =>
  execute({
    action: "send",
    source: $("sendSnapshot").value,
    pairing: $("pairing").value,
    password: $("sendPassword").value,
    approvePeer: $("approvePeer").checked,
    toolDirectories: $("toolDirectories").value,
  }).catch(() => {});
$("receiveButton").onclick = () =>
  execute({
    action: "receive",
    target: $("receiveTarget").value,
    pairingOutput: $("pairingOutput").value,
    bind: $("bind").value,
    advertise: $("advertise").value,
    resume: $("resumeTransfer").checked,
    approveReceive: $("approveReceive").checked,
    toolDirectories: $("toolDirectories").value,
  }).catch(() => {});
window.teleport.onProgress((progress) => {
  $("status").textContent = progress.phase;
  if (progress.ready)
    $("transferInfo").textContent = JSON.stringify(progress.ready, null, 2);
});
$("cancel").onclick = () => window.teleport.cancel();
$("showWelcome").onclick = () => $("welcome").showModal();
$("welcomeDone").onclick = async () => {
  $("welcome").close();
  preferences.onboardingComplete = true;
  await persist();
  navigate("workspace");
};
window.teleport
  .settings()
  .then(async (value) => {
    preferences = value;
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
      if (value[key]) $(key).value = value[key];
    for (const key of ["notifications", "startAtLogin"])
      $(key).checked = Boolean(value[key]);
    document.documentElement.dataset.theme = value.theme || "system";
    await refreshData();
    if (!value.onboardingComplete) $("welcome").showModal();
  })
  .catch(showError);

$("checkUpdates").onclick = async () => {
  try {
    await persist();
    const result = await window.teleport.checkUpdates();
    $("updateStatus").textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    $("updateStatus").textContent = error.message;
  }
};

window.teleport
  .license()
  .then((text) => {
    $("licenseText").textContent = text;
  })
  .catch((error) => {
    $("licenseText").textContent = error.message;
  });

window.teleport.onOpenSnapshot((file) => {
  $("snapshot").value = file;
  navigate("restore");
});
