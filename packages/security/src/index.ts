export {
  SecretRedactor,
  sanitizeEnv,
  isProtectedPath,
  PROTECTED_FILE_PATTERNS,
} from "./secrets.js";
export type { SecretRedactorOptions } from "./secrets.js";
export { detectInstructionOverride, guardToolOutput } from "./injection.js";
export type { InjectionMatch, InjectionResult } from "./injection.js";
export {
  checkNetworkAccess,
  emptyNetworkPolicy,
  mergePolicies,
  networkPolicyFromConfig,
} from "./network.js";
export type { NetworkDecision, NetworkPolicy } from "./network.js";
export { AuditStore, auditFromAgentEvent, auditSink } from "./audit.js";
export type { AuditCategory, AuditEntry, AuditStoreOptions } from "./audit.js";