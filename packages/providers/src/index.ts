import { ProviderRegistry } from "@almost/providers-core";
import { createOpenAIProvider } from "@almost/providers-openai";
import { createGeminiProvider } from "@almost/providers-gemini";
import { createDeepSeekProvider } from "@almost/providers-deepseek";
import { createNVIDIAProvider } from "@almost/providers-nvidia";

export function createBuiltinRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register("openai", createOpenAIProvider);
  registry.register("gemini", createGeminiProvider);
  registry.register("deepseek", createDeepSeekProvider);
  registry.register("nvidia", createNVIDIAProvider);
  return registry;
}

export const BUILTIN_PROVIDERS = ["openai", "gemini", "deepseek", "nvidia"] as const;