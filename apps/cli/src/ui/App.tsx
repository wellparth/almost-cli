import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AppState } from "@almost/storage";
import { openStorage, defaultPaths } from "@almost/storage";
import { createBuiltinRegistry } from "@almost/providers";
import { buildRunner, injectCredentials, providerAuthEnvNames } from "../runner.js";
import type { Runner } from "../runner.js";
import { executeRun, persistTurn } from "../repl.js";
import { openPersistence } from "../persistence.js";
import type { SessionPersistence } from "../persistence.js";
import { ChatPane } from "./ChatPane.js";
import { InputPane, type Suggestion } from "./InputPane.js";
import { PromptPane } from "./PromptPane.js";
import { StatusBar } from "./StatusBar.js";
import { newMessage, type Message } from "./state.js";
import { resolveTheme, type Theme } from "./themes.js";
import { loadTuiConfig, DEFAULT_TUI_CONFIG, type TuiConfig } from "./config.js";
import { resolveLeaderAction, type LeaderAction } from "./keybinds.js";
import { isSlashCommand, isAppCommand, commandName, slashToken, runSlashCommand, COMMAND_HELP, type PickerItem } from "./commands.js";
import { fileRefToken, suggestFiles } from "./files.js";
import { PickerPane, type PickerState } from "./PickerPane.js";

