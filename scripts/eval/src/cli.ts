import { QUICK, runSuite, testNames } from "./suite.js";

/**
 * `pnpm eval` runs the DESIGN.md section 10 suite. Exit code 1 when a required
 * test fails, so a threshold change cannot merge without the base-rate
 * simulation and the teen-romance control passing.
 *
 * Flags:
 *   --json           machine-readable output
 *   --only <name>    run only the tests whose name contains <name>, for example
 *                    `--only pii` for the normalizer's evasion benchmark
 *   --list           print the test names and exit
 */

const seed = Number(process.env.EVAL_SEED ?? 42);
const json = process.argv.includes("--json");

if (process.argv.includes("--list")) {
  for (const name of testNames()) console.log(name);
  process.exit(0);
}

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex === -1 ? undefined : process.argv[onlyIndex + 1];
if (onlyIndex !== -1 && (only === undefined || only.startsWith("--"))) {
  console.error("--only needs a test name. Run --list to see them.");
  process.exit(2);
}

const suite = await runSuite(seed, { only });

if (suite.results.length === 0) {
  console.error(`No test matched "${only}". Run --list to see them.`);
  process.exit(2);
}

if (json) {
  console.log(JSON.stringify(suite, null, 2));
} else {
  console.log(
    `Guardian evaluation suite (seed ${seed}${QUICK ? ", quick mode" : ""}${only ? `, only "${only}"` : ""})\n`,
  );
  console.log(
    [
      "What this measures: whether the rule kernel still separates the documented",
      "structures, including the false-positive traps from DESIGN.md section 5.",
      "It is a regression gate, not a precision estimate. The conversations are",
      "generated from case-file structure because every public grooming dataset is",
      "decoy-based and none can be mirrored here, and the generators draw on the",
      "same phrase families the lexicon holds, so high scores here are a floor and",
      "not a result. The first honest precision number comes from reviewer",
      "decisions on real traffic (DESIGN.md section 12).",
      "",
    ].join("\n"),
  );
  for (const result of suite.results) {
    const mark = result.pass ? "PASS" : "FAIL";
    const tag = result.required ? " [required]" : "";
    console.log(`${mark}  ${result.name}${tag}`);
    console.log(`      ${result.detail}`);
    for (const [key, value] of Object.entries(result.metrics)) {
      console.log(`      ${key}: ${value}`);
    }
    console.log();
  }
  const failed = suite.results.filter((r) => !r.pass);
  console.log(
    failed.length === 0
      ? "All tests passed."
      : `${failed.length} test(s) failed: ${failed.map((f) => f.name).join(", ")}`,
  );
}

// With --only the required gates may not have run at all, so the exit code
// reports what actually ran rather than implying the required set passed.
process.exit((only ? suite.pass : suite.requiredPass) ? 0 : 1);
