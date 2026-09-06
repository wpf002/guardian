/**
 * The eight CyberTipline incident types, and what choosing each one means.
 *
 * These are in their own module, and the values are literals rather than an
 * import, for the same reason cybertipline.ts next door holds one constant: the
 * report draft's incident selector is a client component, and importing them
 * from @guardian/report would pull the report builder, the schema barrel and
 * the lexicon loader into the browser bundle. The lexicon loader reads from
 * disk, so the build fails rather than merely bloating.
 *
 * incident-types.test.ts asserts this list is exactly NCMEC_INCIDENT_TYPES from
 * the package, so the duplication cannot drift. The strings are wire values off
 * the public API documentation and are not reworded here even where Guardian's
 * own copy uses different language.
 */

export const NCMEC_INCIDENT_TYPES = [
  "Child Pornography (possession, manufacture, and distribution)",
  "Child Sex Trafficking",
  "Child Sex Tourism",
  "Child Sexual Molestation",
  "Misleading Domain Name",
  "Misleading Words or Digital Images on the Internet",
  "Online Enticement of Children for Sexual Acts",
  "Unsolicited Obscene Material Sent to a Child",
] as const;
export type NcmecIncidentType = (typeof NCMEC_INCIDENT_TYPES)[number];

/** Where the type on a draft came from. Printed on the draft itself. */
export type IncidentTypeSource = "signals" | "reviewer" | "default";

export interface IncidentChoice {
  incidentType: NcmecIncidentType;
  source: IncidentTypeSource;
  /** Signal names behind a derived type. Empty for a fallback or a choice. */
  drivenBy: string[];
}

/** What a reviewer picking one of the eight is choosing, in plain words. */
export const INCIDENT_TYPE_NOTES: Record<NcmecIncidentType, string> = {
  "Child Pornography (possession, manufacture, and distribution)":
    "Only where your own scanner established a match. Guardian never opened a file and cannot support this on its own.",
  "Child Sex Trafficking":
    "Something of value offered or exchanged, with the conversation moving toward a meeting.",
  "Child Sex Tourism": "Travel arranged or discussed for the purpose of sexual contact with a child.",
  "Child Sexual Molestation": "Contact offending described in the conversation, rather than solicited in it.",
  "Misleading Domain Name": "A domain built to route a child to sexual material.",
  "Misleading Words or Digital Images on the Internet":
    "Listings or words built to route a child to sexual material.",
  "Online Enticement of Children for Sexual Acts":
    "Solicitation of a child over a service. Sextortion is reported here, with the sextortion annotation set.",
  "Unsolicited Obscene Material Sent to a Child":
    "Sexual material sent to a child who did not ask for it.",
};

/**
 * One line for the draft saying where the type came from. A report categorised
 * by a fallback has to say so somewhere the filer can see it, because NCMEC
 * routes on the field and nothing downstream distinguishes a default from a
 * finding.
 */
export function incidentSourceLine(choice: IncidentChoice): string {
  switch (choice.source) {
    case "signals":
      return `derived from the recorded signals (${choice.drivenBy.join(", ")})`;
    case "reviewer":
      return "chosen by the reviewer";
    default:
      return "a fallback. No recorded signal maps to a type and no reviewer chose one. Choose one before filing";
  }
}
