// Network controls: allow/deny policy evaluated for every outbound request.
// Applies to the network tool and to MCP servers that could exfiltrate.

export interface NetworkPolicy {
  /** Allowed hostnames/wildcard domains. Empty allow means nothing is allowed. */
  allow: string[];
  /** Hostnames that must be refused even if allowed by another rule. */
  deny: string[];
}

export interface NetworkDecision {
  allowed: boolean;
  reason: string;
}

export function emptyNetworkPolicy(): NetworkPolicy {
  return { allow: [], deny: [] };
}

function normalizeHost(urlOrHost: string): string {
  const value = urlOrHost.trim().toLowerCase();
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).hostname;
    } catch {
      return "";
    }
  }
  return value;
}

function hostMatches(rule: string, host: string): boolean {
  const ruleHost = normalizeHost(rule);
  if (ruleHost === "") return false;
  if (ruleHost.startsWith("*.")) {
    const suffix = ruleHost.slice(1); // ".example.com"
    return host === suffix.slice(1) || host.endsWith("." + suffix.slice(1));
  }
  return host === ruleHost || host.endsWith("." + ruleHost);
}

function isIp(address: string): boolean {
  const host = normalizeHost(address);
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * Evaluates a network policy for a URL or hostname. Deny rules always win.
 * If `allow` contains a literal IP, refused. Otherwise defaults to deny-all.
 */
export function checkNetworkAccess(urlOrHost: string, policy: NetworkPolicy): NetworkDecision {
  const host = normalizeHost(urlOrHost);
  if (isIp(host)) {
    return {
      allowed: false,
      reason: `network policy: direct IP addresses are not allowed (${host})`,
    };
  }
  if (host === "localhost" || host === "127.0.0.1") {
    return { allowed: false, reason: "network policy: localhost is not allowed" };
  }
  if (policy.deny.some((rule) => hostMatches(rule, host))) {
    return { allowed: false, reason: `network policy: '${host}' is denied` };
  }
  if (policy.allow.some((rule) => hostMatches(rule, host))) {
    return { allowed: true, reason: `network policy: '${host}' is allowed` };
  }
  return { allowed: false, reason: `network policy: '${host}' is not in the allow list (deny by default)` };
}

/** Merges two policies; deny sets union, allow lists concatenate. */
export function mergePolicies(a: NetworkPolicy, b: NetworkPolicy): NetworkPolicy {
  return {
    allow: [...new Set([...a.allow, ...b.allow])],
    deny: [...new Set([...a.deny, ...b.deny])],
  };
}

/**
 * Builds a policy from ConfigStore keys: `network-allow` and `network-deny`,
 * comma-separated hostnames, plus an optional `network-default-deny` boolean.
 */
export function networkPolicyFromConfig(config: {
  get: (key: string) => unknown;
}): NetworkPolicy {
  const toList = (raw: unknown): string[] =>
    typeof raw === "string" && raw.trim() !== ""
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  return {
    allow: toList(config.get("network-allow")),
    deny: toList(config.get("network-deny")),
  };
}