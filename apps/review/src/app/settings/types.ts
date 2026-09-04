/**
 * Shapes shared between the server side of /settings and its client controls.
 *
 * Nothing here imports anything at runtime, so a client component can pull a
 * type from it without dragging @guardian/schema, and with it node:fs, into the
 * browser bundle.
 */

/** The wellness limits from DESIGN-UI 11, as this deployment holds them. */
export interface SessionLimits {
  /** T2 case minutes per reviewer per day. */
  sessionBudgetMinutes: number;
  /** Minutes between micro-breaks. */
  microBreakMinutes: number;
  casesPerHour: number;
  /** Collapse of protected spans. A one-way ratchet toward more collapsing. */
  collapseProtectedSpans: boolean;
}

/**
 * Org defaults sit beside the reviewer's own value on every row, because a
 * limit a reviewer cannot see the shape of is a limit they cannot use.
 */
export interface SessionLimitsView {
  orgDefaults: SessionLimits;
  mine: SessionLimits;
}

export interface SessionLimitsState {
  error: string | null;
  message: string | null;
}

export interface LexiconFieldView {
  /** The field name as the lexicon holds it. */
  field: string;
  /** The same name in words, for the picker. */
  label: string;
  /** Phrases this customer added. Base entries are not listed and not editable. */
  added: string[];
  /** How many phrases the base lexicon already carries on this field. */
  baseCount: number;
}

export interface LexiconView {
  baseVersion: string;
  /** base + customer label, the string a score row records. */
  mergedVersion: string;
  fields: LexiconFieldView[];
  addedTotal: number;
}

export interface LexiconState {
  error: string | null;
  /** The fragment the wording guard objected to, quoted back. */
  offendingFragment: string | null;
  /** The wording guard's suggested phrasing. */
  instead: string | null;
  message: string | null;
}

export interface WebhookView {
  url: string | null;
  /** Whether a signing secret exists. The secret itself never leaves the server. */
  secretConfigured: boolean;
}

export interface WebhookState {
  error: string | null;
  message: string | null;
}

/** What a test delivery did, in words a person can act on. */
export interface TestDeliveryState {
  error: string | null;
  message: string | null;
  /** The exact body that was signed, pretty printed, for the operator to compare. */
  sample: string | null;
  attempted: boolean;
}

export interface RetentionRow {
  retentionClass: string;
  /** The class in words. */
  meaning: string;
  duration: string;
  tiers: string;
}
