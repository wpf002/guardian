/** Page-specific components for the case detail. Nothing here is shared chrome. */

export { ActorPanel, type ActorPanelProps } from "./ActorPanel";
export { CaseConsole, type CaseConsoleProps } from "./CaseConsole";
export { ConsequenceCopy, type ConsequenceCopyProps } from "./ConsequenceCopy";
export { DecisionPanel, type DecisionPanelProps } from "./DecisionPanel";
export { PolicyPanel, type PolicyPanelProps } from "./PolicyPanel";
export { ProposeDialog, type ProposeDialogProps, type ProposePayload } from "./ProposeDialog";
export { ProvenanceLine, type ProvenanceLineProps } from "./ProvenanceLine";
export { ReasonList, type ReasonListProps } from "./ReasonList";
export { ReopenPanel, type ReopenPanelProps } from "./ReopenPanel";
export { ReportDraft, type ReportDraftProps } from "./ReportDraft";
export { SeverityStrip, type SeverityStripProps } from "./SeverityStrip";
export { SignalList, type SignalListProps } from "./SignalList";
export { TimelinePanel, type TimelinePanelProps } from "./TimelinePanel";
export { WhyPanel, type WhyPanelProps } from "./WhyPanel";
export {
  buildSignalList,
  excerptTotal,
  readExcerptCount,
  signalLabel,
  type CaseSignal,
  type SignalLexiconEntry,
} from "./signals";
export { buildReportDraft, CYBERTIPLINE_URL, type ReportDraftInput } from "./draft";
