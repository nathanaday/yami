import type { Session } from "./session.js";
import type { AgentInfo, Preferences } from "./types.js";

/**
 * Holds the preferences for one harness and starts sessions with them.
 * Each harness adds its own preferences to `P`.
 */
export abstract class Agent<P extends Preferences = Preferences> {
  abstract readonly harness: string;
  private current: P;
  private readonly sessions = new Set<Session>();

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

  startSession(overrides: Partial<P> = {}): Session {
    const session = this.createSession({ ...this.current, ...overrides });
    this.sessions.add(session);
    session.subscribe((event) => {
      if (event.type === "closed") this.sessions.delete(session);
    });
    return session;
  }

  closeAll(): void {
    for (const session of this.sessions) session.close();
  }

  protected abstract createSession(preferences: P): Session;
}
