/** Page-specific components for /queue. Nothing here is a general component. */

export { CaseCard, type CaseCardProps } from "./CaseCard";
export { QueueHeader, lastArrivalWords, type QueueHeaderProps } from "./QueueHeader";
export { ContactingCard, type ContactingCardProps } from "./ContactingCard";
export { PeopleList, type PeopleListProps, type View } from "./PeopleList";
export { QueueList, type QueueListProps } from "./QueueList";
export { TargetedCard, type TargetedCardProps } from "./TargetedCard";
export {
  accountLabel,
  bandWord,
  bandsClause,
  claimClause,
  criticalClause,
  signalWord,
  slaClause,
  BREACH_RISK_MINUTES,
  SUPPORT_POSTURE_CHIP,
  SUPPORT_POSTURE_NOTE,
  whenWords,
  whoAndWhen,
  type OpenMode,
} from "./words";
