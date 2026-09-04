/**
 * One keymap registry. The shortcut sheet renders from this, so the sheet
 * cannot drift from the behaviour (DESIGN-UI 12).
 *
 * Rules that hold everywhere, and that a handler built on this registry has to
 * respect: no binding fires while focus is in a text field, the reason filter
 * or an attestation input; Escape never navigates away from a claimed case; and
 * no shortcut fires an irreversible action without a focused step between the
 * keypress and the write.
 */

export interface KeyBinding {
  keys: string;
  action: string;
  /** Modified alias that always works, where one exists. */
  alias?: string;
}

export interface KeyGroup {
  name: string;
  bindings: KeyBinding[];
}

export const KEY_GROUPS: KeyGroup[] = [
  {
    name: "In the queue",
    bindings: [
      { keys: "j / k", action: "Move selection down or up. Does not open, does not claim" },
      { keys: "Enter or o", action: "Claim and open the selected case" },
      { keys: "Shift+Enter", action: "Open read only without claiming" },
      { keys: "1 to 5", action: "Jump to a filter chip" },
      { keys: "/", action: "Focus the filter chips for type-ahead" },
    ],
  },
  {
    name: "In a case",
    bindings: [
      { keys: "t", action: "Jump to the timeline" },
      { keys: "g then p, a, y or v", action: "Go to pair context, actor context, policy or versions" },
      { keys: "[ / ]", action: "Previous or next stage-annotated message row" },
      { keys: "Space", action: "Reveal the focused collapsed span" },
      { keys: "Shift+Space", action: "Reveal every span in this case, after a confirm that says how many" },
      { keys: "x", action: "Open the focused normalization popover. Escape closes it" },
      { keys: "d", action: "Defer, I need a buffer. Releases the claim, no reason, not a skip" },
      { keys: "s", action: "Skip with a reason" },
      { keys: "e", action: "Escalate to a second reviewer without deciding" },
      { keys: "c", action: "Request context from the operator" },
    ],
  },
  {
    name: "Deciding",
    bindings: [
      { keys: "1", action: "Open the dismiss reasons", alias: "Cmd+1" },
      { keys: "2", action: "Open the watch reasons", alias: "Cmd+2" },
      { keys: "3", action: "Open the confirm reasons", alias: "Cmd+3" },
      { keys: "4", action: "Open the propose reasons", alias: "Cmd+4" },
      { keys: "type", action: "Filter the reason list" },
      { keys: "Up / Down", action: "Move within the reason list" },
      { keys: "Enter", action: "Submit the decision with the highlighted reason. This is the write" },
      { keys: "Escape", action: "Close the list, return focus to the verb, decide nothing" },
      { keys: "Cmd+Z", action: "Undo, for 60 seconds" },
      { keys: "n", action: "Next case. Only after a decision, a defer or a skip" },
    ],
  },
  {
    name: "Anywhere",
    bindings: [{ keys: "?", action: "Open this sheet" }],
  },
];
