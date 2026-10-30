const $ = (id) => document.getElementById(id);
for (const [button, field, kind] of [
  ["chooseWorkspace", "source", "directory"],
  ["chooseOutput", "output", "directory"],
  ["chooseSnapshot", "snapshot", "snapshot"],
])
  $(button).onclick = async () => {
    const p = await window.teleport.choose(kind);
    if (p) $(field).value = p;
  };
for (const button of document.querySelectorAll("[data-action]"))
  button.onclick = async () => {
    const action = button.dataset.action;
    const input = {
      action,
      source:
        action === "restore"
          ? $("snapshot").value
          : action === "history"
            ? $("output").value || $("source").value
            : $("source").value,
      dryRun: button.dataset.dry === "true",
      name: $("name").value,
      output: $("output").value,
      target: $("target").value,
      password: $(action === "capture" ? "capturePassword" : "restorePassword")
        .value,
      includeDb: $("includeDb").checked,
    };
    await window.teleport.settings({
      source: $("source").value,
      output: $("output").value,
      name: $("name").value,
      target: $("target").value,
    });
    $("status").textContent = "Working…";
    for (const b of document.querySelectorAll("button"))
      b.disabled = b.id !== "cancel";
    try {
      const result = await window.teleport.operation(input);
      $("result").textContent = JSON.stringify(result, null, 2);
      $("status").textContent = "Completed";
    } catch (e) {
      $("result").textContent = e.message;
      $("status").textContent = "Needs attention";
    } finally {
      input.password = "";
      for (const b of document.querySelectorAll("button"))
        b.disabled = b.id === "cancel";
    }
  };

window.teleport
  .settings()
  .then((settings) => {
    for (const key of ["source", "output", "name", "target"])
      if (settings[key]) $(key).value = settings[key];
  })
  .catch((error) => {
    $("result").textContent = error.message;
  });
window.teleport.onProgress((progress) => {
  $("status").textContent = progress.phase + ": " + progress.action;
});
$("cancel").onclick = () => window.teleport.cancel();
