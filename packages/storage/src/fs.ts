import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export async function atomicWrite(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, content, "utf8");
  if (mode !== undefined) await chmod(tmp, mode);
  await rename(tmp, path);
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export interface StoragePaths {
  root: string;
  configFile: string;
  credentialsFile: string;
  sessionsDir: string;
}

export function defaultPaths(): StoragePaths {
  const root = process.env.MYAGENT_HOME ?? join(homedir(), ".myagent");
  return {
    root,
    configFile: join(root, "config.json"),
    credentialsFile: join(root, "credentials.json"),
    sessionsDir: join(root, "sessions"),
  };
}