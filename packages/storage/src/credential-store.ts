import { readJson, atomicWrite } from "./fs.js";
import type { StoragePaths } from "./fs.js";

/**
 * Stores only env-var names -> values the user explicitly supplies via
 * `myagent auth`. Per plan section 13, provider API keys are read from the
 * ambient environment first; this file is a convenience for keys not present
 * in the shell environment. File is chmod 600.
 */
export class CredentialStore {
  readonly #file: string;
  #creds: Record<string, string>;

  constructor(paths: Pick<StoragePaths, "credentialsFile">, initial?: Record<string, string>) {
    this.#file = paths.credentialsFile;
    this.#creds = initial ?? {};
  }

  static async open(paths: Pick<StoragePaths, "credentialsFile">): Promise<CredentialStore> {
    const creds = await readJson<Record<string, string>>(paths.credentialsFile, {});
    return new CredentialStore(paths, creds);
  }

  set(name: string, value: string): void {
    this.#creds[name] = value;
  }

  has(name: string): boolean {
    return name in this.#creds;
  }

  get(name: string): string | undefined {
    return this.#creds[name];
  }

  keys(): string[] {
    return Object.keys(this.#creds);
  }

  /** Resolve a value from stored creds, falling back to the ambient env. */
  resolve(name: string): string | undefined {
    return this.#creds[name] ?? process.env[name];
  }

  async save(): Promise<void> {
    await atomicWrite(this.#file, JSON.stringify(this.#creds ?? {}, null, 2), 0o600);
  }
}