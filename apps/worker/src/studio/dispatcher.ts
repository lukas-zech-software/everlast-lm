/** Non-blocking in-process dispatcher for local/dev; production uses a Cloud Tasks adapter (D13). */
export class InlineStudioDispatcher {
  private readonly pending = new Set<Promise<void>>();

  private readonly runner: { run(id: string): Promise<unknown> };
  constructor(runner: { run(id: string): Promise<unknown> }) {
    this.runner = runner;
  }

  async enqueue(artifactId: string, _ownerId: string): Promise<void> {
    const task = Promise.resolve()
      .then(() => this.runner.run(artifactId))
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}
