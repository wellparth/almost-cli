import type {
  Permission,
  PermissionChecker,
  PermissionDecision,
  PermissionSet,
} from "@almost/agent-core";

export type ApprovalHandler = (permission: Permission, detail?: string) => Promise<boolean>;

export interface PermissionPolicyOptions {
  set: PermissionSet;
  requiresApproval?: Permission[];
  onApprovalRequested?: ApprovalHandler;
}

function resolveBoolean(set: PermissionSet, permission: Permission): boolean | undefined {
  switch (permission) {
    case "filesystem.read":
      return set.filesystem.read;
    case "filesystem.write":
      return set.filesystem.write;
    case "filesystem.delete":
      return set.filesystem.delete ?? false;
    case "shell.execute":
      return set.shell.execute;
    case "git.read":
      return set.git.read;
    case "git.write":
      return set.git.write;
    case "network":
      return set.network ?? false;
    case "mcp":
      return set.mcp ?? false;
    case "spawn_agents":
      return set.spawnAgents ?? false;
    default:
      return false;
  }
}

/**
 * Policy engine: maps a PermissionSet to allow / deny / requires_approval
 * decisions. Deny always wins over approval handlers. See plan section 11.
 */
export class PolicyPermissionChecker implements PermissionChecker {
  readonly #set: PermissionSet;
  readonly #approval: Permission[];
  readonly #handler?: ApprovalHandler;

  constructor(options: PermissionPolicyOptions) {
    this.#set = options.set;
    this.#approval = options.requiresApproval ?? [];
    this.#handler = options.onApprovalRequested;
  }

  async check(permission: Permission, detail?: string): Promise<PermissionDecision> {
    const allowed = resolveBoolean(this.#set, permission);
    if (!allowed) {
      return { verdict: "denied", reason: `permission '${permission}' is not granted` };
    }
    if (this.#approval.includes(permission)) {
      if (!this.#handler) {
        return { verdict: "requires_approval" };
      }
      const granted = await this.#handler(permission, detail);
      return granted ? { verdict: "allowed" } : { verdict: "denied", reason: "approval declined" };
    }
    return { verdict: "allowed" };
  }
}

export interface ApprovableToolResult<T> {
  decision: PermissionDecision;
  result?: T;
}

export function createRunner() {
  return { PolicyPermissionChecker };
}