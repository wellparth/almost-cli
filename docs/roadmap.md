# Roadmap

Implemented against the technical specification in the project plan. Each phase below
is tracked as a GitHub milestone. Phases map to `docs/` and package structure.

## Phase 0 — Architecture

Type safe skeleton: core types, provider/agent/tool/event/permission interfaces.

## Phase 1 — Single Agent

A reliable coding agent: one provider, streaming, tool calling, filesystem tools,
search, shell, git, permission system.

## Phase 2 — Four Providers

OpenAI, Gemini, DeepSeek, NVIDIA NIM adapters, BYOK credentials, model discovery,
capability detection.

## Phase 3 — Context Engine

Repository map, token budget, context selection, history, compaction, task state.

## Phase 4 — Built In Agents

Architect, Planner, Builder, Tester, Debugger.

## Phase 5 — Orchestrator

Task graph, dependency resolver, scheduler, agent state, event bus, failure handling.

## Phase 6 — Parallel Agents

Concurrent execution, resource locks, task isolation, agent worktrees, conflict detection.

## Phase 7 — Custom Agents

`agent create`, custom prompts/models/tools/permissions.

## Phase 8 — MCP

MCP client, server config, tool discovery, permissions, lifecycle.

## Phase 9 — Security Hardening

Prompt injection defense, sandboxing, secret protection, audit logs, network controls.

## Phase 10 — Advanced Agent Runtime

Subagents, model routing, agent delegation, adaptive workflows, parallel planning.