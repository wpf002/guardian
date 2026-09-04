import { detectNormalized, type Detection } from "@guardian/scorer";
import { latestLexiconVersion, loadLexicon, normalize } from "@guardian/schema";
import type { TestResult } from "./suite.js";

/**
 * The normalizer's regression test (ROADMAP R1 / RESEARCH A2).
 *
 * The dataset is `Roblox/roblox-pii-classifier-benchmark`, published alongside
 * PII Classifier v2. Checked against the dataset card and the Hugging Face
 * dataset API on 2026-09-04:
 *
 *   - canonical id `Roblox/roblox-pii-classifier-benchmark`. CLAUDE.md and the
 *     model card both name it `Roblox/roblox-pii-safety-for-chat-benchmark`,
 *     which is the same repo under its old name and resolves to the canonical
 *     id through the API. There is one dataset, not two.
 *   - license apache-2.0, tags synthetic and adversarial, one `test` split,
 *     size 10K<n<100K, created 2026-08-05 and last modified 2026-08-19.
 *   - the card's own line gives 39,202 conversations, 24,518 safe and 14,684
 *     unsafe, fully synthetic English, and states no Roblox user chat data is
 *     included. That last point is why holding it locally is allowed at all
 *     under CLAUDE.md's rule about datasets.
 *
 * The dataset is NOT vendored. It is 39k conversations of evaluation data with
 * no place in a git history, and Guardian's rule kernel is not the model it was
 * built to score. What is committed here is a small hand-written sample in the
 * same shape, covering the evasion families the card names, so the normalizer
 * has a gate that fails loudly when someone simplifies a pass out of it.
 *
 * Evasion families, verbatim from the dataset card's own list: phonetic
 * spelling, character and visual substitutions, homoglyphs, letter spacing,
 * reversed or encoded text, coded language, information split across turns,
 * language puzzles, and pretextual framing. Plus hard negatives, which the card
 * stresses share surface signals with the unsafe cases: server codes, song IDs,
 * XP totals, roleplay addresses, level requirements.
 *
 * One family the card names is deliberately absent: target-speaker attribution
 * is not its own category here, because it is a property every case carries.
 * Only speaker t's turns are ever scored, and `hn-07` and `hn-08` are the two
 * negatives that fail if that rule is ever dropped.
 *
 * What this measures: whether `normalize` plus the phase-1 migration detectors
 * still see an off-platform handoff after the writer obfuscates it. What it
 * does not measure: the model. The model is not loaded here and these 82 cases
 * are not a substitute for 39,202.
 *
 * ## Running against the full dataset
 *
 * When the weights and the dataset are both available locally:
 *
 *   1. Fetch the dataset outside the repo, once, and do not commit it:
 *      `hf download Roblox/roblox-pii-classifier-benchmark --repo-type dataset \
 *         --local-dir ~/.cache/guardian/pii-benchmark`
 *      It is a single parquet file under `data/`. It is synthetic and English
 *      only, and it contains no user chat data, so it is safe to hold. Nothing
 *      in this repo downloads it.
 *   2. Point this file at it: `GUARDIAN_PII_BENCHMARK=~/.cache/guardian/pii-benchmark`.
 *      `loadCases` reads the parquet's `conversation` and `label` columns into
 *      the same `BenchmarkCase` shape used below. The categories change: the
 *      dataset carries a four-way `type` (explicit, bypass, contextual, puzzle)
 *      rather than the finer families here, so report recall by `type` and
 *      treat the committed sample's categories as the finer view.
 *   3. To score the model rather than the normalizer, run it through
 *      `services/ml` with `GUARDIAN_PII_MODEL` set to a local weights path. The
 *      input contract lives in `services/ml/app/classifiers.py` and is pinned
 *      by `services/ml/tests/test_pii_contract.py`; do not re-implement it here.
 *
 * Neither step is wired in, on purpose. A committed test that silently depends
 * on a half-gigabyte download is a test that stops running.
 */

/** The three labels Roblox PII v2 emits, in its fixed index order. */
export type PiiLabel =
  | "PRIVACY_ASKING_FOR_PII"
  | "PRIVACY_GIVING_PII"
  | "DIRECTING_USERS_OFF_PLATFORM";

/**
 * The evasion families from the dataset card, split finer than the card's own
 * four-way `type` so a regression names the transform that broke.
 */
