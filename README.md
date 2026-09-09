# almost-cli

A provider agnostic, strictly **BYOK** (Bring Your Own Key) multi agent coding CLI.

Connect your own AI API keys (OpenAI, Gemini, DeepSeek, NVIDIA NIM) and run a team of
specialized agents — Architect, Planner, Builder, Tester, Debugger — against a local
codebase. No hosted inference. No bundled models. No backend account.

## Architecture

```text
                    User
                     |
                     v
                  CLI / TUI
                     |
                     v
              Agent Orchestrator
                     |
       +------------+------------+
       |            |            |
       v            v            v
  Agent Runtime  Context      Permission
       |          Engine         Engine
       |
       +------------------+------------------+
       |                  |                  |
       v                  v                  v
    Planner            Builder          Architect
       |                  |                  |
       +------------------+------------------+
                          |
              +-----------+-----------+
              |           |           |
              v           v           v
           Tester     Debugger    Custom Agents
                          |
                          v
                    Tool Runtime
                          |
        +-----------------+-----------------+
        |        |        |       |         |
        v        v        v       v         v
    Filesystem Shell     Git     Search     MCP
                          |
                          v
                  Model Provider
                          |
        +-----------------+-----------------+
        |                 |                 |
        v                 v                 v
     OpenAI            Gemini         DeepSeek / NIM
```

Design principles: strict BYOK, local first, provider agnostic, capability driven,
agents are configurable (agent identity is separate from model identity).

## Repository layout

```text
apps/cli                    CLI entry point (bin: myagent)
packages/agent-core         Core types and interfaces
packages/providers/*        Model provider adapters
packages/tools/*            Tool runtime (filesystem, shell, git, search)
packages/permissions        Permission engine
packages/context            Context engine
packages/orchestrator       Multi agent orchestration
packages/sessions           Session system
packages/storage            Local persistence
packages/agent-definitions  Built in + custom agent definitions
agents/*                    Built in agent implementations
docs/                       Design and roadmap
tests/                      Workspace level tests
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Roadmap

See [docs/roadmap.md](docs/roadmap.md).

## License

TBD (see project plan section 43).