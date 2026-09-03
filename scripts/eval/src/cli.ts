import { QUICK, runSuite } from "./suite.js";

/**
 * `pnpm eval` runs the DESIGN.md section 10 suite. Exit code 1 when a required
 * test fails, so a threshold change cannot merge without the base-rate
 * simulation and the teen-romance control passing.
 */

const seed = Number(process.env.EVAL_SEED ?? 42);
const json = process.argv.includes("--json");

const suite = await runSuite(seed);

if (json) {
  console.log(JSON.stringify(suite, null, 2));
} else {
  console.log(`Guardian evaluation suite (seed ${seed}${QUICK ? ", quick mode" : ""})\n`);
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

process.exit(suite.requiredPass ? 0 : 1);
