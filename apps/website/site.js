const recipes = {
  start: {
    title: "First snapshot",
    code: document.querySelector("#recipe-code").textContent,
    note: "Capture prompts for a hidden passphrase. Keep it safe; there is no password recovery.",
  },
  restore: {
    title: "Restore & verify",
    code: `# Move my-project.dtp to this machine first
# Choose a NEW destination folder
devteleport restore ./snapshots/my-project.dtp --target ./restored-project --dry-run

# Reconstruct saved state · enter your passphrase
devteleport restore ./snapshots/my-project.dtp --target ./restored-project

# Compare against authenticated snapshot metadata
devteleport verify ./restored-project --snapshot ./snapshots/my-project.dtp`,
    note: "Ordinary restore executes no project code. Provision excluded secrets and dependencies separately.",
  },
  diff: {
    title: "Compare changes",
    code: `# Compare a snapshot with the current folder
devteleport diff ./snapshots/my-project.dtp ./my-project

# Compare two encrypted checkpoints
devteleport diff ./snapshots/old.dtp --snapshot ./snapshots/new.dtp

# Include Git internals in the comparison
devteleport diff ./snapshots/my-project.dtp ./my-project --include-git

# Browse locally stored snapshots
devteleport history ./snapshots`,
    note: "Diff reports added, removed and modified files. Exit code 2 means differences were found.",
  },
  transfer: {
    title: "Pair & transfer · experimental",
    code: `# RECEIVER · replace with its reachable LAN address
# Use a protected pairing descriptor location
devteleport receive --target ./received.dtp --pairing-output /private/path/pairing.json --bind 0.0.0.0 --advertise 192.168.1.20 --approve-receive

# Share the descriptor through a trusted channel
# SENDER · inspect and compare receiver fingerprint
devteleport pairing-info --pairing /private/path/pairing.json

# Approve this peer and send the encrypted snapshot
devteleport send ./snapshots/my-project.dtp --pairing /private/path/pairing.json --approve-peer`,
    note: "Requires protected descriptor sharing and fingerprint comparison. Physical two-Mac acceptance is still pending.",
  },
  sign: {
    title: "Sign a snapshot",
    code: `# Generate encrypted Ed25519 signing keys
devteleport keygen --target /secure/path/signing-key

# Sign the encrypted snapshot
devteleport sign ./snapshots/my-project.dtp --key /secure/path/signing-key.private.pem

# Verify using an independently trusted public key
devteleport check-signature ./snapshots/my-project.dtp --key /trusted/path/signing-key.public.pem

# Require that key when restoring
devteleport restore ./snapshots/my-project.dtp --target ./restored-project --verify-key /trusted/path/signing-key.public.pem`,
    note: "Transfer .sig sidecars separately. A passphrase authenticates bytes; a trusted signature establishes provenance.",
  },
};

const screens = {
  overview: [
    "desktop-overview.png",
    "Real DevTeleport desktop overview with workspace selector, capture and restore actions, and recent snapshots.",
  ],
  capture: [
    "desktop-capture.png",
    "Real DevTeleport capture screen showing included files and Git, optional components, passphrase controls and capture review.",
  ],
  restore: [
    "desktop-restore.png",
    "Real DevTeleport restore screen showing new destination, component selections and restore review.",
  ],
  light: [
    "desktop-light.png",
    "DevTeleport workspace overview in the matching light theme.",
  ],
};

function highlightCode() {
  const code = document.querySelector("#recipe-code");
  const lines = code.textContent.split("\n");
  code.replaceChildren();
  lines.forEach((line, index) => {
    const span = document.createElement("span");
    span.className = line.startsWith("#") ? "comment" : "command";
    span.textContent = line + (index < lines.length - 1 ? "\n" : "");
    code.append(span);
  });
}
highlightCode();

function selectTab(button) {
  const tablist = button.closest('[role="tablist"]');
  for (const tab of tablist.querySelectorAll('[role="tab"]')) {
    const selected = tab === button;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const panel = document.getElementById(button.getAttribute("aria-controls"));
  panel.setAttribute("aria-labelledby", button.id);
  if (button.dataset.recipe) {
    const recipe = recipes[button.dataset.recipe];
    document.querySelector("#recipe-title").textContent = recipe.title;
    document.querySelector("#recipe-code").textContent = recipe.code;
    const note = document.querySelector("#recipe-note");
    const dot = document.createElement("span");
    dot.className = "status-dot";
    note.replaceChildren(dot, document.createTextNode(recipe.note));
    highlightCode();
  } else {
    const [file, alt] = screens[button.dataset.screen];
    const image = document.querySelector("#desktop-image");
    image.src = `assets/${file}`;
    image.alt = alt;
    panel.scrollTop = 0;
    panel.scrollLeft = 0;
  }
}

for (const tablist of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      const vertical = tablist.getAttribute("aria-orientation") === "vertical";
      const nextKey = vertical ? "ArrowDown" : "ArrowRight";
      const previousKey = vertical ? "ArrowUp" : "ArrowLeft";
      let next;
      if (event.key === nextKey) next = (index + 1) % tabs.length;
      if (event.key === previousKey)
        next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  });
}

let statusTimeout;
const copyStatus = document.querySelector(".copy-status");
function announce(message) {
  clearTimeout(statusTimeout);
  copyStatus.textContent = message;
  copyStatus.classList.add("visible");
  statusTimeout = setTimeout(
    () => copyStatus.classList.remove("visible"),
    2800,
  );
}
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      announce("Copied to clipboard");
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(source);
      selection.removeAllRanges();
      selection.addRange(range);
      announce("Command selected. Press ⌘C or Ctrl+C to copy.");
    }
  });
}

const menu = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#navigation");
function closeMenu() {
  navigation.classList.remove("open");
  menu.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-label", "Open navigation");
}
menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  menu.setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
  navigation.classList.toggle("open", open);
});
navigation.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
    menu.focus();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".nav-row")) closeMenu();
});
