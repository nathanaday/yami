import type { AgentInfo, AgentSession, ApprovalSetting, Harness, SessionOptions, ToolSet } from "./types.js";

export interface AgentPreferences {
  /** Tools that run in the host, given to every session. A session's own `tools` replace them. */
  tools?: ToolSet;
  /** Skill-set folders, given to every session. See `SessionOptions.skills`. */
  skills?: string[];
  /** Working directory of the agent. Defaults to the current process directory. */
  cwd?: string;
  /** Model ID. Defaults to the harness default. */
  model?: string;
  effort?: string;
  /** Text added to the harness system prompt. */
  instructions?: string;
  /** When the agent asks before it acts. Defaults to `ask`. */
  approval?: ApprovalSetting;
  /** `read-only` stops the agent from changing files or running commands that change them. */
  access?: "edit" | "read-only";
}

/** What one session can set on top of the agent's preferences. */
export type SessionStart<P extends AgentPreferences> = Partial<P> &
  Pick<SessionOptions, "resume" | "onPermission" | "onQuestion" | "tools" | "skills" | "beforeFileChange">;

/**
 * Holds the preferences for one harness and starts sessions with them.
 * Each harness adds its own preferences to `P`.
 */
export abstract class Agent<P extends AgentPreferences = AgentPreferences> {
  abstract readonly harness: Harness;
  private current: P;
  private readonly sessions = new Set<AgentSession>();

  constructor(preferences?: P) {
    this.current = { ...preferences } as P;
  }

  get preferences(): Readonly<P> {
    return this.current;
  }

  /** Changes apply to sessions that start after this call. */
  setPreferences(changes: Partial<P>): void {
    this.current = { ...this.current, ...changes };
  }

  /** Runs the harness once to confirm that it starts and is signed in. */
  abstract connect(): Promise<AgentInfo>;

  /** Starts a harness process and resolves when the session is ready for `send`. */
  async startSession(options: SessionStart<P> = {}): Promise<AgentSession> {
    const session = await this.createSession({ ...this.current, ...options });
    this.sessions.add(session);
    session.on((event) => {
      if (event.type === "closed") this.sessions.delete(session);
    });
    return session;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions].map((session) => session.close()));
  }

  protected abstract createSession(options: P & SessionStart<P>): Promise<AgentSession>;

  /** The shared session options from preferences and a session's own settings. */
  protected sessionOptions(options: P & SessionStart<P>, clientName = "yami"): SessionOptions {
    return {
      cwd: options.cwd ?? process.cwd(),
      clientName,
      model: options.model,
      effort: options.effort,
      instructions: options.instructions,
      approval: options.approval,
      access: options.access,
      resume: options.resume,
      onPermission: options.onPermission,
      onQuestion: options.onQuestion,
      tools: options.tools,
      skills: options.skills,
      beforeFileChange: options.beforeFileChange,
    };
  }
}
