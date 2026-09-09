# Roadmap

Implemented against the technical specification in the project plan. Each phase
is tracked as a GitHub issue (#1–#11). Status reflects what has landed on `main`.

## Phase 0 — Architecture ✅

Type safe skeleton: core types, provider/agent/tool/event/permission interfaces, monorepo scaffold, CI. (`@almost/agent-core`, PR #12, #13; issue #1)

## Phase 1 — Single Agent ✅

Single-agent coding loop: streaming, tool calling, permission system, filesystem/search/shell/git tools. (`@almost/tools`, `@almost/agent-runtime`; PRs #16, #18; issue #2)

## Phase 2 — Four Providers ✅

OpenAI, Gemini, DeepSeek, NVIDIA NIM adapters, BYOK credentials, model discovery. (`@almost/providers` family; PR #15; issue #3)

## Phase 3 — Context Engine ✅

Session store, event log, CLI session persistence, config + credentials storage. (`@almost/storage`, CLI `sessions`/`config`/`auth`; PRs #17, #19; issue #4)

## Phase 4 — Built In Agents ✅

Built-in coding agent definition: system prompt, tool set, permission defaults, myagent CLI (`run`, REPL, `init`, `auth`, `models`, `config`, `sessions`). (`@almost/agents`, `apps/cli`, CI checks; PR #19; issue #5)

## Phase 5 — Orchestrator ✅

Task graph, dependency resolver, scheduler, event bus, task outcomes and failure handling (failures cancel descendants). (`@almost/orchestrator`; PR #22; issue #6)

## Phase 6 — Parallel Agents

Concurrent execution, resource locks, task isolation, agent worktrees, conflict detection. (issue #7)

## Phase 7 — Custom Agents

`agent create`, custom prompts/models/tools/permissions. (issue #8)

## Phase 8 — MCP

MCP client, server config, tool discovery, permissions, lifecycle. (issue #9)

## Phase 9 — Security Hardening

Prompt injection defense, sandboxing, secret protection, audit logs, network controls. (issue #10)

## Phase 10 — Advanced Agent Runtime

Subagents, model routing, agent delegation, adaptive workflows, parallel planning. (issue #11)