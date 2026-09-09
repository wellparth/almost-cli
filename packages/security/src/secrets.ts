// Secret protection: detect and redact credentials anywhere they might leak
// into model context, logs, or child environments.

export interface SecretRedactorOptions {
  /** Key names that are allowed through even if they look like secrets. */
  allowList?: string[];
  /** Replace with this token (default "[REDACTED]"). */
  replacement?: string;
}

const REDACTION_TOKEN = "[REDACTED]";

// High-signal secret formats (provider API keys, JWTs, GitHub tokens, etc.).
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_\-]{16,}\b/g, // OpenAI-style
  /\bsk-ant-[A-Za-z0-9_\-]{16,}\b/g, // Anthropic-style
  /\bAIza[0-9A-Za-z_\-]{30,}\b/g, // Google API keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[psu]_[0-9A-Za-z]{20,}\b/g, // GitHub tokens
  /\bgho_[0-9A-Za-z]{20,}\b/g,
  /\bfacebook[0-9A-Za-z_]{20,}\b/g, // stale fb style
  /\bxox[baprs]-[0-9A-Za-z_\-]{10,}\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, // JWTs
  /\bBearer\s+[A-Za-z0-9_\-\.]{12,}/g, // bearer tokens
  /\b(?:sk|rk)[\-_][A-Za-z0-9_\-]{24,}\b/g, // generic ro/mo keys
];

const ASSIGNMENT_PATTERN =
  /\b(?:api[_-]?key|token|secret|password|passwd|client[_-]?secret|auth)\b\s*[:=]\s*["']?([A-Za-z0-9_\-\.\/+]{10,})["']?/gi;

export class SecretRedactor {
  readonly #allowList: string[];
  readonly #replacement: string;

  constructor(options: SecretRedactorOptions = {}) {
    this.#allowList = options.allowList ?? [];
    this.#replacement = options.replacement ?? REDACTION_TOKEN;
  }

  redact(input: unknown): string {
    if (input === undefined || input === null) return "";
    const text = typeof input === "string" ? input : JSON.stringify(input);
    let out = text;
    for (const pattern of SECRET_PATTERNS) {
      out = out.replace(pattern, this.#replacement);
    }
    out = out.replace(ASSIGNMENT_PATTERN, (match, value: string) =>
      // Deterministic: replace the matched value token (its offset is unknown, so
      // rebuild the match from the captured value's own index).
      this.#rewriteAssignment(match, value),
    );
    return out;
  }

  #rewriteAssignment(match: string, value: string): string {
    const idx = match.indexOf(value);
    if (idx === -1) return this.#replacement;
    const prefix = match.slice(0, idx);
    const suffix = match.slice(idx + value.length);
    return `${prefix}${this.#replacement}${suffix}`;
  }

  /** True if the input contains anything that looks like a secret. */
  detect(input: unknown): boolean {
    if (input === undefined || input === null) return false;
    const text = typeof input === "string" ? input : JSON.stringify(input);
    return SECRET_PATTERNS.some((p) => p.test(text)) || ASSIGNMENT_PATTERN.test(text);
  }

  /** Sanitizes a value, replacing secrets with the replacement token. */
  sanitize(value: string): string {
    return this.redact(value);
  }
}

/** Environment variable names that are secret-like and must not reach children. */
function isSecretLikeKey(name: string): boolean {
  const key = name.toUpperCase();
  const parts = ["API", "TOKEN", "SECRET", "KEY", "PASSWORD", "PASSWD", "CREDENTIAL", "AUTH", "PEM"];
  return parts.some((p) => key.includes(p));
}

/**
 * Builds a child environment with secret-like variables removed. `keep` names
 * (case-insensitive) survive, e.g. strings that are safe for a sandboxed run.
 */
export function sanitizeEnv(
  env: Record<string, string | undefined>,
  keep: string[] = [],
): Record<string, string> {
  const keepSet = new Set(keep.map((n) => n.toUpperCase()));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (isSecretLikeKey(name) && !keepSet.has(name.toUpperCase())) continue;
    if (value === undefined) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Patterns for files that contain credentials and must never be handed to the
 * model or modified casually (".env", credential stores, key material).
 */
export const PROTECTED_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[a-z0-9]+)?$/i,
  /(^|\/)\.envrc$/i,
  /(^|\/)[^\/]*credentials[^\/]*\.(json|txt|yaml|yml)$/i,
  /\.(pem|p12|pfx|key|keystore|truststore)$/i,
  /(^|\/)\.myagent\//,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.(aws|ssh)\//,
  /(^|\/)id_rsa$/,
];

export function isProtectedPath(relPath: string): boolean {
  return PROTECTED_FILE_PATTERNS.some((p) => p.test(relPath));
}