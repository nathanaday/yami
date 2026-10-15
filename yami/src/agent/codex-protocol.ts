/**
 * The parts of the `codex app-server` protocol that the Codex adapter uses.
 * The source is `codex app-server generate-ts` from Codex CLI 0.160.0. The
 * protocol is experimental, so check these types when Codex changes. Items of
 * other types also arrive, and the adapter ignores them.
 */

export interface ThreadStartResponse {
  thread: { id: string };
  model: string;
}

export interface TurnStartResponse {
  turn: { id: string };
}

export interface Turn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: { message: string } | null;
}

export type ThreadItem =
  | { type: "agentMessage"; id: string; text: string }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: "inProgress" | "completed" | "failed" | "declined";
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | {
      type: "fileChange";
      id: string;
      changes: { path: string; kind: { type: "add" | "delete" | "update" } }[];
      status: "inProgress" | "completed" | "failed" | "declined";
    }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      arguments: unknown;
      status: "inProgress" | "completed" | "failed";
      result: { content: unknown } | null;
      error: { message: string } | null;
    }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace: string | null;
      tool: string;
      arguments: unknown;
      status: "inProgress" | "completed" | "failed";
      contentItems: unknown;
      success: boolean | null;
    }
  | { type: "webSearch"; id: string; query: string };

export interface ItemNotification {
  item: ThreadItem;
}

export interface TokenUsageNotification {
  tokenUsage: { last: { inputTokens: number; outputTokens: number } };
}

export interface ErrorNotification {
  error: { message: string };
  willRetry: boolean;
}

export interface CommandApprovalRequest {
  itemId: string;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  networkApprovalContext?: { host: string; protocol: string } | null;
}

export interface FileChangeApprovalRequest {
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface PermissionProfile {
  network: { enabled: boolean | null } | null;
  fileSystem: { read: string[] | null; write: string[] | null } | null;
}

export interface PermissionsApprovalRequest {
  reason: string | null;
  permissions: PermissionProfile;
}

export interface ElicitationRequest {
  serverName: string;
  mode: string;
  message: string;
  requestedSchema?: { required?: string[] } | null;
}

export interface Account {
  account: { type: "apiKey" } | { type: "chatgpt"; email: string | null; planType: string } | { type: string } | null;
}
