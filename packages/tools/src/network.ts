// Outbound network access tool. Gated by the "network" permission (denied by
// default) AND the network policy evaluated by the runner's permission checker
// (the URL is passed as the check detail). Returns text only.

import type { AgentTool, ToolContext, ToolResult } from "@almost/agent-core";
import { denied } from "./result.js";

const MAX_NETWORK_OUTPUT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export const fetchUrlTool: AgentTool = {
  name: "fetch_url",
  description:
    "Fetch a remote URL and return its text content. Requires 'network' permission; the network policy must allow the host.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL to fetch" },
      headers: { type: "object", additionalProperties: { type: "string" }, description: "Optional request headers" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  permissions: ["network"],
  async execute(input, ctx): Promise<ToolResult> {
    const { url, headers } = input as { url: string; headers?: Record<string, string> };
    if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "url must be an http(s) URL" };
    const decision = await ctx.permissions.check("network", url);
    if (decision.verdict !== "allowed") return denied(decision);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { accept: "text/*,application/json,application/xml", ...headers },
        redirect: "follow",
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const isText =
        contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml");
      if (!isText) {
        const ok = response.ok;
        return {
          ok: true,
          output: `GET ${url} -> ${response.status} (content-type: ${contentType || "unknown"}, body not text)`,
          meta: { status: response.status, ok },
        };
      }
      const size = Number(response.headers.get("content-length") ?? 0);
      if (size > MAX_NETWORK_OUTPUT) {
        return { ok: true, output: `GET ${url} -> ${response.status} (body too large: ${size} bytes)` };
      }
      const text = await response.text();
      const truncated = text.length > MAX_NETWORK_OUTPUT ? text.slice(0, MAX_NETWORK_OUTPUT) + "\n... (truncated)" : text;
      return { ok: true, output: `GET ${url} -> ${response.status}\n\n${truncated}`, meta: { status: response.status } };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, error: `request to ${url} timed out after ${DEFAULT_TIMEOUT_MS}ms` };
      }
      return { ok: false, error: `request to ${url} failed: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      clearTimeout(timer);
    }
  },
};