import { readJson, atomicWrite } from "./fs.js";
import type { StoragePaths } from "./fs.js";

export interface UserConfig {
  defaultProvider?: string;
  defaultModel?: string;
  agent?: string;
}

export class ConfigStore {
  readonly #file: string;
  #config: UserConfig;

  constructor(paths: Pick<StoragePaths, "configFile">, initial?: UserConfig) {
    this.#file = paths.configFile;
    this.#config = initial ?? {};
  }

  static async open(paths: Pick<StoragePaths, "configFile">): Promise<ConfigStore> {
    const config = await readJson<UserConfig>(paths.configFile, {});
    return new ConfigStore(paths, config);
  }

  get<K extends keyof UserConfig>(key: K): UserConfig[K] | undefined {
    return this.#config[key];
  }

  set<K extends keyof UserConfig>(key: K, value: UserConfig[K]): void {
    this.#config[key] = value;
  }

  all(): UserConfig {
    return { ...this.#config };
  }

  async save(): Promise<void> {
    await atomicWrite(this.#file, JSON.stringify(this.#config ?? {}, null, 2), 0o600);
  }
}