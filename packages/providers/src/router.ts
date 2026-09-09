import type { ModelProvider, Capability } from "@almost/agent-core";

export type RouterStrategy =
  | "primary-fallback"
  | "load-balance"
  | "capability";

export interface RoutingConfig {
  strategy: RouterStrategy;
  /** Order of providers to try when using primary-fallback or load-balance. */
  providerOrder?: string[];
}

/**
 * Routes a model request to the best available provider/model.
 *
 * Supported strategies:
 * - primary-fallback: tries providers in the configured order; picks the first
 *   that can generate (i.e. has at least one model listed).
 * - load-balance: spreads requests across available providers (simple round-robin
 *   stub — always picks the first provider).
 * - capability: picks a provider that supports the given Capability.
 */
export interface RouteResult {
  provider: ModelProvider;
  model: string;
}

export class ModelRouter {
  readonly #config: RoutingConfig;

  constructor(config: RoutingConfig = { strategy: "primary-fallback" }) {
    this.#config = config;
  }

  /** Pick a provider from the candidate list according to the configured strategy. */
  async route(candidates: ModelProvider[], neededCapability?: Capability): Promise<RouteResult> {
    if (this.#config.strategy === "capability" && neededCapability) {
      for (const p of candidates) {
        if (p.supports(neededCapability)) {
          const models = await p.listModels();
          const model = models[0]?.id ?? "default";
          return { provider: p, model };
        }
      }
    }

    // primary-fallback or default: try providers in configured order
    const order = this.#config.providerOrder ?? candidates.map((p) => p.id);
    for (const id of order) {
      const p = candidates.find((p) => p.id === id);
      if (!p) continue;
      if (neededCapability && !p.supports(neededCapability)) continue;
      const models = await p.listModels();
      const model = models[0]?.id ?? "default";
      return { provider: p, model };
    }

    // fallback: first candidate
    const first = candidates[0];
    if (first) {
      return { provider: first, model: "default" };
    }
    throw new Error("no candidates available");
  }
}