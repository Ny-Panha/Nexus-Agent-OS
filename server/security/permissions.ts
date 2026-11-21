import { randomUUID } from 'node:crypto';
import type {
  AgentId,
  PendingApproval,
  SafetyMode,
  ToolRisk,
} from '../../shared/types.js';

interface Waiter {
  approval: PendingApproval;
  resolve: (approved: boolean) => void;
}

export class PermissionGate {
  private pending = new Map<string, Waiter>();
  private sessionAllowedTools = new Map<string, Set<string>>();
  private emitApprovalRequired: (approval: PendingApproval) => void;
  private emitApprovalResolved: (approvalId: string, approved: boolean) => void;

  constructor(handlers: {
    onApprovalRequired: (approval: PendingApproval) => void;
    onApprovalResolved: (approvalId: string, approved: boolean) => void;
  }) {
    this.emitApprovalRequired = handlers.onApprovalRequired;
    this.emitApprovalResolved = handlers.onApprovalResolved;
  }

  public listPending(): PendingApproval[] {
    return Array.from(this.pending.values()).map((w) => w.approval);
  }

  public isBlockedInReadOnly(mode: SafetyMode, risk: ToolRisk): boolean {
    return mode === 'read_only' && risk !== 'read';
  }

  public needsApproval(
    mode: SafetyMode,
    risk: ToolRisk,
    sessionId: string,
    toolName: string,
  ): boolean {
    if (mode === 'full_auto') return false;
    if (mode === 'read_only') return false; // handled by isBlockedInReadOnly
    if (mode === 'smart' && risk === 'read') return false;

    const allowedSet = this.sessionAllowedTools.get(sessionId);
    if (risk !== 'danger' && allowedSet?.has(toolName)) {
      return false;
    }

    return true;
  }

  public async requestApproval(params: {
    sessionId: string;
    agent: AgentId;
    toolName: string;
    args: Record<string, unknown>;
    risk: ToolRisk;
    reason: string;
    signal?: AbortSignal;
  }): Promise<boolean> {
    if (params.signal?.aborted) {
      return false;
    }

    const approval: PendingApproval = {
      id: randomUUID(),
      sessionId: params.sessionId,
      agent: params.agent,
      toolName: params.toolName,
      args: params.args,
      risk: params.risk,
      reason: params.reason,
      createdAt: new Date().toISOString(),
    };

    return new Promise<boolean>((resolve) => {
      const cleanupAbort = () => {
        if (this.pending.has(approval.id)) {
          this.pending.delete(approval.id);
          this.emitApprovalResolved(approval.id, false);
          resolve(false);
        }
      };

      params.signal?.addEventListener('abort', cleanupAbort, { once: true });

      this.pending.set(approval.id, {
        approval,
        resolve: (approved: boolean) => {
          params.signal?.removeEventListener('abort', cleanupAbort);
          resolve(approved);
        },
      });

      this.emitApprovalRequired(approval);
    });
  }

  public resolveApproval(
    approvalId: string,
    approved: boolean,
    rememberForSession = false,
  ): boolean {
    const waiter = this.pending.get(approvalId);
    if (!waiter) return false;

    this.pending.delete(approvalId);

    if (approved && rememberForSession && waiter.approval.risk !== 'danger') {
      let set = this.sessionAllowedTools.get(waiter.approval.sessionId);
      if (!set) {
        set = new Set<string>();
        this.sessionAllowedTools.set(waiter.approval.sessionId, set);
      }
      set.add(waiter.approval.toolName);
    }

    this.emitApprovalResolved(approvalId, approved);
    waiter.resolve(approved);
    return true;
  }

  public denyAllForSession(sessionId: string): void {
    for (const [id, waiter] of this.pending.entries()) {
      if (waiter.approval.sessionId === sessionId) {
        this.pending.delete(id);
        this.emitApprovalResolved(id, false);
        waiter.resolve(false);
      }
    }
  }
}
