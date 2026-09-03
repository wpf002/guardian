import { AuditLog, PrismaAuditStore } from "@guardian/audit";
import { createPrismaClient } from "@guardian/schema/db";
import { PrismaCustomerStore } from "./prisma-customers.js";

/**
 * Operator CLI for the ingest edge.
 *
 *   create-customer <name> [--webhook <url>]   mint a customer and print its key once
 *   verify-audit                                walk the audit chain and report the result
 *
 * Environment: DATABASE_URL for both commands, AUDIT_CHAIN_SECRET for
 * verify-audit. The API key is printed to stdout and nowhere else; Guardian
 * keeps only its sha256.
 */

const USAGE = [
  "usage:",
  "  cli create-customer <name> [--webhook <url>]",
  "  cli verify-audit",
].join("\n");

interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new Error(`flag ${arg} needs a value`);
        }
        flags.set(arg.slice(2), next);
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

async function createCustomer(args: ParsedArgs): Promise<number> {
  const name = args.positional.join(" ").trim();
  if (!name) {
    console.error("create-customer needs a name\n" + USAGE);
    return 2;
  }
  for (const flag of args.flags.keys()) {
    if (flag !== "webhook") {
      console.error(`unknown flag --${flag}\n${USAGE}`);
      return 2;
    }
  }
  const webhookUrl = args.flags.get("webhook") ?? null;
  if (webhookUrl !== null && !/^https?:\/\//.test(webhookUrl)) {
    console.error("--webhook must be an http or https url");
    return 2;
  }

  const db = createPrismaClient();
  try {
    const store = new PrismaCustomerStore(db);
    const { customer, apiKey } = await store.createCustomer(name, { webhookUrl });
    console.log(`customer id:    ${customer.id}`);
    console.log(`name:           ${customer.name}`);
    console.log(`webhook url:    ${customer.webhookUrl ?? "(none)"}`);
    console.log(`webhook secret: ${customer.webhookSecret}`);
    console.log(`api key:        ${apiKey}`);
    console.log("");
    console.log("The api key is shown once. Guardian stores only its sha256.");
    return 0;
  } finally {
    await db.$disconnect();
  }
}

async function verifyAudit(): Promise<number> {
  const secret = process.env.AUDIT_CHAIN_SECRET ?? "";
  const db = createPrismaClient();
  try {
    const audit = new AuditLog(new PrismaAuditStore(db), secret);
    const result = await audit.verify();
    if (result.ok) {
      console.log(`audit chain ok: ${result.checked} entries checked, head ${result.head}`);
      return 0;
    }
    console.error(
      `audit chain broken at seq ${result.brokenAt} (${result.reason}) after ${result.checked} good entries: ${result.detail}`,
    );
    return 1;
  } finally {
    await db.$disconnect();
  }
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  switch (args.command) {
    case "create-customer":
      return createCustomer(args);
    case "verify-audit":
      return verifyAudit();
    case undefined:
    case "help":
    case "--help":
      console.log(USAGE);
      return args.command === undefined ? 2 : 0;
    default:
      console.error(`unknown command ${args.command}\n${USAGE}`);
      return 2;
  }
}

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
