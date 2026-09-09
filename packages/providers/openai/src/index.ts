import { OpenAICompatibleProvider } from "@almost/providers-core";
import type { ModelProvider } from "@almost/agent-core";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

export function createOpenAIProvider(): ModelProvider {
  return new OpenAICompatibleProvider({
    id: "openai",
    baseUrl: OPENAI_BASE_URL,
    apiKeyEnvVar: OPENAI_API_KEY_ENV,
    capabilities: ["streaming", "tool_calling", "parallel_tool_calls", "structured_output", "context_caching"],
  });
}

export { OpenAICompatibleProvider } from "@almost/providers-core";