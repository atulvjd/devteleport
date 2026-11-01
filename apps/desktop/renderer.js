const $ = (id) => document.getElementById(id),
  reviews = new Map();
let preferences = {},
  busy = false,
  lastData = {},
  workspaceInfo = null,
  restoreDependencies = null;
const titles = {
  dashboard: [
    "Workspace overview",
    "Everything you need to pick up where you left off.",
  ],
  workspace: [
    "Workspace inspector",
    "Understand your files, Git state and configured components.",
  ],
  capture: [
    "Capture your workspace",
    "One encrypted checkpoint. Ready for another Mac.",
  ],
  restore: [
    "Restore your workspace",
    "Unlock your saved work and give it a new home.",
  ],
  library: [
    "Snapshot library",
    "Your encrypted checkpoints, kept on your Mac.",
  ],
  transfer: [
    "Mac-to-Mac transfer",
    "Move an encrypted snapshot directly to another Mac.",
  ],
  settings: [
    "Settings",
    "Appearance, trusted tools and your local preferences.",
  ],
  about: [
    "About DevTeleport",
    "Built for local, private workspace continuity.",
  ],
};
const navLabels = {
  dashboard: "Overview",
  workspace: "Workspace",
  capture: "Capture",
  restore: "Restore",
  library: "Snapshot library",
  transfer: "Transfer",
  settings: "Settings",
  about: "About & privacy",
};
function navigate(view) {
  if (!titles[view]) return;
  window.scrollTo({ top: 0, behavior: "instant" });
  for (const pane of document.querySelectorAll("[data-pane]"))
    pane.hidden = pane.dataset.pane !== view;
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("selected", button.dataset.view === view);
    button.setAttribute(
      "aria-current",
      button.dataset.view === view ? "page" : "false",
    );
  }
  document.querySelector("main").dataset.view = view;
  $("breadcrumb").textContent = "DevTeleport / " + navLabels[view];
  $("pageTitle").textContent = titles[view][0];
  $("pageSubtitle").textContent = titles[view][1];
  window.scrollTo({ top: 0, behavior: "instant" });
}
for (const button of document.querySelectorAll("[data-view]"))
  button.onclick = () => {
    navigate(button.dataset.view);
    refreshData().catch(showError);
  };
for (const button of document.querySelectorAll("[data-go]"))
  button.onclick = () => navigate(button.dataset.go);
window.teleport.onNavigate(navigate);
document.querySelector(".brand").onclick = (event) => {
  event.preventDefault();
  navigate("dashboard");
};
function activity(state, title, summary, status) {
  document.querySelector(".activity").dataset.state = state;
  $("activityTitle").textContent = title;
  $("activitySummary").textContent = summary;
  $("status").textContent = status;
  document.querySelector(".progress-track").hidden = state !== "working";
}
function showError(error) {
  const message = (error.message || String(error))
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
    .replace(/^DevTeleport:\s*/, "");
  activity("error", "Let’s get this sorted.", message, "Needs attention");
  $("result").textContent = message;
}
let consoleRun = null,
  consoleTimer = null,
  consoleRenderTimer = null;
