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
