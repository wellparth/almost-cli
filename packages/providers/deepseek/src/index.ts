import { OpenAICompatibleProvider } from "@almost/providers-core";
import type { ModelProvider } from "@almost/agent-core";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";

export function createDeepSeekProvider(): ModelProvider {
  return new OpenAICompatibleProvider({
    id: "deepseek",
    baseUrl: DEEPSEEK_BASE_URL,
    apiKeyEnvVar: DEEPSEEK_API_KEY_ENV,
    capabilities: ["streaming", "tool_calling", "parallel_tool_calls", "reasoning"],
  });
}