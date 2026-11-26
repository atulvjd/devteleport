import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { readEnvironmentFile } from "./environment.ts";
import { setupDirectory } from "./setup.ts";
import { execText } from "./processes.ts";
import {
  activityLineSink,
  activitySecrets,
  type ActivityOutput,
} from "./activity.ts";

/** Review the exact manifest-backed command before running project code. */
export async function runProject(
  directory: string,
  options: {
    packageDirectory?: string;
    script?: string;
    dryRun?: boolean;
    planId?: string;
    approveExecution?: boolean;
    onLog?: (event: ActivityOutput) => void;
  },
) {
  const root = await fs.realpath(directory);
  const plan = await setupDirectory(root);
  const commands = plan.packages.flatMap((pkg) =>
    ["npm", "pnpm", "yarn", "bun"].includes(pkg.manager)
      ? pkg.scripts.map((script) => ({
          directory: pkg.directory,
          script: script.name,
          command: [pkg.manager, "run", script.name],
          definition: script.command,
        }))
      : [],
  );
  if (options.dryRun)
    return {
      root,
      id: plan.id,
      commands,
      warning:
        "Starting a project executes its scripts with your user permissions. Review the command and project first.",
    };
  if (
    !options.approveExecution ||
    !options.planId ||
    options.planId !== plan.id
  )
    throw new Error(
      "Review startup commands again and explicitly approve the current plan before running.",
    );
  const selected = commands.find(
    (command) =>
      command.directory === options.packageDirectory &&
      command.script === options.script,
  );
  if (!selected)
    throw new Error("Choose a startup command from the reviewed project.");
  const cwd = await fs.realpath(path.resolve(root, selected.directory));
  if (cwd !== root && !cwd.startsWith(root + path.sep))
    throw new Error("Startup directory escapes project");
  const env = { ...process.env };
  delete env.DEVTELEPORT_PASSWORD;
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const secrets = activitySecrets();
  // Mask values from project env files in displayed logs, without loading them into
  // the process environment. Frameworks retain their own env-file semantics.
  for (const name of await fs.readdir(cwd)) {
    if (!/^\.env(?:\.|$)/.test(name)) continue;
    const file = path.join(cwd, name),
      stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;
    const handle = await fs.open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const text = await readEnvironmentFile(handle);
      if (text === null) continue;
      for (const match of text.matchAll(
        /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/gm,
      )) {
        const value = match[1].trim().replace(/^['"]|['"]$/g, "");
        if (value.length >= 4) secrets.push(value);
      }
    } finally {
      await handle.close();
    }
  }
  const stdout = activityLineSink(
    (text) => options.onLog?.({ stream: "stdout", text }),
    secrets,
  );
  const stderr = activityLineSink(
    (text) => options.onLog?.({ stream: "stderr", text }),
    secrets,
  );
  try {
    await execText(selected.command[0], selected.command.slice(1), {
      cwd,
      env,
      streamOnly: true,
      onOutput: (stream, chunk) =>
        (stream === "stdout" ? stdout : stderr).write(chunk),
    });
    return { root, command: selected, state: "exited", exitCode: 0 };
  } catch {
    throw new Error(
      "Project process stopped or exited unsuccessfully. Review the live log for details.",
    );
  } finally {
    stdout.end();
    stderr.end();
  }
}
