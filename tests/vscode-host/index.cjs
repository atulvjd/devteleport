const vscode = require("vscode");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
exports.run = async () => {
  assert.equal(process.arch, process.env.DTP_TEST_EXPECT_ARCH);
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath,
    temp = path.dirname(root);
  const cfg = vscode.workspace.getConfiguration("devteleport");
  await cfg.update(
    "nodePath",
    process.env.DTP_TEST_NODE,
    vscode.ConfigurationTarget.Global,
  );
  await cfg.update(
    "cliPath",
    process.env.DTP_TEST_CLI,
    vscode.ConfigurationTarget.Global,
  );
  const extension = vscode.extensions.getExtension(
    "devteleport-local.devteleport",
  );
  assert(extension);
  const api = await extension.activate();
  if (process.env.DTP_TEST_UNTRUSTED === "1") {
    api.setDialogResponses({});
    await vscode.commands.executeCommand("devteleport.capture");
    assert.match(api.getLastError(), /Trust the workspace/);
    await fs.writeFile(
      path.join(temp, "host-result.json"),
      JSON.stringify({ passed: true, untrustedCaptureRefused: true }),
    );
    return;
  }

  const call = async (action, responses = {}) => {
    api.setDialogResponses(responses);
    const result = await vscode.commands.executeCommand(
      "devteleport." + action,
    );
    assert.equal(api.getLastError(), null);
    return result || api.getLastResult();
  };
  const report = await call("inspect");
  assert.equal(await fs.realpath(report.root), await fs.realpath(root));
  await vscode.window.showTextDocument(
    vscode.Uri.file(path.join(root, "hello.txt")),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    vscode.Uri.file(path.join(root, "hello.txt")),
    new vscode.Range(0, 0, 0, 9),
    "saved dirty host",
  );
  assert(await vscode.workspace.applyEdit(edit));
  await call("capture", {
    showInputBox: ["host-test", "extension host test password"],
    showOpenDialog: [[vscode.Uri.file(temp)]],
    showInformationMessage: ["Capture"],
    showWarningMessage: ["Save all"],
  });
  await fs.stat(path.join(temp, "host-test.dtp"));
  const session = JSON.parse(
    await fs.readFile(
      path.join(root, ".vscode", "devteleport-session.json"),
      "utf8",
    ),
  );
  assert(session.tabs.includes("hello.txt"));
  await call("capture", { showInputBox: [undefined] }); // real cancellation path, no new archive
  const target = path.join(temp, "restored");
  await call("restore", {
    showOpenDialog: [[vscode.Uri.file(path.join(temp, "host-test.dtp"))]],
    showInputBox: [target, "extension host test password"],
    showInformationMessage: ["Restore", undefined],
  });
  assert.equal(
    await fs.readFile(path.join(target, "hello.txt"), "utf8"),
    "saved dirty host",
  );
  api.setDialogResponses({ showInformationMessage: ["Reopen"] });
  const opened = await api.reopenSavedFiles(target);
  assert(opened.includes(await fs.realpath(path.join(target, "hello.txt"))));
  assert.equal(
    vscode.window.activeTextEditor.document.getText(),
    "saved dirty host",
  );
  await fs.writeFile(
    path.join(root, "cancel.bin"),
    require("node:crypto").randomBytes(16 * 1024 * 1024),
  );
  api.setDialogResponses({
    showInputBox: ["cancel-in-flight", "extension host test password"],
    showOpenDialog: [[vscode.Uri.file(temp)]],
    showInformationMessage: ["Capture"],
  });
  const cancelled = vscode.commands.executeCommand("devteleport.capture");
  for (let i = 0; i < 200 && !api.isBusy(); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert(api.isBusy());
  await vscode.commands.executeCommand("devteleport.cancel");
  await cancelled;
  assert.match(api.getLastError(), /cancelled/);
  await assert.rejects(fs.stat(path.join(temp, "cancel-in-flight.dtp")));
  await fs.unlink(path.join(root, "cancel.bin"));
  await call("history");
  api.setDialogResponses({});
  const verified = await vscode.commands.executeCommand(
    "devteleport.verify",
    target,
  );
  assert(verified.ok);
  await fs.writeFile(
    path.join(temp, "host-result.json"),
    JSON.stringify({
      passed: true,
      commands: [
        "inspect",
        "capture",
        "capture cancellation",
        "restore",
        "history",
      ],
      savedTabs: session.tabs,
    }),
  );
};
