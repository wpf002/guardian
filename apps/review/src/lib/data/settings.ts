/**
 * Customer settings, including the per-customer lexicon extension.
 *
 * The extension is merged over the base lexicon at load, so it is a real write
 * path into detection. Suppression lists are deliberately not extendable here:
 * for an exemption, adding is blinding (ROADMAP S3).
 */

import { getPrisma, isMockMode } from "../db";
import { getMockData } from "../mock/fixtures";
import { loadReviewers, type Session } from "../session";
import type { CustomerSettings } from "./types";

export interface SeatView {
  reviewerId: string;
  displayName: string;
  role: "reviewer" | "operator" | "owner";
}

export async function getCustomerSettings(session: Session): Promise<CustomerSettings | null> {
  if (isMockMode()) {
    const data = await getMockData();
    return data.customer.customerId === session.customerId ? data.customer : null;
  }
  const prisma = await getPrisma();
  const row = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: {
      id: true,
      name: true,
      jurisdictionCountry: true,
      jurisdictionSubdivision: true,
      legalBasis: true,
      crossCustomerOptIn: true,
      lexiconExtension: true,
      timezone: true,
      ncmecProviderName: true,
      ncmecEspId: true,
      contactName: true,
      contactEmail: true,
      // Read as a presence check only. The console never shows a credential
      // and never holds a plaintext one: this column is ciphertext, and the
      // only thing said about it is whether there is one.
      ncmecCredentialCiphertext: true,
      endToEndEncrypted: true,
    },
  });
  if (!row) return null;
  return {
    customerId: row.id,
    name: row.name,
    jurisdictionCountry: row.jurisdictionCountry,
    jurisdictionSubdivision: row.jurisdictionSubdivision,
    legalBasis: row.legalBasis,
    crossCustomerOptIn: row.crossCustomerOptIn,
    lexiconExtension:
      typeof row.lexiconExtension === "object" && row.lexiconExtension !== null
        ? (row.lexiconExtension as Record<string, unknown>)
        : null,
    timezone: row.timezone,
    ncmecProviderName: row.ncmecProviderName,
    ncmecEspId: row.ncmecEspId,
    contactOnFile: Boolean(row.contactName) && Boolean(row.contactEmail),
    credentialsOnFile: row.ncmecCredentialCiphertext !== null,
    endToEndEncrypted: row.endToEndEncrypted,
  };
}

export async function getLexiconExtension(
  session: Session,
): Promise<Record<string, unknown> | null> {
  const settings = await getCustomerSettings(session);
  return settings?.lexiconExtension ?? null;
}

/**
 * Replaces the customer's lexicon extension. Operator and owner only, which the
 * route enforces with requireRole before it gets here.
 */
export async function updateLexiconExtension(
  session: Session,
  extension: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (isMockMode()) {
    const data = await getMockData();
    data.customer.lexiconExtension = extension;
    return extension;
  }
  const prisma = await getPrisma();
  await prisma.customer.update({
    where: { id: session.customerId },
    data: { lexiconExtension: extension as never },
  });
  return extension;
}

/**
 * Seats on this partition. Pre-SSO these come from the REVIEWERS env roster
 * rather than a table, which is why there is no seat management write here.
 */
export function listSeats(session: Session): SeatView[] {
  return loadReviewers()
    .filter((r) => r.customerId === session.customerId)
    .map((r) => ({ reviewerId: r.id, displayName: r.name, role: r.role }));
}

/** A T3 needs two people. Below two seats the concurrence path cannot complete. */
export function hasSecondSeat(session: Session): boolean {
  return listSeats(session).length >= 2;
}

/**
 * Who the organization is when it sends a report: its name, a person NCMEC can
 * contact, and where it is. Owner only.
 *
 * The report card listed each of these as missing and said to add them "in
 * settings", and there was nowhere in the console to do it. A report on a real
 * account could never become ready to send.
 */
export interface ReportingDetails {
  organizationName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  region: string | null;
  timezone: string | null;
}

export async function getReportingDetails(session: Session): Promise<ReportingDetails | null> {
  if (isMockMode()) {
    const data = await getMockData();
    if (data.customer.customerId !== session.customerId) return null;
    return {
      organizationName: data.customer.ncmecProviderName,
      contactName: data.reportingContact.name,
      contactEmail: data.reportingContact.email,
      country: data.customer.jurisdictionCountry,
      region: data.customer.jurisdictionSubdivision,
      timezone: data.customer.timezone,
    };
  }
  const prisma = await getPrisma();
  const row = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: {
      ncmecProviderName: true,
      contactName: true,
      contactEmail: true,
      jurisdictionCountry: true,
      jurisdictionSubdivision: true,
      timezone: true,
    },
  });
  if (!row) return null;
  return {
    organizationName: row.ncmecProviderName,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    country: row.jurisdictionCountry,
    region: row.jurisdictionSubdivision,
    timezone: row.timezone,
  };
}

export async function updateReportingDetails(
  session: Session,
  details: ReportingDetails,
): Promise<void> {
  if (isMockMode()) {
    const data = await getMockData();
    data.customer.ncmecProviderName = details.organizationName;
    data.customer.jurisdictionCountry = details.country;
    data.customer.jurisdictionSubdivision = details.region;
    data.customer.timezone = details.timezone;
    data.customer.contactOnFile = Boolean(details.contactName) && Boolean(details.contactEmail);
    data.reportingContact = { name: details.contactName, email: details.contactEmail };
    return;
  }
  const prisma = await getPrisma();
  await prisma.customer.update({
    where: { id: session.customerId },
    data: {
      ncmecProviderName: details.organizationName,
      contactName: details.contactName,
      contactEmail: details.contactEmail,
      jurisdictionCountry: details.country,
      jurisdictionSubdivision: details.region,
      timezone: details.timezone,
    },
  });
}