export type EvasionCategory =
  | "explicit"
  | "letter_spacing"
  | "homoglyph"
  | "leet_substitution"
  | "phonetic"
  | "coded_language"
  | "reversed_text"
  | "split_across_turns"
  | "pretextual"
  | "puzzle"
  | "hard_negative";

export interface BenchmarkTurn {
  /** The literal "t" is the speaker being scored. Everyone else is context. */
  speaker: string;
  text: string;
}

export interface BenchmarkCase {
  id: string;
  category: EvasionCategory;
  /** The dataset card's own coarse taxonomy. Null for ordinary safe examples. */
  type: "explicit" | "bypass" | "contextual" | "puzzle" | null;
  conversation: BenchmarkTurn[];
  /** Labels that apply to speaker t. An empty list means safe. */
  labels: PiiLabel[];
}

/**
 * 82 hand-written cases. Written for this repo, not copied from the dataset,
 * so nothing here is derivative of Roblox's evaluation split.
 *
 * Every unsafe case is an off-platform handoff or a handle exchange, because
 * that is the DESIGN.md section 5 signal the phase-1 detectors actually claim.
 * Asking-for-PII cases that carry no platform and no handle are deliberately
 * absent: the rule kernel does not claim them, and padding the sample with
 * cases nothing is meant to catch would only depress the number.
 */
