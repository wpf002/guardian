/**
 * Cross-language parity check for the MinHash index. The TypeScript detector in
 * apps/scorer and the Python service in services/ml must produce identical
 * signatures, or a similarity computed on one side means nothing on the other.
 *
 * Run: node scripts/parity.mjs
 * The printed values are asserted by services/ml/tests/test_scripts.py.
 */
import { ScriptIndex } from "../apps/scorer/dist/detectors/minhash.js";

const index = new ScriptIndex();
const signature = index.signature("guardian parity check string");
console.log("first four:", signature.slice(0, 4));
console.log("length:", signature.length);
