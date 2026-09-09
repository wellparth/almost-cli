import { defaultPaths } from "./fs.js";
import type { StoragePaths } from "./fs.js";
import { ConfigStore } from "./config-store.js";
import { CredentialStore } from "./credential-store.js";
import { DiskSessionStore } from "./session-store.js";

export interface AppState {
  paths: StoragePaths;
  config: ConfigStore;
  credentials: CredentialStore;
  sessions: DiskSessionStore;
}

export async function openStorage(paths: StoragePaths = defaultPaths()): Promise<AppState> {
  const config = await ConfigStore.open(paths);
  const credentials = await CredentialStore.open(paths);
  const sessions = new DiskSessionStore(paths.sessionsDir);
  return { paths, config, credentials, sessions };
}

export * from "./fs.js";
export * from "./config-store.js";
export * from "./credential-store.js";
export * from "./session-store.js";