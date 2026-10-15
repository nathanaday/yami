/**
 * The parts of the `codex app-server` v2 protocol that the Codex adapter uses.
 * Generate the full definitions with `codex app-server generate-ts --out <dir>`.
 * The protocol is experimental, so check these types when Codex changes.
 */

export type ApprovalPolicy = "untrusted" | "on-request" | "never";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface ThreadStartResponse {
  thread: { id: string };
  model: string;
}

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export interface Turn {
  id: string;
  status: TurnStatus;
  error: { message: string; additionalDetails: string | null } | null;
}

export type ItemStatus = "inProgress" | "completed" | "failed" | "declined";

export type ThreadItem =
  | { type: "agentMessage"; id: string; text: string; phase: string | null }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: ItemStatus;
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | {
      type: "fileChange";
      id: string;
      changes: { path: string; kind: unknown; diff: string }[];
      status: ItemStatus;
    }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      status: ItemStatus;
      error: { message: string } | null;
    }
  | { type: "webSearch"; id: string; query?: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace: string | null;
      tool: string;
      arguments: unknown;
      status: "inProgress" | "completed" | "failed";
      contentItems: { type: string; text?: string }[] | null;
      success: boolean | null;
    }
  | { type: string; id: string };

export interface ItemNotification {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface AgentMessageDelta {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ReasoningDelta {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  summaryIndex: number;
}

export interface TokenUsageNotification {
  threadId: string;
  turnId: string;
  tokenUsage: { last: { inputTokens: number; outputTokens: number } };
}

export interface DynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
}

export interface Model {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

export interface Skill {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  enabled: boolean;
}

export interface TurnNotification {
  threadId: string;
  turn: Turn;
}

export interface ErrorNotification {
  threadId: string;
  turnId: string;
  willRetry: boolean;
  error: { message: string };
}

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface CommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
  networkApprovalContext?: { host: string; protocol: string } | null;
}

export interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface PermissionProfile {
  network: { enabled: boolean | null } | null;
  fileSystem: { read: string[] | null; write: string[] | null } | null;
}

export interface PermissionsApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  cwd: string;
  reason: string | null;
  permissions: PermissionProfile;
}

export interface ElicitationParams {
  threadId: string;
  serverName: string;
  mode: string;
  message: string;
  requestedSchema?: { required?: string[] } | null;
}

export interface AccountResponse {
  account: { type: "apiKey" } | { type: "chatgpt"; email: string | null; planType: string } | { type: string } | null;
}
