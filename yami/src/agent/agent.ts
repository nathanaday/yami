import type { AgentInfo, AgentSession, ApprovalSetting, Harness, SessionOptions, ToolSet } from "./types.js";

export interface AgentPreferences {
  /** Tools that run in the host, given to every session. A session's own `tools` replace them. */
  tools?: ToolSet;
  /** Skill-set folders, given to every session. A session's own `skills` replace them: `skills: []` gives a session none. See `SessionOptions.skills`. */
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
  /** `read-only` stops the agent from changing files, also with a command; it still runs commands that only read or check. See `SessionOptions.access`. */
  access?: "edit" | "read-only";
}

/**
 * What one session can set on top of the agent's preferences. Each option that the session sets replaces the
 * agent's preference, also `tools` and `skills`: they do not add to the agent's.
 */
export type SessionStart<P extends AgentPreferences = AgentPreferences> = Partial<P> &
  Pick<SessionOptions, "resume" | "onPermission" | "onQuestion" | "tools" | "skills" | "beforeFileChange">;

/** A harness session from `resumeOrStart`, and whether it continued the one asked for. */
export interface ResumedSession {
  session: AgentSession;
  /** True when the session continues `resume`; false for a new session. */
  continued: boolean;
}

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

  /**
   * Starts a harness process and resolves when the session is ready for `send`. With `resume`, it rejects
   * when the harness cannot continue that session, for example when it no longer has it: Claude Code exits
   * at its start, and Codex answers `no rollout found for thread id …`. `resumeOrStart` starts a new one then.
   */
  async startSession(options: SessionStart<P> = {}): Promise<AgentSession> {
    const session = await this.createSession({ ...this.current, ...options });
    this.sessions.add(session);
    session.on((event) => {
      if (event.type === "closed") this.sessions.delete(session);
    });
    return session;
  }

  /**
   * Continues the harness session `options.resume` when the harness still has it, and otherwise starts a new
   * session with the same options. `continued` says which. With no `resume`, it starts a new session. When
   * the resume fails for any reason, it starts a new session, and when that fails too, it rejects with the
   * error of the new start; so a refusal, such as a read-only session that does not start, comes once.
   * @example
   * const { session, continued } = await agent.resumeOrStart({ resume: saved, access: "read-only", tools });
   * if (!continued) await session.send(fullContext);
   */
  async resumeOrStart(options: SessionStart<P> = {}): Promise<ResumedSession> {
    if (options.resume) {
      try {
        return { session: await this.startSession(options), continued: true };
      } catch {
        // The harness can have lost the session, for example after it cleaned up old ones.
      }
    }
    return { session: await this.startSession({ ...options, resume: undefined }), continued: false };
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
