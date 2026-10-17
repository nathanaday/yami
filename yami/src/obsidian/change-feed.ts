/** Listeners that hear of changes: once for changes that come close together, a moment after the last. */
export class ChangeFeed {
  readonly #listeners = new Set<() => void>();
  #timer: number | undefined;

  constructor(
    private readonly name: string,
    private readonly wait: number,
  ) {}

  on(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  changed(): void {
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      for (const listener of [...this.#listeners]) {
        try {
          listener();
        } catch (error) {
          console.error(`yami: a ${this.name} listener threw`, error);
        }
      }
    }, this.wait);
  }

  stop(): void {
    window.clearTimeout(this.#timer);
  }
}
