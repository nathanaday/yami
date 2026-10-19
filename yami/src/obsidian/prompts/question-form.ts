import type { Question, QuestionAnswers } from "../../agent/index.js";

export interface QuestionForm {
  /** Moves focus to the first choice of the question on screen. */
  focus(): void;
}

interface Step {
  fieldset: HTMLFieldSetElement;
  boxes: HTMLInputElement[];
  answer(): string;
}

/** How long a picked option stays on screen before the next question shows. */
const ADVANCE_MS = 150;

/**
 * Shows the agent's questions one at a time, each with its options and a field for an answer of the user's own.
 * Picking an option of a single-choice question moves to the next question. "Next" and "Answer" stay disabled
 * until the question on screen has an answer. `done` gets the answers, or undefined when the user skips.
 */
export function renderQuestions(
  parent: HTMLElement,
  questions: Question[],
  choicesClass: string,
  done: (answers: QuestionAnswers | undefined) => void,
): QuestionForm {
  const form = parent.createEl("form", { cls: "yami-questions" });
  const steps = questions.map((question, index) => renderStep(form, question, index));
  let current = 0;

  const choices = form.createDiv({ cls: choicesClass });
  const primary = choices.createEl("button", { cls: "mod-cta", attr: { type: "submit" } });
  const primaryLabel = primary.createSpan();
  primary.createEl("kbd", { text: "↵" });
  const back = choices.createEl("button", { text: "Back", attr: { type: "button", "data-action": "back" } });
  const skip = choices.createEl("button", { text: "Skip", attr: { type: "button", "data-action": "skip" } });
  const progress = choices.createSpan({ cls: "yami-question-progress" });

  const last = () => current === steps.length - 1;
  const focusStep = () => steps[current]!.fieldset.querySelector("input")?.focus();
  const refresh = () => {
    primary.disabled = !steps[current]!.answer();
  };
  const show = (index: number) => {
    const hadFocus = form.contains(document.activeElement);
    current = index;
    steps.forEach((step, stepIndex) => (step.fieldset.hidden = stepIndex !== index));
    primaryLabel.setText(last() ? "Answer" : "Next");
    back.hidden = index === 0;
    progress.setText(steps.length > 1 ? `${index + 1} of ${steps.length}` : "");
    refresh();
    if (hadFocus) focusStep();
  };

  steps.forEach((step, index) => {
    step.fieldset.addEventListener("change", (event) => {
      refresh();
      const target = event.target as HTMLInputElement;
      const picked = target.type === "radio" && target.checked && step.boxes.includes(target);
      if (picked && index === current && !last()) {
        window.setTimeout(() => {
          if (current === index && target.checked) show(index + 1);
        }, ADVANCE_MS);
      }
    });
    step.fieldset.addEventListener("input", refresh);
  });

  back.addEventListener("click", () => show(current - 1));
  skip.addEventListener("click", () => done(undefined));
  form.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLInputElement && event.target.type === "text";
    // Number keys pick an option of the question on screen.
    const option = Number(event.key);
    if (!typing && !event.metaKey && !event.ctrlKey && Number.isInteger(option) && option >= 1) {
      const box = steps[current]!.boxes[option - 1];
      if (box) {
        event.preventDefault();
        box.click();
      }
      return;
    }
    // Enter moves on from any field, not only from the text field.
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    form.requestSubmit();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (primary.disabled) return;
    if (!last()) show(current + 1);
    else done(Object.fromEntries(questions.map((question, index) => [question.question, steps[index]!.answer()])));
  });
  show(0);

  return { focus: focusStep };
}

function renderStep(form: HTMLElement, question: Question, index: number): Step {
  const fieldset = form.createEl("fieldset", { cls: "yami-question" });
  const legend = fieldset.createEl("legend", { cls: "yami-question-text" });
  if (question.header) legend.createSpan({ cls: "yami-question-header", text: question.header });
  legend.createSpan({ text: question.question });
  const type = question.multiSelect ? "checkbox" : "radio";
  const name = `yami-question-${index}`;
  const boxes = question.options.map((option) => {
    const row = fieldset.createEl("label", { cls: "yami-question-option" });
    const box = row.createEl("input", { type, attr: { name } });
    const text = row.createDiv({ cls: "yami-question-option-text" });
    text.createDiv({ cls: "yami-question-label", text: option.label });
    if (option.description) text.createDiv({ cls: "yami-question-description", text: option.description });
    return box;
  });

  const otherRow = fieldset.createEl("label", { cls: "yami-question-option is-other" });
  const otherBox = otherRow.createEl("input", { type, attr: { name, "aria-label": "Other" } });
  const other = otherRow.createEl("input", { type: "text", cls: "yami-question-other", attr: { placeholder: "Other answer" } });
  other.addEventListener("focus", () => {
    if (!otherBox.checked) {
      otherBox.checked = true;
      otherBox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  otherBox.addEventListener("change", () => {
    if (otherBox.checked) other.focus();
  });

  return {
    fieldset,
    boxes,
    answer: () =>
      [
        ...question.options.filter((_, option) => boxes[option]!.checked).map((option) => option.label),
        ...(otherBox.checked && other.value.trim() ? [other.value.trim()] : []),
      ].join(", "),
  };
}
