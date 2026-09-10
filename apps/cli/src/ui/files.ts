// @ file reference autocomplete (issue #35).
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".pnpm", "coverage", ".next", ".cache"]);

/** Extract the token after the last "@" in the prompt, if it's a file ref. */
export function fileRefToken(prompt: string): string | undefined {
  const idx = prompt.lastIndexOf("@");
  if (idx < 0) return undefined;
  const token = prompt.slice(idx + 1);
  // Only complete simple paths — no spaces, and the "@" is preceded by a boundary.
  if (token.includes(" ")) return undefined;
  const before = idx === 0 ? "" : prompt[idx - 1];
  if (before && /[\w]/.test(before)) return undefined;
  return token;
}

/** Fuzzy-prefix file suggestions for the given token (capped at depth 3). */
export async function suggestFiles(prefix: string, limit = 6): Promise<string[]> {
  const root = process.cwd();
  const matches: string[] = [];
  try {
    await walk(root, prefix, 3, matches, limit * 4);
  } catch {
    return matches;
  }
  return matches.slice(0, limit);
}

async function walk(dir: string, prefix: string, depth: number, out: string[], budget: number): Promise<void> {
  if (depth < 0 || out.length >= budget) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= budget) return;
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(process.cwd(), full).split(sep).join("/");
    if (entry.isDirectory()) {
      if (rel.startsWith(prefix)) out.push(`${rel}/`);
      await walk(full, prefix, depth - 1, out, budget);
    } else if (rel.startsWith(prefix)) {
      out.push(rel);
    }
  }
}