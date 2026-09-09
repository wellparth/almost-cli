import { OpenAICompatibleProvider } from "@almost/providers-core";
import type { ModelProvider } from "@almost/agent-core";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_API_KEY_ENV = "NVIDIA_API_KEY";

export function createNVIDIAProvider(): ModelProvider {
  return new OpenAICompatibleProvider({
    id: "nvidia",
    baseUrl: NVIDIA_BASE_URL,
    apiKeyEnvVar: NVIDIA_API_KEY_ENV,
    capabilities: ["streaming", "tool_calling", "parallel_tool_calls", "reasoning"],
  });
}