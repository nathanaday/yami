import type { Harness, HarnessInfo, Preferences, Session } from "./types.js";

export class Agent {
  private current: Preferences;
  private readonly sessions = new Set<Session>();

  constructor(
    readonly harness: Harness,
    preferences: Preferences = {},
  ) {
    this.current = { ...preferences };
  }

  get preferences(): Readonly<Preferences> {
    return this.current;
  }

  /** Changes apply to sessions that start after this call. */
  setPreferences(changes: Preferences): void {
    this.current = { ...this.current, ...changes };
  }

  /** Starts the harness once to confirm that it runs and is signed in. */
  connect(): Promise<HarnessInfo> {
    return this.harness.connect(this.current);
  }

  startSession(overrides: Preferences = {}): Session {
    const session = this.harness.openSession({ ...this.current, ...overrides });
    this.sessions.add(session);
    session.subscribe((event) => {
      if (event.type === "closed") this.sessions.delete(session);
    });
    return session;
  }

  closeAll(): void {
    for (const session of this.sessions) session.close();
  }
}

export function createAgent(harness: Harness, preferences?: Preferences): Agent {
  return new Agent(harness, preferences);
}