export const CASES: BenchmarkCase[] = [
  // --- explicit: the unobfuscated baseline the evasions are measured against
  { id: "ex-01", category: "explicit", type: "explicit", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me on discord so we can talk there" }] },
  { id: "ex-02", category: "explicit", type: "explicit", labels: ["DIRECTING_USERS_OFF_PLATFORM", "PRIVACY_ASKING_FOR_PII"], conversation: [{ speaker: "s1", text: "this chat is so laggy" }, { speaker: "t", text: "whats your snap" }] },
  { id: "ex-03", category: "explicit", type: "explicit", labels: ["DIRECTING_USERS_OFF_PLATFORM", "PRIVACY_GIVING_PII"], conversation: [{ speaker: "t", text: "my username is corvid_8813 on telegram" }] },
  { id: "ex-04", category: "explicit", type: "explicit", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "ok" }, { speaker: "t", text: "lets move to kik, its easier" }] },
  { id: "ex-05", category: "explicit", type: "explicit", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "dm me on instagram instead" }] },
  { id: "ex-06", category: "explicit", type: "explicit", labels: ["DIRECTING_USERS_OFF_PLATFORM", "PRIVACY_GIVING_PII"], conversation: [{ speaker: "s1", text: "how do i find you" }, { speaker: "t", text: "my discord is rainpath#4412" }] },
  { id: "ex-07", category: "explicit", type: "explicit", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "talk to me on whatsapp, this place is monitored" }] },
  { id: "ex-08", category: "explicit", type: "explicit", labels: ["DIRECTING_USERS_OFF_PLATFORM", "PRIVACY_ASKING_FOR_PII"], conversation: [{ speaker: "t", text: "add my snap, whats your username" }] },

  // --- letter spacing: "s n a p c h a t", "d.i.s.c.o.r.d"
  { id: "ls-01", category: "letter_spacing", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me on s n a p c h a t" }] },
  { id: "ls-02", category: "letter_spacing", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "dm me on d i s c o r d" }] },
  { id: "ls-03", category: "letter_spacing", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "where else are you on" }, { speaker: "t", text: "t.e.l.e.g.r.a.m" }, { speaker: "t", text: "add me there" }] },
  { id: "ls-04", category: "letter_spacing", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "im on w h a t s a p p too, message me" }] },
  { id: "ls-05", category: "letter_spacing", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "i n s t a g r a m is better, find me on there" }] },
  { id: "ls-06", category: "letter_spacing", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "k-i-k, add me" }] },
  { id: "ls-07", category: "letter_spacing", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "sure" }, { speaker: "t", text: "s.n.a.p me, its faster" }] },
  { id: "ls-08", category: "letter_spacing", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "o m e g l e later? go to it" }] },

  // --- homoglyphs: Cyrillic and Greek lookalikes
  { id: "hg-01", category: "homoglyph", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me on discοrd" }] },
  { id: "hg-02", category: "homoglyph", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "dm me on ѕnapchat" }] },
  { id: "hg-03", category: "homoglyph", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "ok how" }, { speaker: "t", text: "telegrаm, add my user" }] },
  { id: "hg-04", category: "homoglyph", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "move to кik" }] },
  { id: "hg-05", category: "homoglyph", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "instаgram instead, i barely check here" }] },
  { id: "hg-06", category: "homoglyph", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me on whаtsapp" }] },
  { id: "hg-07", category: "homoglyph", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "we can chat on sіgnal" }] },

  // --- leet and character substitution
  { id: "lt-01", category: "leet_substitution", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me on d1sc0rd" }] },
  { id: "lt-02", category: "leet_substitution", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "whats your sn@p" }] },
  { id: "lt-03", category: "leet_substitution", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "dm me on t3l3gram" }] },
  { id: "lt-04", category: "leet_substitution", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "where" }, { speaker: "t", text: "k1k, add me" }] },
  { id: "lt-05", category: "leet_substitution", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "im on wh4tsapp, message me there" }] },
  { id: "lt-06", category: "leet_substitution", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "1nsta is better, find me" }] },
  { id: "lt-07", category: "leet_substitution", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "d15cord, go to it and add me" }] },

  // --- phonetic spelling
  { id: "ph-01", category: "phonetic", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me on dis cord" }] },
  { id: "ph-02", category: "phonetic", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "snappp chat me instead" }] },
  { id: "ph-03", category: "phonetic", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "where else" }, { speaker: "t", text: "telly gram, add me on there" }] },
  { id: "ph-04", category: "phonetic", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "whatss appp me, i check it more" }] },
  { id: "ph-05", category: "phonetic", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "insta graam, find me there" }] },
  { id: "ph-06", category: "phonetic", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "kiiik, add me" }] },

  // --- coded language: the emoji and slang the case files record
  { id: "cd-01", category: "coded_language", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM", "PRIVACY_ASKING_FOR_PII"], conversation: [{ speaker: "t", text: "whats your @ on 👻" }] },
  { id: "cd-02", category: "coded_language", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me on 💿" }] },
  { id: "cd-03", category: "coded_language", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "ok" }, { speaker: "t", text: "im on ✈️ too, message me" }] },
  { id: "cd-04", category: "coded_language", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "leVe the game and lets chat on 💿" }] },
  { id: "cd-05", category: "coded_language", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM", "PRIVACY_ASKING_FOR_PII"], conversation: [{ speaker: "t", text: "whats your 📸 handle" }] },
  { id: "cd-06", category: "coded_language", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "the app with the ghost, add me on there" }] },
  { id: "cd-07", category: "coded_language", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "cord instead? go to it" }] },

  // --- reversed text. The normalizer has no reversal pass, so this family is
  // an open gap rather than a passing row. It is committed anyway: a recorded
  // low number is what makes the gap visible in every run.
  { id: "rv-01", category: "reversed_text", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me on drocsid" }] },
  { id: "rv-02", category: "reversed_text", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "im on tahcpans, find me" }] },
  { id: "rv-03", category: "reversed_text", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "margelet, add me there" }] },
  { id: "rv-04", category: "reversed_text", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "what" }, { speaker: "t", text: "read it backwards. kik" }] },
  { id: "rv-05", category: "reversed_text", type: "bypass", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "margatsni is where i actually am" }] },

  // --- split across turns: no single message carries the ask
  { id: "sp-01", category: "split_across_turns", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM", "PRIVACY_ASKING_FOR_PII"], conversation: [{ speaker: "t", text: "whats your" }, { speaker: "s1", text: "my what" }, { speaker: "t", text: "snap" }] },
  { id: "sp-02", category: "split_across_turns", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "add me" }, { speaker: "s1", text: "where" }, { speaker: "t", text: "on discord" }] },
  { id: "sp-03", category: "split_across_turns", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM", "PRIVACY_GIVING_PII"], conversation: [{ speaker: "t", text: "my user is" }, { speaker: "t", text: "corvid_8813" }, { speaker: "t", text: "on telegram" }] },
  { id: "sp-04", category: "split_across_turns", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "we should talk" }, { speaker: "s1", text: "ok" }, { speaker: "t", text: "somewhere else" }, { speaker: "t", text: "kik" }] },
  { id: "sp-05", category: "split_across_turns", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "snap" }, { speaker: "s1", text: "?" }, { speaker: "t", text: "add me on it" }] },
  { id: "sp-06", category: "split_across_turns", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "insta" }, { speaker: "s1", text: "what about it" }, { speaker: "t", text: "message me there instead" }] },
  { id: "sp-07", category: "split_across_turns", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "you got" }, { speaker: "t", text: "whatsapp" }, { speaker: "s1", text: "yeah" }, { speaker: "t", text: "add me" }] },
  { id: "sp-08", category: "split_across_turns", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "this chat gets read" }, { speaker: "t", text: "go to telegram" }] },

  // --- pretextual framing: a reason wrapped around the ask
  { id: "px-01", category: "pretextual", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "the mods here delete everything, add me on discord and ill explain" }] },
  { id: "px-02", category: "pretextual", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "i can send you the free skin but only over snapchat, whats your user" }] },
  { id: "px-03", category: "pretextual", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "s1", text: "why not here" }, { speaker: "t", text: "my account keeps getting banned, so message me on telegram" }] },
  { id: "px-04", category: "pretextual", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "im a dev for the game, hit me on discord for the tester role" }] },
  { id: "px-05", category: "pretextual", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "voice is broken in this game, lets talk on whatsapp" }] },
  { id: "px-06", category: "pretextual", type: "contextual", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "im giving away robux but i need to add you on kik first" }] },

  // --- puzzles: the ask only resolves after a step of reasoning
  { id: "pz-01", category: "puzzle", type: "puzzle", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "first letter of dog, then iscord. add me there" }] },
  { id: "pz-02", category: "puzzle", type: "puzzle", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "the yellow app with the white ghost. go to it" }] },
  { id: "pz-03", category: "puzzle", type: "puzzle", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "rhymes with pelegram. add my user there" }] },
  { id: "pz-04", category: "puzzle", type: "puzzle", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "same name as the paper airplane emoji, find me on it" }] },
  { id: "pz-05", category: "puzzle", type: "puzzle", labels: ["DIRECTING_USERS_OFF_PLATFORM"], conversation: [{ speaker: "t", text: "its the one green bubble apps cant do. message me over there" }] },

  // --- hard negatives. The dataset card's point: safe text carrying the same
  // surface signals. Server codes, song ids, xp totals, roleplay addresses,
  // level requirements, and ordinary chat about the apps themselves.
  { id: "hn-01", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "the song id is 1847592013 if you want it" }] },
  { id: "hn-02", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "server code is 7741, join whenever" }] },
  { id: "hn-03", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "you need 4200 xp before the next level" }] },
  { id: "hn-04", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "my roleplay house is at 14 maple lane in brookhaven" }] },
  { id: "hn-05", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "discord was down for everyone last night" }] },
  { id: "hn-06", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "instagram keeps crashing on my old phone" }] },
  { id: "hn-07", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "s1", text: "whats your snap" }, { speaker: "t", text: "i dont have one" }] },
  { id: "hn-08", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "s1", text: "add me on discord" }, { speaker: "t", text: "cant, my parents dont let me have it" }] },
  { id: "hn-09", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "level 30 required for that sword" }] },
  { id: "hn-10", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "gg that was a close game" }] },
  { id: "hn-11", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "the update notes are on the game page not on telegram lol" }] },
  { id: "hn-12", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "my brother uses whatsapp for school stuff" }] },
  { id: "hn-13", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "code 8812 gets you in the private server" }] },
  { id: "hn-14", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "i beat my old score, 91400 now" }] },
  { id: "hn-15", category: "hard_negative", type: null, labels: [], conversation: [{ speaker: "t", text: "the trading plaza is way better than the old one" }] },
];