const operationLabels = {
  capture: "Capture",
  restore: "Restore",
  inspect: "Inspect",
  verify: "Verify",
  history: "Snapshot history",
  services: "Inspect services",
  diagnostics: "Diagnostics",
  recover: "Recovery inspection",
  send: "Send snapshot",
  receive: "Receive snapshot",
  "pairing-info": "Inspect pairing",
};
function consoleDuration(ms, precise = false) {
  const seconds = Math.max(0, ms / 1000),
    minutes = Math.floor(seconds / 60);
  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(Math.floor(seconds % 60)).padStart(2, "0") +
    (precise ? "." + String(Math.floor(ms % 1000)).padStart(3, "0") : "")
  );
}
function consoleStages(input) {
  if (input.action === "capture")
    return input.dryRun
      ? ["Inspect workspace", "Review saved files"]
      : [
          "Inspect workspace",
          "Stage files",
          ...(input.includeDb || input.includeVolumes
            ? ["Back up selected data"]
            : []),
          "Encrypt archive",
          "Publish snapshot",
          "Authenticate archive",
        ];
  if (input.action === "restore")
    return input.dryRun
      ? ["Authenticate snapshot", "Review requirements"]
      : [
          "Authenticate snapshot",
          "Review requirements",
          "Restore files",
          ...(input.restoreDb || input.restoreVolumes
            ? ["Restore selected data"]
            : []),
          ...(input.install ? ["Install dependencies"] : []),
          "Verify workspace",
        ];
  return [operationLabels[input.action] || "Run operation"];
}
function beginConsole(input) {
  clearInterval(consoleTimer);
  consoleRun = {
    action: input.action,
    dryRun: input.dryRun,
    started: performance.now(),
    date: new Date().toISOString(),
    entries: [],
    dropped: 0,
    retained: 0,
    steps: consoleStages(input),
    active: 0,
    finished: false,
    state: "working",
    command:
      (operationLabels[input.action] || input.action) +
      (input.dryRun ? " · review only" : ""),
    metrics: [],
  };
  $("consoleNotice").textContent =
    "Filtered output · local paths may be included · review before sharing";
  appendConsole(
    "info",
    input.dryRun
      ? "Starting read-only review. No project actions are approved by reviewing."
      : "Operation started. Follow the live steps below.",
  );
  consoleTimer = setInterval(() => {
    if (consoleRun && !consoleRun.finished)
      $("consoleElapsed").textContent = consoleDuration(
        performance.now() - consoleRun.started,
      );
  }, 500);
  renderConsole();
  if (!input.dryRun)
    requestAnimationFrame(() =>
      $("operationConsole").scrollIntoView({
        block: "nearest",
        behavior: "instant",
      }),
    );
}
function appendConsole(level, value) {
  if (!consoleRun) return;
  const text = String(value ?? "").slice(0, 4096);
  if (!text) return;
  if (consoleRun.entries.at(-1)?.text === text) return;
  consoleRun.entries.push({
    time: consoleDuration(performance.now() - consoleRun.started, true),
    level,
    text,
  });
  consoleRun.retained += text.length;
  while (consoleRun.entries.length > 500 || consoleRun.retained > 180 * 1024) {
    const item = consoleRun.entries.shift();
    consoleRun.retained -= item.text.length;
    consoleRun.dropped++;
  }
  if (!consoleRenderTimer)
    consoleRenderTimer = setTimeout(() => {
      consoleRenderTimer = null;
      renderConsole();
    }, 50);
}
function advanceConsole(phase) {
  if (!consoleRun || consoleRun.finished) return;
  let label = null;
  if (/^Checking project requirements/.test(phase))
    label = "Review requirements";
  else if (/^Authenticating (?:entire|and)/.test(phase))
    label = "Authenticate snapshot";
  else if (/^Authenticating created|^Checking your new/.test(phase))
    label = "Authenticate archive";
  else if (/^Verifying restored/.test(phase)) label = "Verify workspace";
  else if (/^(?:Installing dependencies:|Dependencies installed:)/.test(phase))
    label = "Install dependencies";
  else if (
    /^Restoring database |^Running explicitly approved post-restore/.test(phase)
  )
    label = "Restore selected data";
  else if (/^Restoring /.test(phase)) label = "Restore files";
  else if (/^Encrypting|^Validating and encrypting/.test(phase))
    label = "Encrypt archive";
  else if (/^Publishing/.test(phase)) label = "Publish snapshot";
  else if (/^Exporting database |^Backing up/.test(phase))
    label = "Back up selected data";
  else if (/^Staging |^Enumerating/.test(phase))
    label = consoleRun.dryRun ? "Review saved files" : "Stage files";
  else if (/^Analyzing/.test(phase)) label = "Inspect workspace";
  const index = consoleRun.steps.indexOf(label);
  if (index >= 0) consoleRun.active = Math.max(consoleRun.active, index);
  appendConsole("step", phase);
}
function consoleResultMetrics(input, result) {
  const metrics = [];
  if (Number.isFinite(result.fileCount))
    metrics.push(["Entries", String(result.fileCount)]);
  if (Number.isFinite(result.bytes))
    metrics.push(["Payload", size(result.bytes)]);
  if (result.databases?.length)
    metrics.push(["Databases", String(result.databases.length)]);
  if (result.volumes?.length)
    metrics.push(["Volumes", String(result.volumes.length)]);
  if (input.action === "restore" && input.install)
    metrics.push([
      "Package installs",
      String(
        new Set((result.dependencies?.packages || []).map((p) => p.installAt))
          .size,
      ),
    ]);
  if (input.action === "verify")
    metrics.push(["Verification", result.ok ? "Matched" : "Differences found"]);
  if (result.archiveVerified) metrics.push(["Authentication", "Passed"]);
  if (input.action === "history" && Array.isArray(result))
    metrics.push(["Snapshots", String(result.length)]);
  if (input.action === "diagnostics" && result.tools)
    metrics.push(
      [
        "Available tools",
        String(result.tools.filter((t) => t.status === "available").length),
      ],
      [
        "Tools to check",
        String(result.tools.filter((t) => t.status !== "available").length),
      ],
    );
  return metrics;
}
function finishConsole(input, result, error) {
  if (!consoleRun || consoleRun.finished) return;
  clearInterval(consoleTimer);
  const failed = error || result?.ok === false;
  consoleRun.state =
    error && /cancelled/i.test(error.message)
      ? "cancelled"
      : failed
        ? "error"
        : "success";
  consoleRun.elapsed = performance.now() - consoleRun.started;
  appendConsole(
    failed ? "error" : "success",
    error
      ? error.message
          .replace(
            /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
            "",
          )
          .replace(/^DevTeleport:\s*/, "")
      : failed
        ? "Verification found differences. Review the result before continuing."
        : input.dryRun
          ? "Review complete. No project actions were executed."
          : "Operation completed successfully.",
  );
  consoleRun.metrics = result ? consoleResultMetrics(input, result) : [];
  for (const [label, value] of consoleRun.metrics)
    appendConsole("info", label + ": " + value);
  for (const warning of result?.warnings || [])
    appendConsole("warning", warning);
  for (const problem of (result?.problems || []).slice(0, 100))
    appendConsole(
      "error",
      typeof problem === "string" ? problem : JSON.stringify(problem),
    );
  if ((result?.problems?.length || 0) > 100)
    appendConsole(
      "warning",
      "More verification differences are available in Technical details.",
    );
  if (input.action === "inspect" && result) {
    appendConsole(
      "info",
      "Package manager: " + (result.runtime?.packageManager || "not detected"),
    );
    appendConsole(
      "info",
      "Git branch: " + (result.git?.branch || "No branch / repository"),
    );
  }
  if (input.action === "diagnostics" && result?.tools)
    for (const tool of result.tools)
      appendConsole(
        tool.status === "available" ? "success" : "warning",
        tool.name + ": " + tool.status,
      );
  if (input.action === "restore" && !input.dryRun && result) {
    for (const pkg of result.dependencies?.packages || [])
      for (const script of pkg.scripts)
        appendConsole(
          "command",
          `[${pkg.directory}] $ ${pkg.manager} run ${script.name}`,
        );
  }
  consoleRun.finished = true;
  renderConsole();
}
function renderConsole() {
  clearTimeout(consoleRenderTimer);
  consoleRenderTimer = null;
  const run = consoleRun;
  $("operationConsole").dataset.state = run?.state || "idle";
  $("consoleState").textContent = !run
    ? "Idle"
    : !run.finished
      ? "Running"
      : run.state === "success"
        ? "Completed"
        : run.state === "cancelled"
          ? "Cancelled"
          : "Needs attention";
  $("consoleElapsed").textContent = run
    ? consoleDuration(run.elapsed ?? performance.now() - run.started)
    : "00:00";
  $("consoleCommand").textContent =
    run?.command || "Choose an action to see its command and live output.";
  $("consoleSteps").hidden = !run;
  $("consoleSteps").replaceChildren();
  for (const [index, label] of (run?.steps || []).entries()) {
    const row = document.createElement("li"),
      mark = document.createElement("span"),
      text = document.createElement("span");
    const state =
      (run.finished && run.state === "success") || index < run.active
        ? "done"
        : index === run.active
          ? run.finished
            ? run.state
            : "active"
          : "pending";
    row.dataset.state = state;
    row.setAttribute("aria-label", label + ": " + state);
    mark.textContent =
      state === "done"
        ? "✓"
        : ["error", "cancelled"].includes(state)
          ? "!"
          : String(index + 1).padStart(2, "0");
    text.textContent = label;
    row.append(mark, text);
    $("consoleSteps").append(row);
  }
  const output = $("consoleOutput"),
    oldScroll = output.scrollTop;
  output.replaceChildren();
  for (const entry of run?.entries || []) {
    const row = document.createElement("div"),
      time = document.createElement("time"),
      tag = document.createElement("span"),
      text = document.createElement("span");
    row.className = "console-line";
    row.dataset.level = entry.level;
    time.textContent = entry.time;
    tag.className = "console-tag";
    tag.textContent =
      {
        command: "$",
        step: "›",
        success: "✓",
        warning: "!",
        error: "×",
        output: "│",
        info: "·",
      }[entry.level] || "·";
    text.textContent = entry.text;
    row.append(time, tag, text);
    output.append(row);
  }
  if (!run?.entries.length) {
    const p = document.createElement("p");
    p.className = "console-empty";
    p.textContent =
      "Live steps and dependency-install output will appear here.";
    output.append(p);
  }
  output.scrollTop = $("consoleFollow").checked
    ? output.scrollHeight
    : oldScroll;
  $("consoleCount").textContent = run
    ? `${run.entries.length} events` +
      (run.dropped ? ` · ${run.dropped} older events omitted` : "")
    : "No events yet";
  $("consoleMetrics").replaceChildren();
  $("consoleMetrics").hidden = !run?.metrics.length;
  for (const [label, value] of run?.metrics || []) {
    const item = document.createElement("div"),
      key = document.createElement("span"),
      strong = document.createElement("strong");
    key.textContent = label;
    strong.textContent = value;
    item.append(key, strong);
    $("consoleMetrics").append(item);
  }
  $("consoleCopy").disabled = $("consoleExport").disabled =
    !run?.entries.length;
  $("consoleClear").disabled = busy || !run;
}
function consoleTranscript() {
  if (!consoleRun) return "";
  return [
    `DevTeleport workspace activity · ${consoleRun.date}`,
    consoleRun.command,
    `State: ${$("consoleState").textContent} · elapsed ${$("consoleElapsed").textContent}`,
    ...(consoleRun.dropped
      ? [
          `${consoleRun.dropped} older events omitted; this is the retained tail.`,
        ]
      : []),
    ...consoleRun.entries.map((e) => `${e.time} [${e.level}] ${e.text}`),
  ].join("\n");
}
for (const [id, action] of [
  ["consoleCopy", "copy"],
  ["consoleExport", "export"],
])
  $(id).onclick = async () => {
    try {
      const result = await window.teleport.activityText({
        action,
        text: consoleTranscript(),
      });
      $("consoleNotice").textContent = result.cancelled
        ? "Save cancelled."
        : action === "copy"
          ? "Filtered log copied. Review before sharing."
          : "Filtered log saved. Review before sharing.";
    } catch (error) {
      $("consoleNotice").textContent = error.message.replace(
        /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
        "",
      );
    }
  };
