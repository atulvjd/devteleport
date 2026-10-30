import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
const exec = promisify(execFile);
const IMAGE = "python:3.13-alpine";
const valid = (name: string) =>
  typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name);
async function docker(args: string[], extra = {}) {
  try {
    return (
      await exec("docker", args, {
        maxBuffer: 34 * 1024 * 1024,
        timeout: 180000,
        ...extra,
      })
    ).stdout;
  } catch {
    throw new Error(
      "Docker volume operation failed. Check daemon, image availability, volume permissions and diagnostics.",
    );
  }
}
async function helper(
  volume: string,
  readonly: boolean,
  code: string,
  input: Buffer | undefined,
) {
  if (!valid(volume)) throw new Error("Invalid Docker named volume");
  const name = "devteleport-" + crypto.randomUUID();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = execFile(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          name,
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "-i",
          "--mount",
          `type=volume,src=${volume},dst=/data${readonly ? ",readonly" : ""}`,
          IMAGE,
          "python",
          "-c",
          code,
        ],
        { encoding: "buffer", maxBuffer: 34 * 1024 * 1024, timeout: 180000 },
        (error, stdout) =>
          error
            ? reject(
                new Error(
                  "Isolated Docker volume adapter failed; unsafe paths, permissions, size limits or nonempty data may be the cause.",
                ),
              )
            : resolve(stdout),
      );
      child.stdin?.end(input);
    });
  } finally {
    await docker(["rm", "-f", name]).catch(() => {});
  }
}
export async function captureVolume(volume: string) {
  const info = JSON.parse(
    String(await docker(["volume", "inspect", volume])),
  )[0];
  if (info.Driver !== "local" || Object.keys(info.Options || {}).length)
    throw new Error("Only plain local named Docker volumes are supported.");
  return helper(
    volume,
    true,
    `import os,sys,tarfile
root='/data'
count=total=0
for base,dirs,files in os.walk(root,followlinks=False):
 for name in dirs+files:
  p=os.path.join(base,name);count+=1
  if os.path.islink(p):
   if not os.path.realpath(p).startswith(root+'/'): raise RuntimeError('unsafe symlink')
  elif os.path.isfile(p): total+=os.path.getsize(p)
  elif not os.path.isdir(p): raise RuntimeError('special file')
  if count>50000 or total>134217728: raise RuntimeError('volume too large')
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz',dereference=False) as archive:
 for name in sorted(os.listdir(root)): archive.add(os.path.join(root,name),arcname=name)
`,
    undefined,
  );
}
export async function restoreVolume(volume: string, data: Buffer) {
  if (!valid(volume)) throw new Error("Invalid Docker named volume");
  const owner = crypto.randomUUID();
  // Docker create is idempotent: verify our random ownership label to refuse preexisting volumes.
  await docker([
    "volume",
    "create",
    "--label",
    `devteleport.owner=${owner}`,
    volume,
  ]);
  const info = JSON.parse(
    String(await docker(["volume", "inspect", volume])),
  )[0];
  if (info.Labels?.["devteleport.owner"] !== owner)
    throw new Error(
      "Destination Docker volume already exists; choose a new name.",
    );
  try {
    await helper(
      volume,
      false,
      `import os,sys,tarfile,io
if os.listdir('/data'): raise RuntimeError('destination not empty')
data=sys.stdin.buffer.read(33554433)
if len(data)>33554432: raise RuntimeError('archive too large')
with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
 members=archive.getmembers()
 if len(members)>50000 or sum(m.size for m in members)>134217728: raise RuntimeError('expanded volume too large')
 for m in members:
  if m.name.startswith('/') or '..' in m.name.split('/') or not (m.isfile() or m.isdir() or m.issym() or m.islnk()): raise RuntimeError('unsafe archive entry')
  tarfile.data_filter(m,'/data')
 archive.extractall('/data',members=members,filter='data')
`,
      data,
    );
  } catch (error) {
    await docker(["volume", "rm", volume]).catch(() => {});
    throw error;
  }
  return { volume, status: "restored to new owned local volume" };
}