/**
 * Recorded 2026-09-04. Identical on lexicon v1 and v2, and the run reports the
 * version it used, so a lexicon bump that moves a row is visible in the output.
 * These are the numbers the normalizer
 * and the phase-1 detectors actually produced, not targets. A category may fall
 * 15 points below its recorded value before this test fails, matching the
 * evasion red-team bar in DESIGN.md section 10. A rise is a reason to re-record
 * the line, never a failure.
 *
 * Overall: 52 of 67 obfuscated handoffs seen, and 3 of 15 hard negatives
 * flagged. The low rows are recorded rather than rounded up, because a gate
 * that hides its own gaps is worth nothing. What each low row means:
 *
 *   puzzle 0.00           Nothing fires. These need a reasoning step the rule
 *                         kernel does not do, and a lexicon cannot close it.
 *                         The row exists so the gap is visible every run.
 *   reversed_text 0.20    The one hit is the generic "add me on" phrase, not
 *                         the reversed platform name. The normalizer has no
 *                         reversal pass. Cheap to add, packages/schema owns it.
 *   phonetic 0.67         "kiiik" collapses to "kiik" and "whatss appp" does
 *                         not compact to "whatsapp". Run collapsing is capped
 *                         at two characters.
 *   coded_language 0.71   Two causes, both filed below in NOTES.
 *   letter_spacing 0.75   "k-i-k" compacts to a three character needle and the
 *                         platform-move check skips anything under four.
 *   hard_negative 0.20    Three false positives, all one bug. See NOTES.
 */
