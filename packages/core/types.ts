/** Trusted caller options. Snapshot data is separately validated before extraction. */
export interface CaptureOptions {
  format?: 1 | 2;
  exclusions?: string[];
  root?: string;
  onProgress?: (phase: string) => void;
  name?: string;
  output?: string;
  password?: string;
  dryRun?: boolean;
  includeDb?: boolean;
  includeVolumes?: boolean;
}
export interface RestoreOptions {
  target?: string;
  onProgress?: (phase: string) => void;
  password?: string;
  dryRun?: boolean;
  restoreDb?: boolean;
  restoreVolumes?: boolean;
  approveVolumes?: boolean;
  approveDb?: boolean;
  dbConfig?: string;
  install?: boolean;
  approveExecution?: boolean;
}
export interface PackageMetadata {
  engines?: { node?: string };
  packageManager?: string;
  scripts?: Record<string, string>;
}
export interface ComposeService {
  platform?: string;
  image?: string;
  ports?: unknown[];
  depends_on?: Record<string, unknown>;
  volumes?: { type?: string; target?: string }[];
}
export interface DatabaseConfig {
  name: string;
  connectionEnv: string;
  excludeSchemas?: string[];
  excludeTables?: string[];
}
export interface VolumeConfig {
  name: string;
  volume: string;
}
export interface WorkspaceConfig {
  exclude?: string[];
  databases?: DatabaseConfig[];
  volumes?: VolumeConfig[];
}
export type SnapshotEntry = {
  path: string;
  mode: number;
  data?: string;
  target?: string;
  size?: number;
  checksum?: string;
} & (
  | { type: "file"; data: string; size: number; checksum: string }
  | { type: "directory" }
  | { type: "symlink"; target: string }
);
export interface DatabaseRecord {
  name: string;
  format: string;
  toolVersion: string;
  serverVersion?: number;
  exclusions?: { schemas: string[]; tables: string[] };
  checksum: string;
  size: number;
  data: string;
}
export interface VolumeRecord {
  name: string;
  format: string;
  checksum: string;
  size: number;
  data: string;
}
export interface Manifest {
  formatVersion: number;
  name: string;
  createdAt: string;
  platform: { os: string; architecture: string };
  runtime: object;
  git: {
    branch: string | null;
    commit: string | null;
    status: string | null;
    indexEntries: string;
  } | null;
  services: object[];
  databases: DatabaseRecord[];
  volumes?: VolumeRecord[];
  editor: object;
  support: object;
  omitted: string[];
  files: SnapshotEntry[];
}
export type CliOptions = CaptureOptions &
  RestoreOptions & {
    start?: boolean;
    cleanup?: string;
    approveCleanup?: boolean;
    pairing?: string;
    pairingOutput?: string;
    bind?: string;
    advertise?: string;
    port?: string;
    timeout?: string;
    approveReceive?: boolean;
    approvePeer?: boolean;
    resume?: boolean;
    snapshot?: string;
    key?: string;
    verifyKey?: string;
    includeGit?: boolean;
  };
