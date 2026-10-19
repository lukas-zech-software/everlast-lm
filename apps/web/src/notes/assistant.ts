import type { NoteAssistantAction } from "@everlast/contracts";
import { NOTE_ASSISTANT_MAX_NOTES, NOTE_ERROR_MESSAGES } from "../lib/v2-contracts.ts";

export const ASSISTANT_DISCLOSURE =
  "This creates a source snapshot from the exact selected notes and adds it to your sources.";

const LABELS: Record<NoteAssistantAction, string> = {
  summarize: "Summarize",
  create_outline: "Create outline",
  related_ideas: "Suggest related ideas",
  critique: "Critique",
};

export interface AssistantActionState {
  action: NoteAssistantAction;
  label: string;
  enabled: boolean;
  hint?: string;
}

/** FR-NM-04: actions for 1..50 selected notes; related ideas and critique need a comparison source. */
export function assistantActions(sel: { noteCount: number; comparisonSourceCount: number }): AssistantActionState[] {
  const inRange = sel.noteCount >= 1 && sel.noteCount <= NOTE_ASSISTANT_MAX_NOTES;
  return (Object.keys(LABELS) as NoteAssistantAction[]).map((action) => {
    const needsComparison = action === "related_ideas" || action === "critique";
    if (!inRange) return { action, label: LABELS[action], enabled: false, hint: "Select 1 to 50 notes" };
    if (needsComparison && sel.comparisonSourceCount === 0) {
      return { action, label: LABELS[action], enabled: false, hint: NOTE_ERROR_MESSAGES.ComparisonSourceRequired };
    }
    return { action, label: LABELS[action], enabled: true };
  });
}