export const BASELINE: Record<EvasionCategory, number> = {
  explicit: 1,
  letter_spacing: 0.75,
  homoglyph: 1,
  leet_substitution: 1,
  phonetic: 0.66667,
  coded_language: 0.71429,
  reversed_text: 0.2,
  split_across_turns: 1,
  pretextual: 1,
  puzzle: 0,
  hard_negative: 0.2,
};

/**
 * Findings this benchmark surfaced on its first run, 2026-09-04. All three are
 * in packages/schema and apps/scorer, not here. Recorded so the next person
 * reading a low row does not have to rediscover why.
 *
 * 1. Emoji keys with a variation selector never match. `normalize` iterates
 *    code points, so a two code point key like the airplane or the dove is
 *    unreachable in `lexicon.emoji`. Two of the fifteen emoji entries are dead
 *    today. Either key the map by grapheme or strip U+FE0F before lookup.
 *
 * 2. `findHandoffs` treats the word after a platform name as a handle. The
 *    handle pattern allows an optional separator, so "discord was down for
 *    everyone last night" reads as discord plus the handle "was". That is all
 *    three hard-negative false positives, and the same shape as the song-id and
 *    server-code negatives the dataset card warns about.
 *
 * 3. The platform-move check needs a compact needle of four characters or more,
 *    which excludes "kik" entirely in spaced or punctuated form.
 */
export const NOTES = [
  "normalize: emoji keys carrying U+FE0F are unreachable, two lexicon entries are dead",
  "findHandoffs: a platform name followed by any word reads as a handle",
  "findPlatformMove: compact needles under four characters are skipped, so kik is invisible when spaced",
] as const;

/** How far a category may fall below its recorded value before this fails. */
export const DROP_LIMIT_POINTS = 15;

/** The detector kinds that count as seeing an off-platform handoff. */
const MIGRATION_KINDS = new Set(["off_platform_migration"]);

export interface CaseOutcome {
  id: string;
  category: EvasionCategory;
  unsafe: boolean;
  /** Any single turn from speaker t fired on its own. */
  perTurn: boolean;
  /** The window of speaker t's turns, joined, fired. */
  joined: boolean;
  detected: boolean;
  matched: string[];
}

function targetTurns(c: BenchmarkCase): string[] {
  return c.conversation.filter((turn) => turn.speaker === "t").map((turn) => turn.text);
}

function fired(detections: Detection[]): Detection[] {
  return detections.filter((d) => MIGRATION_KINDS.has(d.kind));
}

/**
 * Run one case through the normalizer and the phase-1 migration detectors.
 *
 * Only speaker t's turns are scored. That is the dataset's attribution rule and
 * it is also Guardian's: the pair scorer sees the actor's own messages, so
 * another speaker naming a platform must never score against t.
 *
 * Two windows are evaluated. Per-turn is what the kernel does today, one event
 * at a time. Joined is t's turns concatenated, which is the window a
 * conversation-level model gets. The difference between them is the cost of
 * being message-scoped, and split-across-turns is where it shows up.
 */