export default function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [leadingAction, setLeadingAction] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [thinking, setThinking] = useState(true);
  const [details, setDetails] = useState(false);
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [credentialPrompt, setCredentialPrompt] = useState<{ envVar: string; label: string } | null>(null);
  const [credentialValue, setCredentialValue] = useState("");

  const [state, setState] = useState<AppState | undefined>(undefined);
  const [runner, setRunner] = useState<Runner | undefined>(undefined);
  const [persistence, setPersistence] = useState<SessionPersistence | undefined>(undefined);
  const [bootError, setBootError] = useState<string | undefined>(undefined);
  const [config, setConfig] = useState<TuiConfig | undefined>(undefined);
  const [theme, setTheme] = useState<Theme>(resolveTheme("default"));
  const [agentLabel, setAgentLabel] = useState("boot");
  const [providerLabel, setProviderLabel] = useState("—");
  const [modelLabel, setModelLabel] = useState("—");
  const [mode, setMode] = useState("build");

  const promptRef = useRef("");
  const initialized = useRef(false);
  const streamId = useRef<string | null>(null);
  const streamBuf = useRef("");
  const reasoningBuf = useRef("");
  const suggestionRevision = useRef(0);
  const credentialBuf = useRef("");
  const pendingOnboardingDone = useRef(false);

  useEffect(() => {
    void loadTuiConfig().then((cfg) => {
      setConfig(cfg);
      setTheme(resolveTheme(cfg.theme));
    });
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      try {
        const st = await openStorage(defaultPaths());
        injectCredentials(st);
        const r = await buildRunner({ state: st });
        setState(st);
        setRunner(r);
        setAgentLabel(r.agent.id);
        setProviderLabel(r.provider.id);
        setModelLabel(r.model);
        const p = await openPersistence(st.paths.sessionsDir, r.agent.id);
        setPersistence(p);
      } catch (error) {
        setBootError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  useEffect(() => {
    if (bootError) {
      setMessages((prev) => [...prev, newMessage("error", bootError)]);
      setBootError(undefined);
    }
  }, [bootError]);

  const setPromptBoth = (value: string): void => {
    promptRef.current = value;
    setPrompt(value);
    refreshSuggestions(value);
  };

  const refreshSuggestions = (value: string): void => {
    const token = fileRefToken(value);
    const slash = slashToken(value);
    if (!token && !slash && suggestions.length > 0) {
      setSuggestions([]);
      return;
    }
    if (!token && !slash) return;
    const revision = ++suggestionRevision.current;
    if (slash) {
      const entries = Object.entries(COMMAND_HELP)
        .filter(([cmd]) => cmd.startsWith(slash))
        .sort((a, b) => {
          const exactA = a[0] === slash ? 0 : 1;
          const exactB = b[0] === slash ? 0 : 1;
          return exactA - exactB || a[0].localeCompare(b[0]);
        });
      if (revision === suggestionRevision.current && promptRef.current === value) {
        setSuggestions(entries.map(([cmd, hint]) => ({ value: cmd.split(/\s+/)[0]!, hint })));
        const exact = entries.findIndex(([cmd]) => cmd === slash);
        setSelectedSuggestion(exact >= 0 ? exact : 0);
      }
      return;
    }
    setSelectedSuggestion(0);
    void suggestFiles(token!).then((matches) => {
      if (revision === suggestionRevision.current && promptRef.current === value) {
        setSuggestions(matches.map((m) => ({ value: m })));
      }
    });
  };

  const appendMessage = (message: Message): void => {
    setMessages((prev) => [...prev, message]);
  };

  const scheduleStream = (): void => {
    const id = streamId.current;
    if (!id) return;
    const content = streamBuf.current;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content, streaming: true } : m)));
  };

  const finalizeStream = (fallback: string): void => {
    const id = streamId.current;
    streamId.current = null;
    if (!id) return;
    const content = streamBuf.current || fallback;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content, streaming: false } : m)));
  };

  const runLeaderAction = async (action: LeaderAction): Promise<void> => {
    switch (action) {
      case "help":
        await runSlash("/help");
        break;
      case "exit":
        exit();
        break;
      case "new":
        await runSlash("/new");
        break;
      case "clear":
        setMessages([]);
        break;
      case "sessions":
        await runSlash("/sessions");
        break;
      case "thinking":
        handleThinking(true);
        break;
      case "details":
        handleDetails(true);
        break;
    }
  };

  const handleThinking = (silent = false): void => {
    setThinking((v) => {
      if (!silent) appendMessage(newMessage("system", `thinking ${v ? "off" : "on"}`));
      return !v;
    });
  };

  const handleDetails = (silent = false): void => {
    setDetails((v) => {
      if (!silent) appendMessage(newMessage("system", `details ${v ? "off" : "on"}`));
      return !v;
    });
  };

  const runSlash = async (input: string): Promise<void> => {
    const head = commandName(input);
    if (head === "/exit" || head === "/quit" || head === "/q") {
      exit();
      return;
    }
    if (head === "/new") {
      setMessages([]);
      streamBuf.current = "";
      reasoningBuf.current = "";
      appendMessage(newMessage("system", "new session started"));
      return;
    }
    if (head === "/clear") {
      setMessages([]);
      return;
    }
    if (head === "/thinking") {
      handleThinking();
      return;
    }
    if (head === "/details") {
      handleDetails();
      return;
    }
    if (!state) {
      appendMessage(newMessage("error", "storage not initialized yet"));
      return;
    }
    if (head === "/connect" || head === "--connect") {
      const parts = input.trim().split(/\s+/);
      await startConnectFlow(parts.length > 1 ? parts[1] : undefined);
      return;
    }
    if (head === "/help") {
      setMessages([]);
    }
    const result = await runSlashCommand(input, state);
    if (result.picker && result.picker.length > 0) {
      setPickerState({ title: result.title ?? "Select", items: result.picker, selected: 0 });
      return;
    }
    const lines = result.title ? [result.title, ...result.lines] : result.lines;
    appendMessage(newMessage("system", lines.join("\n")));
    if (head === "/config" || head === "/connect") refreshLabels();
  };

  const selectPickerItem = (item: PickerItem): void => {
    setPickerState(null);
    void runSlash(item.action).then(() => {
      if (pendingOnboardingDone.current) {
        pendingOnboardingDone.current = false;
        appendMessage(newMessage("system", "onboarding complete — you're all set. type a message to start."));
      }
    });
  };

  const openModelPicker = async (): Promise<void> => {
    if (!state) return;
    const result = await runSlashCommand("/models", state);
    if (!result.picker || result.picker.length === 0) {
      appendMessage(newMessage("system", [result.title ?? "Models", ...result.lines].join("\n")));
      return;
    }
    pendingOnboardingDone.current = true;
    setPickerState({ title: result.title ?? "Select a model", items: result.picker, selected: 0 });
  };

  const startConnectFlow = async (providerId?: string): Promise<void> => {
    if (!state) {
      appendMessage(newMessage("error", "storage not ready"));
      return;
    }
    const registry = createBuiltinRegistry();
    if (!providerId) {
      const result = await runSlashCommand("/connect", state);
      if (result.picker && result.picker.length > 0) {
        setPickerState({ title: result.title ?? "Providers", items: result.picker, selected: 0 });
      } else {
        appendMessage(newMessage("system", [result.title ?? "Providers", ...result.lines].join("\n")));
      }
      return;
    }
    if (!registry.has(providerId)) {
      appendMessage(newMessage("error", `unknown provider '${providerId}' (available: ${registry.ids().join(", ")})`));
      return;
    }
    state.config.set("defaultProvider", providerId);
    await state.config.save();
    refreshLabels();
    const envVars = providerAuthEnvNames(providerId);
    const hasKey = envVars.some((n) => state.credentials.resolve(n) !== undefined);
    if (!hasKey) {
      if (envVars.length === 0) {
        appendMessage(newMessage("system", `connected to ${providerId} (no API key needed)`));
        await openModelPicker();
        return;
      }
      setCredentialValue("");
      credentialBuf.current = "";
      setCredentialPrompt({ envVar: envVars[0]!, label: `API key for ${providerId}` });
      return;
    }
    appendMessage(newMessage("system", `${providerId} API key found — choosing a model`));
    await openModelPicker();
  };

  const refreshLabels = (): void => {
    if (!state) return;
    const all = (state.config as unknown as { all(): Record<string, string> }).all();
    setAgentLabel(all.agent ?? agentLabel);
    setProviderLabel(all.defaultProvider ?? providerLabel);
    setModelLabel(all.defaultModel ?? modelLabel);
  };

  const handleShell = (command: string): void => {
    appendMessage(newMessage("system", `$ ${command}`));
    void import("node:child_process").then(({ exec }) => {
      exec(command, { cwd: process.cwd(), maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const out = [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
        appendMessage(newMessage(error ? "error" : "system", error ? `${error.message}\n${out}` : out));
      });
    });
  };

  const handleAgentRun = async (input: string): Promise<void> => {
    if (!runner) {
      appendMessage(newMessage("error", "agent not ready (check credentials: openai default — run `myagent auth set OPENAI_API_KEY`)"));
      return;
    }
    setSubmitting(true);
    streamBuf.current = "";
    reasoningBuf.current = "";
    const agentMsg = newMessage("agent", "", true);
    streamId.current = agentMsg.id;
    appendMessage(agentMsg);
    try {
      const result = await executeRun({
        runner,
        input,
        onEvent: persistence?.sink,
        onToken: (delta, phase) => {
          if (phase === "output") streamBuf.current += delta;
          else reasoningBuf.current += delta;
          scheduleStream();
        },
      });
      finalizeStream("(no output)");
      if (reasoningBuf.current.trim() && thinking) {
        appendMessage(newMessage("system", `— thinking —\n${reasoningBuf.current.trimEnd()}`));
      }
      if (persistence) await persistTurn(persistence.store, persistence.sessionId, runner, input, result);
      if (result.status === "completed") {
        appendMessage(newMessage("system", `done (${result.iterations} iterations)`));
      } else {
        appendMessage(newMessage("error", result.error ?? "failed"));
      }
    } catch (error) {
      finalizeStream("(error)");
      appendMessage(newMessage("error", error instanceof Error ? error.message : String(error)));
    } finally {
      await runner.mcp?.closeAll().catch(() => undefined);
      setSubmitting(false);
    }
  };

  const handleSubmit = async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    if (!trimmed || submitting) return;
    setPromptBoth("");
    appendMessage(newMessage("user", trimmed));
    if (isSlashCommand(trimmed)) {
      await runSlash(trimmed);
      return;
    }
    if (trimmed.startsWith("!")) {
      handleShell(trimmed.slice(1).trim());
      return;
    }
    await handleAgentRun(trimmed);
  };

  const completeSuggestion = (): void => {
    const p = promptRef.current;
    const suggestion = suggestions[selectedSuggestion] ?? suggestions[0];
    if (!suggestion) return;
    if (slashToken(p) !== undefined) {
      setPromptBoth(suggestion.value + " ");
      return;
    }
    const idx = p.lastIndexOf("@");
    if (idx < 0) return;
    const target = suggestion.value.replace(/\/$/, "");
    setPromptBoth(p.slice(0, idx + 1) + target + " ");
  };

  const toggleMode = (): void => {
    setMode((m) => (m === "build" ? "plan" : "build"));
    appendMessage(newMessage("system", `mode: plan (no file edits; suggest changes only)`));
  };

  useInput(
    (input, key) => {
      if (credentialPrompt) {
        (async () => {
          if (key.escape || (key.ctrl && input.toLowerCase() === "c")) {
            setCredentialPrompt(null);
            credentialBuf.current = "";
            setCredentialValue("");
            appendMessage(newMessage("system", "connect canceled"));
            return;
          }
          if (key.return) {
            const value = credentialBuf.current.trim();
            if (!value || !state) return;
            state.credentials.set(credentialPrompt.envVar, value);
            await state.credentials.save();
            setCredentialPrompt(null);
            credentialBuf.current = "";
            setCredentialValue("");
            appendMessage(newMessage("system", `saved ${credentialPrompt.envVar}`));
            await openModelPicker();
            return;
          }
          if (key.backspace) {
            const next = credentialBuf.current.slice(0, -1);
            credentialBuf.current = next;
            setCredentialValue(next);
            return;
          }
          if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) return;
          if (input && input.length > 0) {
            const next = credentialBuf.current + input;
            credentialBuf.current = next;
            setCredentialValue(next);
          }
        })();
        return;
      }
      if (pickerState) {
        if (key.upArrow || key.downArrow) {
          setPickerState((p) => (p ? { ...p, selected: Math.max(0, Math.min(p.items.length - 1, p.selected + (key.upArrow ? -1 : 1))) } : p));
          return;
        }
        if (key.return) {
          setPickerState((p) => {
            if (p) selectPickerItem(p.items[p.selected] ?? p.items[0]!);
            return p;
          });
          return;
        }
        if (key.escape || (key.ctrl && input.toLowerCase() === "c")) {
          setPickerState(null);
          return;
        }
        return;
      }
      if (leadingAction) {
        setLeadingAction(false);
        const action = resolveLeaderAction(config ?? DEFAULT_TUI_CONFIG, input || "");
        if (action) void runLeaderAction(action);
        return;
      }
      if (key.ctrl && !key.shift && input.toLowerCase() === "x") {
        setLeadingAction(true);
        return;
      }
      if (key.ctrl && input.toLowerCase() === "c") {
        exit();
        return;
      }
      if (key.return) {
        const slash = slashToken(promptRef.current);
        if (slash !== undefined && suggestions.length > 0) {
          const picked = suggestions[selectedSuggestion] ?? suggestions[0];
          if (picked) {
            appendMessage(newMessage("user", picked.value));
            void runSlash(picked.value);
            setPromptBoth("");
          }
          return;
        }
        void handleSubmit(promptRef.current);
        return;
      }
      if (key.tab) {
        if (suggestions.length > 0) {
          completeSuggestion();
        } else {
          toggleMode();
        }
        return;
      }
      if (key.backspace) {
        setPromptBoth(promptRef.current.slice(0, -1));
        return;
      }
      if (key.leftArrow || key.rightArrow) return;
      if (key.upArrow || key.downArrow) {
        if (suggestions.length === 0) return;
        setSelectedSuggestion((s) =>
          key.downArrow ? Math.min(suggestions.length - 1, s + 1) : Math.max(0, s - 1),
        );
        return;
      }
      if (input && input.length > 0) {
        setPromptBoth(promptRef.current + input);
      }
    },
    { isActive: !submitting },
  );

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar
        agent={agentLabel}
        provider={providerLabel}
        model={modelLabel}
        sessionId={persistence?.sessionId}
        mode={mode}
        thinking={thinking}
        theme={theme}
      />
      <Box flexGrow={1} flexDirection="column">
        <ChatPane messages={messages} theme={theme} />
      </Box>
      {pickerState ? <PickerPane picker={pickerState} theme={theme} /> : null}
      {credentialPrompt ? (
        <PromptPane title="Connect" label={credentialPrompt.label} value={credentialValue} secret theme={theme} />
      ) : null}
      <InputPane
        prompt={prompt}
        submitting={submitting}
        leadingAction={leadingAction}
        suggestions={suggestions}
        selectedSuggestion={selectedSuggestion}
        theme={theme}
      />
      <ModeFooter mode={mode} theme={theme} onToggle={toggleMode} shortCut={config?.keybinds?.commandList} />
    </Box>
  );
}

function ModeFooter({
  mode,
  theme,
  onToggle,
  shortCut,
}: {
  mode: string;
  theme: Theme;
  onToggle: () => void;
  shortCut?: string;
}) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text color={theme.muted}>Tab: {mode === "build" ? "plan" : "build"}</Text>
      <Text color={theme.muted}>{shortCut ?? "ctrl+p"} command list</Text>
    </Box>
  );
}