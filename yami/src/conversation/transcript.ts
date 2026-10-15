import type { AgentEvent } from "../agent/types.js";
import type { Part, Step, TurnView } from "./format.js";

/** Builds the view of one agent turn from session events. */
export class TurnTranscript implements TurnView {
  parts: Part[] = [];
  status: TurnView["status"] = "working";
  error: string | undefined;
  /** Text that streams now. A complete message replaces it. */
  private streaming: { kind: "text"; text: string } | undefined;

  apply(event: AgentEvent, now = Date.now()): void {
    switch (event.type) {
      case "thinking-delta": {
        const step = this.thinking(now);
        step.text += event.text;
        step.ended = now;
        break;
      }
      case "thinking": {
        const step = this.thinking(now);
        step.text = event.text;
        step.ended = now;
        break;
      }
      case "text-delta":
        this.text().text += event.text;
        break;
      case "message":
        this.text().text = event.text;
        this.streaming = undefined;
        break;
      case "tool-start":
        this.streaming = undefined;
        this.activity().steps.push({
          kind: "tool",
          id: event.id,
          tool: event.tool,
          title: event.title,
          detail: event.detail,
          paths: event.paths,
          running: true,
        });
        break;
      case "tool-end":
        for (const part of this.parts) {
          if (part.kind !== "activity") continue;
          for (const step of part.steps) {
            if (step.kind === "tool" && step.id === event.id) Object.assign(step, { running: false, ok: event.ok, output: event.output });
          }
        }
        break;
      case "turn-end": {
        const { status, text, error } = event.result;
        this.status = status === "interrupted" ? "stopped" : status;
        this.error = error;
        const last = this.parts.at(-1);
        if (status === "completed" && text && !(last?.kind === "text" && last.text.trim() === text.trim())) {
          if (!this.parts.some((part) => part.kind === "text" && part.text.trim() === text.trim())) this.parts.push({ kind: "text", text });
        }
        for (const part of this.parts) if (part.kind === "activity") for (const step of part.steps) if (step.kind === "tool") step.running = false;
        break;
      }
    }
  }

  private thinking(now: number): Extract<Step, { kind: "thinking" }> {
    const activity = this.activity();
    const last = activity.steps.at(-1);
    if (last?.kind === "thinking") return last;
    const step: Extract<Step, { kind: "thinking" }> = { kind: "thinking", text: "", started: now };
    activity.steps.push(step);
    return step;
  }

  private activity(): Extract<Part, { kind: "activity" }> {
    const last = this.parts.at(-1);
    if (last?.kind === "activity") return last;
    const part: Extract<Part, { kind: "activity" }> = { kind: "activity", steps: [] };
    this.parts.push(part);
    return part;
  }

  private text(): { kind: "text"; text: string } {
    if (this.streaming && this.parts.at(-1) === this.streaming) return this.streaming;
    this.streaming = { kind: "text", text: "" };
    this.parts.push(this.streaming);
    return this.streaming;
  }
}