$("consoleClear").onclick = () => {
  if (busy) return;
  consoleRun = null;
  clearInterval(consoleTimer);
  renderConsole();
  $("consoleNotice").textContent =
    "Console cleared. No log is saved automatically.";
};
$("consoleFollow").onchange = () => {
  if ($("consoleFollow").checked)
    $("consoleOutput").scrollTop = $("consoleOutput").scrollHeight;
};
function reviewKey(input) {
  return JSON.stringify({ ...input, password: undefined, dryRun: undefined });
}
function syncReviewActions() {
  for (const action of ["capture", "restore"]) {
    const valid = reviews.get(action) === reviewKey(inputFor(action));
    const button = document.querySelector(`[data-action="${action}"].primary`);
    button.disabled = busy || !valid;
    if (action === "restore") {
      const blocked =
        $("install").checked && restoreDependencies?.blockers?.length;
      if (blocked) button.disabled = true;
      button.firstChild.textContent = $("install").checked
        ? "Restore & install "
        : "Restore files ";
    }
    const panel = button.closest(".action-panel");
    panel.dataset.reviewed = String(valid);
    $(action + "ReviewState").textContent = valid
      ? "Review complete. Ready when you are."
      : "Review " +
        (action === "capture"
          ? "your snapshot before creating it"
          : "your snapshot before restoring it");
    $(action + "Review").dataset.stale = String(!valid);
    document
      .querySelector(`[data-review-step="${action}"]`)
      .classList.toggle("is-reviewed", valid);
  }
  $("openProject").disabled =
    busy ||
    !lastData.lastRestore?.verified ||
    lastData.lastRestore.target !== $("target").value;
}
function syncComponents() {
  const current =
    workspaceInfo?.source === $("source").value ? workspaceInfo.report : null;
  for (const [id, field, label] of [
    ["includeDb", "databases", "databaseAvailability"],
    ["includeVolumes", "volumes", "volumeAvailability"],
  ]) {
    const count = current?.[field]?.length || 0;
    $(id).disabled = busy || !count;
    if (!count) $(id).checked = false;
    $(label).textContent = !current
      ? "Inspect workspace to check configuration"
      : !count
        ? "Not configured · not included"
        : `${count} configured · include only if needed`;
  }
  $("workspaceContext").textContent = current
    ? "Inspected · " + (current.project?.name || current.root.split("/").pop())
    : "Choose a project, then inspect it";
}
function renderInspector(report) {
  const container = $("workspaceSummary");
  container.replaceChildren();
  for (const [label, value, detail] of [
    [
      "Git repository",
      report.git
        ? report.git.branch || "Detached / unborn HEAD"
        : "No repository",
      report.git
        ? "Local history and saved changes"
        : "Project files can still be captured",
    ],
    [
      "Package manager",
      report.runtime?.packageManager || "Not detected",
      report.runtime?.lockfiles?.join(", ") || "No lockfile detected",
    ],
    [
      "PostgreSQL",
      String(report.databases?.length || 0) + " configured",
      "Requires opt-in capture",
    ],
    [
      "Docker volumes",
      String(report.volumes?.length || 0) + " configured",
      "Stop writers before capture",
    ],
  ]) {
    const card = document.createElement("div"),
      title = document.createElement("span"),
      strong = document.createElement("strong"),
      small = document.createElement("small");
    card.className = "inspector-stat";
    title.textContent = label;
    strong.textContent = value;
    small.textContent = detail;
    card.append(title, strong, small);
    container.append(card);
  }
  container.hidden = false;
}
function renderReview(action, result, input) {
  const target = $(action + "Review");
  target.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Your " + action + " plan";
  const list = document.createElement("dl");
  const rows = [
    ["Entries", String(result.fileCount ?? "—")],
    ["Payload size", size(result.bytes)],
    [
      action === "capture" ? "Snapshot" : "New destination",
      action === "capture" ? input.name + ".dtp" : input.target,
    ],
    [
      "Databases",
      action === "capture"
        ? input.includeDb
          ? "Included as configured"
          : "Not selected"
        : input.restoreDb
          ? "Approved"
          : "Not selected",
    ],
    [
      "Docker volumes",
      action === "capture"
        ? input.includeVolumes
          ? "Included as configured"
          : "Not selected"
        : input.restoreVolumes
          ? "Approved"
          : "Not selected",
    ],
  ];
  if (action === "capture")
    rows.push(["Excluded entries", String(result.omitted?.length ?? 0)]);
  else
    rows.push([
      "Install dependencies",
      input.install
        ? "Approved for listed npm/pnpm packages"
        : "Manual, after restore",
    ]);
  for (const [label, value] of rows) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    list.append(dt, dd);
  }
  target.append(heading, list);
  for (const warning of result.warnings || []) {
    const note = document.createElement("p");
    note.className = "review-warning";
    note.textContent = warning;
    target.append(note);
  }
  target.hidden = false;
  if (action === "restore") {
    restoreDependencies = result.dependencies;
    renderSetup(result.dependencies, input, false);
    syncReviewActions();
  }
}
function renderSetup(plan, input, restored) {
  const panel = $("restoreSetup"),
    container = $("setupPackages");
  container.replaceChildren();
  panel.hidden = false;
  $("setupTitle").textContent = restored
    ? "Your workspace is restored."
    : "What this project needs";
  $("setupIntro").textContent = restored
    ? input.install
      ? "Dependency installation completed. Open a terminal in the restored folder and use the startup commands below."
      : "Your files are ready. Install the dependencies below before starting the project."
    : input.install
      ? "After restoring, DevTeleport will install these packages automatically using your approval above. Review the commands before continuing."
      : "Select ‘Restore and install dependencies’ to download these packages automatically after restore.";
  for (const message of [
    ...(plan?.blockers || []),
    ...(plan?.warnings || []),
  ]) {
    const note = document.createElement("p");
    note.className = "field-help";
    note.textContent = message;
    container.append(note);
  }
  if (!plan?.packages?.length) {
    const note = document.createElement("p");
    note.textContent =
      "No supported Node.js packages were found. Follow the project's README for its setup and startup commands.";
    container.append(note);
  }
  for (const pkg of plan?.packages || []) {
    const item = document.createElement("div");
    item.className = "setup-package";
    const heading = document.createElement("h3"),
      description = document.createElement("p");
    heading.textContent =
      pkg.directory === "."
        ? "Main project · " + pkg.name
        : pkg.directory + " · " + pkg.name;
    description.textContent =
      `${pkg.framework} · ${pkg.manager} · ${pkg.dependencies.length} declared dependencies` +
      (pkg.requiredNode ? " · Node " + pkg.requiredNode : "");
    item.append(heading, description);
    for (const warning of pkg.warnings) {
      const p = document.createElement("p");
      p.className = "field-help";
      p.textContent = warning;
      item.append(p);
    }
    const install = document.createElement("p");
    install.textContent =
      pkg.installAt === pkg.directory
        ? (restored && input.install
            ? "Installed using: "
            : "Install in this folder: ") + pkg.command.join(" ")
        : "Dependencies installed by workspace root: " + pkg.installAt;
    item.append(install);
    if (pkg.dependencies.length) {
      const details = document.createElement("details"),
        summary = document.createElement("summary"),
        names = document.createElement("p");
      summary.textContent = "Dependencies to install";
      names.textContent = pkg.dependencies.join(", ");
      details.append(summary, names);
      item.append(details);
    }
    if (pkg.environmentKeys.length) {
      const env = document.createElement("p");
      env.className = "field-help";
      env.textContent =
        "Configure environment values separately: " +
        pkg.environmentKeys.join(", ");
      item.append(env);
    }
    for (const script of pkg.scripts) {
      const code = document.createElement("pre");
      code.textContent =
        (pkg.directory === "."
          ? "# In the restored project folder\n"
          : "# In the restored project's " + pkg.directory + " folder\n") +
        pkg.manager +
        " run " +
        script.name;
      item.append(code);
    }
    if (!pkg.scripts.length) {
      const p = document.createElement("p");
      p.textContent =
        "No dev, develop or start script is declared. See this package's README.";
      item.append(p);
    }
    container.append(item);
  }
}
function emptyState(container, iconName, title, copy, actionLabel, view) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "#i-" + iconName);
  svg.append(use);
  const strong = document.createElement("strong"),
    p = document.createElement("p"),
    button = document.createElement("button");
  strong.textContent = title;
  p.textContent = copy;
  button.textContent = actionLabel;
  button.className = "text-button";
  button.onclick = () => navigate(view);
  empty.append(svg, strong, p, button);
  container.append(empty);
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
    ? `${lastData.lastCapture.fileCount} ${lastData.lastCapture.fileCount === 1 ? "entry" : "entries"} · ${new Date(lastData.lastCapture.completedAt).toLocaleString()}`
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
    emptyState(
      workspaces,
      "folder",
      "A place for your projects",
      "Inspect a workspace to see it here next time.",
      "Inspect a workspace →",
      "workspace",
    );
  for (const workspace of lastData.workspaces) {
    const item = row(workspace.name, workspace.root);
    const button = document.createElement("button");
    button.textContent = "Select";
    button.onclick = () => {
      $("source").value = workspace.root;
      syncComponents();
      syncReviewActions();
      navigate("workspace");
    };
    item.append(button);
    workspaces.append(item);
  }
  const snapshots = $("recentSnapshots");
  snapshots.replaceChildren();
  if (!lastData.snapshots.length)
    emptyState(
      snapshots,
      "layers",
      "Your first checkpoint awaits",
      "Capture your workspace to create a private, encrypted snapshot.",
      "Create a snapshot →",
      "capture",
    );
  for (const snapshot of lastData.snapshots.slice(0, 5)) {
    const item = row(
      lastData.labels?.[snapshot.file] || snapshot.file.split("/").pop(),
      snapshot.file,
    );
    const button = document.createElement("button");
    button.textContent = "Restore…";
    button.onclick = () => {
      $("snapshot").value = snapshot.file;
      syncReviewActions();
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
      if (chosen) {
        $(field).value = chosen;
        $(field).dispatchEvent(new Event("input", { bubbles: true }));
      }
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
      if (chosen) {
        $(field).value = chosen;
        $(field).dispatchEvent(new Event("input", { bubbles: true }));
      }
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
  $("cancel").hidden = !value;
  for (const button of document.querySelectorAll("button"))
    if (
      !button.dataset.view &&
      !button.dataset.go &&
      !button.dataset.consoleControl
    )
      button.disabled = value ? button.id !== "cancel" : button.id === "cancel";
  syncComponents();
  syncReviewActions();
  $("consoleClear").disabled = value || !consoleRun;
}
async function execute(input) {
  if (busy) throw new Error("An operation is already running.");
  setBusy(true);
  beginConsole(input);
  activity(
    "working",
    input.dryRun ? "Reviewing your workspace…" : "Working on it…",
    "You can leave this window open. Progress will appear here.",
    "Working…",
  );
  try {
    await persist();
    const key = reviewKey(input);
    if (
      ["capture", "restore"].includes(input.action) &&
      !input.dryRun &&
      reviews.get(input.action) !== key
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
      activity(
        "working",
        "Checking your new snapshot…",
        "Authenticating the encrypted archive before reporting success.",
        "Authenticating created archive…",
      );
      advanceConsole("Authenticating created archive");
      await window.teleport.operation({
        action: "snapshot-info",
        source: result.output,
        password: input.password,
        toolDirectories: input.toolDirectories,
      });
      result.archiveVerified = true;
    }
    if (input.dryRun) reviews.set(input.action, key);
    else reviews.delete(input.action);
    const rendered = JSON.stringify(result, null, 2);
    $("result").textContent =
      rendered.length > 1024 * 1024
        ? rendered.slice(0, 1024 * 1024) +
          "\n[Display truncated at 1 MiB; use the CLI for the complete report.]"
        : rendered;
    const summary = input.dryRun
      ? "Check the plan above. Change any options, then review again before continuing."
      : input.action === "capture"
        ? "Your encrypted snapshot was created and authenticated. Find it in your snapshot library."
        : input.action === "restore"
          ? input.install
            ? "Your files were restored, dependencies installed and files verified. Follow the startup guide above."
            : "Your files were restored and verified. Follow the dependency and startup guide above."
          : input.action === "verify"
            ? result.ok
              ? "The workspace verification completed successfully."
              : "Some entries differ. Review the technical details."
            : "The operation completed. Technical details are available below.";
    activity(
      result.ok === false ? "error" : "success",
      input.dryRun
        ? "Your review is ready."
        : input.action === "capture"
          ? "Your snapshot is ready."
          : input.action === "restore"
            ? "Welcome back to your workspace."
            : input.action === "inspect"
              ? "Workspace inspected."
              : "All done.",
      summary,
      "Completed",
    );
    if (input.dryRun && ["capture", "restore"].includes(input.action))
      renderReview(input.action, result, input);
    if (input.action === "restore" && !input.dryRun)
      renderSetup(result.dependencies, input, true);
    if (input.action === "inspect") {
      workspaceInfo = { source: input.source, report: result };
      renderInspector(result);
      syncComponents();
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
    finishConsole(input, result);
    return result;
  } catch (error) {
    finishConsole(input, null, error);
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
      activity(
        "success",
        "Preferences saved.",
        "Your appearance and nonsecret settings are saved on this Mac.",
        "Completed",
      );
      $("result").textContent = "Nonsecret preferences saved.";
    })
    .catch(showError);
$("theme").onchange = () => {
  document.documentElement.dataset.theme = $("theme").value;
  persist().catch(showError);
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
  if (progress.kind === "command") {
    if (consoleRun && !consoleRun.finished) {
      if (progress.action === consoleRun.action)
        consoleRun.command = progress.text;
      appendConsole("command", progress.text);
    }
    return;
  }
  if (progress.kind === "output") {
    if (consoleRun && !consoleRun.finished)
      appendConsole(
        progress.stream === "stderr"
          ? "warning"
          : progress.stream === "system"
            ? "command"
            : "output",
        progress.text,
      );
    return;
  }
  if (typeof progress.phase !== "string") return;
  advanceConsole(progress.phase);
  $("status").textContent = progress.phase;
  $("activitySummary").textContent = progress.phase;
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
    syncComponents();
    syncReviewActions();
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
  syncReviewActions();
  navigate("restore");
});

for (const element of document.querySelectorAll("input, textarea, select")) {
  element.addEventListener("input", () => {
    if (
      ["snapshot", "target", "restorePassword", "toolDirectories"].includes(
        element.id,
      )
    ) {
      $("restoreSetup").hidden = true;
      restoreDependencies = null;
    }
    if (element.id === "source") syncComponents();
    if (["restoreDb", "restoreVolumes"].includes(element.id) && element.checked)
      document.querySelector(".mapping-details").open = true;
    syncReviewActions();
  });
  element.addEventListener("change", syncReviewActions);
}
for (const button of document.querySelectorAll("[data-toggle-password]")) {
  button.onclick = () => {
    const field = $(button.dataset.togglePassword),
      show = field.type === "password";
    field.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", (show ? "Hide" : "Show") + " passphrase");
  };
}
