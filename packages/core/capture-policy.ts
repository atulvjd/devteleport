import type { CaptureOptions } from "./types.ts";

export const generatedDirectories = new Set([
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "coverage",
]);

export const ENTRY_LIMIT_ERROR =
  "Too many workspace entries (limit: 50,000 files and folders). Enable Skip dependencies & build caches, or add capture exclusions, then review again. You can keep Include ignored files & secrets enabled to capture .env. No snapshot was created.";

export function capturePolicy(
  options: Pick<CaptureOptions, "includeIgnored" | "excludeGenerated">,
) {
  return {
    includeIgnored: Boolean(options.includeIgnored),
    ...(options.excludeGenerated ? { excludeGenerated: true } : {}),
  };
}

export function generatedWarnings(policy: { excludeGenerated?: boolean } = {}) {
  return policy.excludeGenerated
    ? [
        "Dependency folders and build caches are excluded at every project level: " +
          [...generatedDirectories].join(", ") +
          ". Review the omitted paths. Install dependencies after restore; generated outputs must be rebuilt.",
      ]
    : [];
}