export function runCase(c: BenchmarkCase, lexicon = loadLexicon()): CaseOutcome {
  const turns = targetTurns(c);
  const ctx = { lexicon, actorBand: "UNKNOWN", targetBand: "UNKNOWN" } as const;

  const perTurnHits = turns.flatMap((text) => fired(detectNormalized(normalize(text, lexicon), ctx)));
  const joinedHits = fired(detectNormalized(normalize(turns.join(" "), lexicon), ctx));

  return {
    id: c.id,
    category: c.category,
    unsafe: c.labels.length > 0,
    perTurn: perTurnHits.length > 0,
    joined: joinedHits.length > 0,
    detected: perTurnHits.length > 0 || joinedHits.length > 0,
    matched: [...new Set([...perTurnHits, ...joinedHits].map((d) => d.matched))],
  };
}

export interface CategoryReport {
  category: EvasionCategory;
  cases: number;
  detected: number;
  /** Recall for unsafe categories, false-positive rate for hard negatives. */
  rate: number;
  baseline: number;
  dropPoints: number;
  pass: boolean;
  /** Cases the joined window caught and the per-turn window missed. */
  neededJoinedWindow: number;
}

export function reportByCategory(outcomes: CaseOutcome[]): CategoryReport[] {
  const categories = [...new Set(CASES.map((c) => c.category))];
  const out: CategoryReport[] = [];

  for (const category of categories) {
    const rows = outcomes.filter((o) => o.category === category);
    if (rows.length === 0) continue;
    const detected = rows.filter((o) => o.detected).length;
    const rate = detected / rows.length;
    const baseline = BASELINE[category];
    // For hard negatives the rate is a false-positive rate, so a rise is the
    // regression. Same 15-point band, other direction.
    const dropPoints =
      category === "hard_negative" ? (rate - baseline) * 100 : (baseline - rate) * 100;

    out.push({
      category,
      cases: rows.length,
      detected,
      rate,
      baseline,
      dropPoints,
      pass: dropPoints <= DROP_LIMIT_POINTS,
      neededJoinedWindow: rows.filter((o) => o.joined && !o.perTurn).length,
    });
  }

  return out;
}

/**
 * The suite entry. Non-required: this is the normalizer's regression gate, not
 * one of the two tests CLAUDE.md names as blocking a threshold change.
 */
export async function piiEvasionBenchmark(): Promise<TestResult> {
  const lexicon = loadLexicon();
  const outcomes = CASES.map((c) => runCase(c, lexicon));
  const reports = reportByCategory(outcomes);

  const unsafe = outcomes.filter((o) => o.unsafe);
  const negatives = outcomes.filter((o) => !o.unsafe);
  const overallRecall = unsafe.filter((o) => o.detected).length / Math.max(1, unsafe.length);
  const falsePositives = negatives.filter((o) => o.detected).length;

  const failures = reports.filter((r) => !r.pass);
  // Anything under half is an open gap, not a passing row that happens to be
  // low. Naming them in the detail keeps them in front of whoever runs this.
  const gaps = reports.filter((r) => r.category !== "hard_negative" && r.rate < 0.5);

  const metrics: Record<string, number | string | null> = {
    lexiconVersion: latestLexiconVersion(),
    cases: outcomes.length,
    unsafeCases: unsafe.length,
    hardNegatives: negatives.length,
    overallRecall: round(overallRecall),
    falsePositives,
    neededJoinedWindow: outcomes.filter((o) => o.joined && !o.perTurn).length,
  };
  for (const r of reports) {
    metrics[`${r.category}_rate`] = round(r.rate);
    metrics[`${r.category}_baseline`] = round(r.baseline);
  }
  for (const [i, note] of NOTES.entries()) metrics[`openFinding_${i + 1}`] = note;

  const detail =
    failures.length === 0
      ? [
          `${(overallRecall * 100).toFixed(1)}% recall over ${unsafe.length} obfuscated handoffs`,
          `${falsePositives} of ${negatives.length} hard negatives flagged`,
          gaps.length > 0 ? `open gaps: ${gaps.map((g) => g.category).join(", ")}` : null,
        ]
          .filter((part): part is string => part !== null)
          .join(", ")
      : failures
          .map(
            (f) =>
              `${f.category} moved ${f.dropPoints.toFixed(1)} points against a recorded ${(f.baseline * 100).toFixed(1)}% (limit ${DROP_LIMIT_POINTS})`,
          )
          .join("; ");

  return {
    name: "PII evasion benchmark",
    required: false,
    pass: failures.length === 0,
    detail,
    metrics,
  };
}

function round(value: number): number {
  return Number(value.toFixed(5));
}
