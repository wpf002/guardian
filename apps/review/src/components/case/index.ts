/** Page-specific components for the case detail. Nothing here is shared chrome. */

export { CaseConsole, type CaseConsoleProps } from "./CaseConsole";
export { ConcurrencePanel, type ConcurrencePanelProps } from "./ConcurrencePanel";
export { ConsequenceCopy, type ConsequenceCopyProps } from "./ConsequenceCopy";
export { DecisionPanel, type DecisionPanelProps } from "./DecisionPanel";
export { ProposeDialog, type ProposeDialogProps, type ProposePayload } from "./ProposeDialog";
export { ReasonList, type ReasonListProps } from "./ReasonList";
export { ReopenPanel, type ReopenPanelProps } from "./ReopenPanel";
export { ReportDraft, type ReportDraftProps } from "./ReportDraft";
export { TimelinePanel, type TimelinePanelProps } from "./TimelinePanel";
export {
  buildSignalList,
  excerptTotal,
  readExcerptCount,
  signalLabel,
  type CaseSignal,
  type SignalLexiconEntry,
} from "./signals";
export { buildReportDraft, CYBERTIPLINE_URL, type ReportDraftInput } from "./draft";
export {
  derivedIncident,
  incidentSourceLine,
  INCIDENT_TYPE_NOTES,
  NCMEC_INCIDENT_TYPES,
  type IncidentChoice,
  type IncidentTypeSource,
  type NcmecIncidentType,
} from "./incident";
export {
  filingHeadline,
  filingReadiness,
  type FilingGap,
  type FilingReadiness,
  type FilingSeverity,
} from "./filing";
export { ReportTrail } from "./ReportTrail";
export { CaseSummary } from "./CaseSummary";
