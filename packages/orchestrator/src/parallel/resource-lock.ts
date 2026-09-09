/**
 * Serializes access to shared resources across concurrent tasks. Locks are
 * keyed by an arbitrary string and form a FIFO queue per key, so callers of
 * `withLock` for the same key never overlap, while different keys run in
 * parallel.
 */
export class LockRegistry {
  readonly #tails = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(
      () => current,
      () => current,
    );
    this.#tails.set(key, tail);
    await prev.catch(() => undefined); // wait for every earlier holder of the key
    try {
      return await fn();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }

  /** Unique keys currently held or queued. */
  get size(): number {
    return this.#tails.size;
  }
}