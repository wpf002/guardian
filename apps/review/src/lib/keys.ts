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

/*
 * Only keys that do something, checked against every key handler in src.
 *
 * The sheet listed t to jump to the timeline, g then p, a, y or v for panels
 * that have since been removed, [ and ] between message rows, Space and
 * Shift+Space to reveal, x for a popover, s to skip, n for the next case,
 * Cmd+Z to undo and Cmd+1 to 4 as aliases. None of those was ever wired. A
 * shortcut sheet that lists keys that do nothing teaches people to stop
 * trying the ones that work.
 */
export const KEY_GROUPS: KeyGroup[] = [
  {
    name: "On the Dashboard",
    bindings: [
      { keys: "j / k", action: "Move to the next or previous card" },
      { keys: "Tab, then Enter", action: "Open a conversation" },
      { keys: "?", action: "Show these shortcuts" },
    ],
  },
  {
    name: "In a Conversation",
    bindings: [
      { keys: "1", action: "Not a concern" },
      { keys: "2", action: "Keep an eye on it" },
      { keys: "3", action: "This is a concern" },
      { keys: "4", action: "Report it" },
      { keys: "Up / Down", action: "Move through the reasons" },
      { keys: "Enter", action: "Save with the highlighted reason" },
      { keys: "Escape", action: "Close without deciding" },
    ],
  },
  {
    name: "When a Teammate Wants to Report",
    bindings: [
      { keys: "1", action: "Agree, report it" },
      { keys: "2", action: "Don't report" },
      { keys: "Enter", action: "Save your answer" },
      { keys: "Escape", action: "Close without answering" },
    ],
  },
];
