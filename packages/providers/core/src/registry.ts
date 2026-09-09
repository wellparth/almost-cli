import type { ModelProvider } from "@almost/agent-core";

export type ProviderFactory = () => ModelProvider;

export class ProviderRegistry {
  readonly #factories = new Map<string, ProviderFactory>();

  register(id: string, factory: ProviderFactory): void {
    this.#factories.set(id, factory);
  }

  has(id: string): boolean {
    return this.#factories.has(id);
  }

  get(id: string): ModelProvider {
    const factory = this.#factories.get(id);
    if (!factory) throw new Error(`unknown provider '${id}'`);
    return factory();
  }

  ids(): string[] {
    return Array.from(this.#factories.keys());
  }
}