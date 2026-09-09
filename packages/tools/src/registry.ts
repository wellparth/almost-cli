import type { AgentTool } from "@almost/agent-core";
import { wrapTool } from "./result.js";
import {
  deleteFileTool,
  editFileTool,
  listDirectoryTool,
  readFileTool,
  writeFileTool,
} from "./filesystem.js";
import { grepTool, searchFilesTool } from "./search.js";
import { shellTool } from "./shell.js";
import { fetchUrlTool } from "./network.js";
import { gitBranchTool, gitDiffTool, gitLogTool, gitStatusTool } from "./git.js";

export const BUILTIN_TOOLS: AgentTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  listDirectoryTool,
  searchFilesTool,
  grepTool,
  shellTool,
  fetchUrlTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
].map(wrapTool);

export function buildToolRegistry(): Map<string, AgentTool> {
  return new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool]));
}

export function resolveTools(names: string[], registry: Map<string, AgentTool>): AgentTool[] {
  return names.map((name) => {
    const tool = registry.get(name);
    if (!tool) throw new Error(`unknown tool '${name}'`);
    return tool;
  });
}