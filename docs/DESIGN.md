# Guardian

One detection kernel and one reporting pipeline for online child grooming, sextortion, and trafficking recruitment. Four surfaces on top: a platform SDK, a Discord bot, an investigator triage tool, and a parent app.

Owner: Will · Status: pre-code · Stack: TS / Fastify / Prisma / Postgres / Railway + Python FastAPI for ML · v0.1 · 2026-09-03

**Name.** Guardian. Not coupled to Warden.

## 1. What the research says

Twenty-eight sources plus a sweep of the current tech and legal picture. The parts that change the design:

### The detection gap is at small and mid-size platforms

NCMEC took 21.3M CyberTipline reports in 2025; five companies filed over 75% of them. Online enticement reports (grooming + sextortion) hit 1.4M, up 158% year over year. Roblox, with 100M+ daily users and 3,000 moderators, had no automated grooming detection before 2022 and the word "grooming" wasn't in its 2022 moderation guide. Its actual catches came from YouTubers. Everything below Roblox's size has nothing.

### The investigation gap is victim identification

HSI's Cyber Crimes Center had roughly 7–10 full-time victim-ID analysts against 89,000 unidentified CSAM image series (up from 57,000 in 2024). Stanford's 2024 study found CyberTipline reports are often incomplete or duplicative and the ones most likely to rescue a child aren't sufficiently investigated. The Renewed Hope funding (\$108.5M, 200 positions, June 2026) helps, but triage is still the bottleneck. ICAC's 61 task forces ran ~347,000 investigations in 2025 with 17,000 arrests.

### Predators run a repeatable playbook

Every source describes the same sequence. Contact in open chat → trust via mirroring → probe for supervision gaps ("are your parents divorced?") → sexualize → request images → coerce. Bait is Robux, gift cards, Cash App, Amazon. The move off-platform to Snapchat, Discord, Telegram is a near-universal step, and kids and predators both encode it (👻 = Snapchat, 💿 = Discord, "leVe" for "leave"). DHS notes the whole sequence can compress into minutes. Financial sextortion is even more templated: 90% of victims are boys 14–17, two-thirds financial, 47% of offenders tied to Nigeria/Côte d'Ivoire, 38% of threats reuse "ruin your life" verbatim, payment demanded within minutes of a reciprocal image.

### Open-source models now exist, without weights

Roblox open-sourced Sentinel (Aug 2025, Apache-2.0) and, via ROOST in Aug 2026, Sentinel v2, a PII/off-platform-migration classifier (189 languages, F1 90.5, on Hugging Face) and a voice safety classifier. Sentinel ships the framework and code but no trained weights or exemplars. Thorn's Safer Predict text classifier (six categories including grooming and sextortion) is sold B2B, also resold through Hive's API. Academic grooming classifiers hit F1 0.89–0.99 on PAN-2012, but that dataset is decoy-based, English, and 14 years old. Nobody publishes precision at production base rates.

### Civilian hunting is a dead end

Schlep got a cease-and-desist and permanent ban from Roblox for decoy stings, despite six arrests. A Pennsylvania judge dismissed vigilante-sting cases for not meeting the legal standard. Prosecutors say only sworn officers can pose as minors. Evidence fails on chain of custody, entrapment, and edited video. Roblox's position after settling with Ruben Sim for \$150K: "safety enforcement should be left to trained professionals." That's the policy every platform will adopt.

## 2. Hard constraints

These aren't preferences. Each one has a criminal statute or a dismissed case behind it.

| Constraint                                                     | Why                                                                                                                                                                                            | Design consequence                                                                                                                                                                |
|----------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Never possess, store, download, or train on suspected CSAM     | 18 USC 2252/2252A. No detection or research exception. Only defense is \<3 items promptly destroyed or reported.                                                                               | Images and video are hash-only. PhotoDNA / Safer / Google Content Safety API run on the platform's side or via hosted API; Guardian stores the hash and the verdict, never bytes. |
| No decoy accounts posing as minors                             | Entrapment, evidence dismissal, platform ToS bans, and in some counties charges against the hunter.                                                                                            | Guardian observes real traffic only. No persona generation, ever. Product refuses that feature request.                                                                           |
| No covert interception of messages                             | ECPA/Wiretap Act; 12 all-party-consent states; vicarious parental consent (Pollock) is unsettled and never covers someone else's kid.                                                          | Parent surface is overt, device-owner-authorized, on-device-first. Platform and Discord surfaces run with the operator's authority over their own service.                        |
| Report to NCMEC, not to police directly, and not to the public | 18 USC 2258A provider duty (REPORT Act 2024): report on actual knowledge, preserve 1 year, fines to \$1M for willful failure. Immunity under 2258B covers providers, not freelance collectors. | One reporting path: CyberTipline ESP API. No "expose" feature. No public wall of shame.                                                                                           |
| Don't act at police direction                                  | Private-search doctrine (*US v. Wilson*, 9th Cir. 2021): a tool steered by police becomes a government agent and evidence gets suppressed.                                                     | Investigator surface consumes LE data and tips; it doesn't take LE tasking into Guardian's private-platform detection.                                                            |
| Children's data is COPPA data                                  | Amended COPPA rule enforceable since Apr 22, 2026: separate consent for third-party disclosure, written retention policy, biometrics are PII.                                                  | Minimize: store features and hashes, not raw chat, wherever the score allows. Retention policy written before the first customer.                                                 |
| Your classifier output isn't protected by Section 230          | 230 covers hosting user content. A false accusation generated by Guardian is Guardian's speech.                                                                                                | Guardian never asserts "this user is a predator." It emits a risk tier and evidence bundle for human review. Wording matters in every UI string.                                  |

## 3. Threat model

Three offender patterns, one shared front end. The stage model is Child Rescue Coalition's six steps, which lines up with DHS, FBI, and the Bloomberg case files.

**1 Contact**Open chat, game lobby, server. Fake peer-age profile. "You look nice."

**2 Trust**Open-ended questions, mirroring, gifts. Robux, gift cards, art commissions.

**3 Supervision probe**Parents' marital status, siblings, who checks your phone, own device?

**4 Isolate / migrate**Move to Snapchat, Discord, Telegram. Coded emoji. "Delete this."

**5 Sexualize / request**Dating talk, "u single", image ask, reciprocal image.

**6 Coerce**Threats to expose, payment demand, countdown, meetup.

| Pattern                 | Who                                                                                      | Tempo            | Where it ends                                                              | Decisive signal                                                                                                              |
|-------------------------|------------------------------------------------------------------------------------------|------------------|----------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| Relationship grooming   | Individual adult, often a game dev, moderator, or "older friend"; runs many alt accounts | Days to years    | Image production or in-person abduction (Castillo, Penczak, McElroy cases) | Stage 3 + stage 4 in the same relationship. Supervision probing followed by migration is almost never innocent.              |
| Financial sextortion    | Organized crews, mostly West Africa, scripted                                            | Minutes to hours | Payment via Cash App / gift cards / crypto; repeat extortion               | Reciprocal image → payment handle or threat template within one session. New account, catfish profile.                       |
| Trafficking recruitment | Recruiter posing as boyfriend, employer, or peer; ~1/3 of trafficking is familial        | Weeks            | Runaway, sex ad, controlled "boyfriend"                                    | Off-platform migration + travel/meetup logistics + promised money or housing. Downstream: the kid's face or handle in an ad. |

## 4. Product shape

You asked for all four surfaces. They only make sense as one product if they share the expensive parts. The expensive parts are the detection kernel, the evidence and reporting pipeline, and the review queue. Each surface is a thin adapter that decides what traffic enters the kernel and what happens to a tiered result.

![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgOTAwIDM4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiBmb250LWZhbWlseT0iSUJNIFBsZXggU2Fucywgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMyI+CiAgPGRlZnM+PG1hcmtlciBpZD0iYXJyIiB2aWV3Ym94PSIwIDAgMTAgMTAiIHJlZng9IjkiIHJlZnk9IjUiIG1hcmtlcndpZHRoPSI3IiBtYXJrZXJoZWlnaHQ9IjciIG9yaWVudD0iYXV0byI+PHBhdGggZD0iTTAsMCBMMTAsNSBMMCwxMCB6IiBmaWxsPSJ2YXIoLS1pbmstMikiPjwvcGF0aD48L21hcmtlcj48L2RlZnM+CiAgPCEtLSBzdXJmYWNlcyAtLT4KICA8ZyBmaWxsPSJ2YXIoLS1zdXJmYWNlKSIgc3Ryb2tlPSJ2YXIoLS1saW5lKSI+CiAgICA8cmVjdCB4PSIyMCIgeT0iMjAiIHdpZHRoPSIxOTAiIGhlaWdodD0iNjQiIHJ4PSI1Ij48L3JlY3Q+CiAgICA8cmVjdCB4PSIyNDAiIHk9IjIwIiB3aWR0aD0iMTkwIiBoZWlnaHQ9IjY0IiByeD0iNSI+PC9yZWN0PgogICAgPHJlY3QgeD0iNDYwIiB5PSIyMCIgd2lkdGg9IjE5MCIgaGVpZ2h0PSI2NCIgcng9IjUiPjwvcmVjdD4KICAgIDxyZWN0IHg9IjY4MCIgeT0iMjAiIHdpZHRoPSIyMDAiIGhlaWdodD0iNjQiIHJ4PSI1Ij48L3JlY3Q+CiAgPC9nPgogIDxnIGZpbGw9InZhcigtLWluaykiIGZvbnQtd2VpZ2h0PSI2MDAiPgogICAgPHRleHQgeD0iMTE1IiB5PSI0NSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+UGxhdGZvcm0gU0RLIC8gQVBJPC90ZXh0PgogICAgPHRleHQgeD0iMzM1IiB5PSI0NSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RGlzY29yZCBib3Q8L3RleHQ+CiAgICA8dGV4dCB4PSI1NTUiIHk9IjQ1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5QYXJlbnQgYXBwPC90ZXh0PgogICAgPHRleHQgeD0iNzgwIiB5PSI0NSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+SW52ZXN0aWdhdG9yIHRyaWFnZTwvdGV4dD4KICA8L2c+CiAgPGcgZmlsbD0idmFyKC0taW5rLTIpIiBmb250LXNpemU9IjExLjUiPgogICAgPHRleHQgeD0iMTE1IiB5PSI2NiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+d2ViaG9vayAvIGJhdGNoIGV2ZW50czwvdGV4dD4KICAgIDx0ZXh0IHg9IjMzNSIgeT0iNjYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPmdhdGV3YXkgZXZlbnRzPC90ZXh0PgogICAgPHRleHQgeD0iNTU1IiB5PSI2NiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+b24tZGV2aWNlIHNjb3JpbmcsIHVwbG9hZCBmbGFnczwvdGV4dD4KICAgIDx0ZXh0IHg9Ijc4MCIgeT0iNjYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPnRpcHMsIGFkcywgTEUgZXhwb3J0czwvdGV4dD4KICA8L2c+CiAgPCEtLSBhcnJvd3MgZG93biAtLT4KICA8ZyBzdHJva2U9InZhcigtLWluay0yKSIgc3Ryb2tlLXdpZHRoPSIxLjUiIGZpbGw9Im5vbmUiIG1hcmtlci1lbmQ9InVybCgjYXJyKSI+CiAgICA8cGF0aCBkPSJNMTE1LDg0IEwxMTUsMTIwIj48L3BhdGg+PHBhdGggZD0iTTMzNSw4NCBMMzM1LDEyMCI+PC9wYXRoPjxwYXRoIGQ9Ik01NTUsODQgTDU1NSwxMjAiPjwvcGF0aD48cGF0aCBkPSJNNzgwLDg0IEw3ODAsMTIwIj48L3BhdGg+CiAgPC9nPgogIDwhLS0gaW5nZXN0IC0tPgogIDxyZWN0IHg9IjIwIiB5PSIxMjIiIHdpZHRoPSI4NjAiIGhlaWdodD0iNDQiIHJ4PSI1IiBmaWxsPSJ2YXIoLS1hY2NlbnQtc29mdCkiIHN0cm9rZT0idmFyKC0tYWNjZW50KSI+PC9yZWN0PgogIDx0ZXh0IHg9IjQ1MCIgeT0iMTQ5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ2YXIoLS1pbmspIiBmb250LXdlaWdodD0iNjAwIj5Jbmdlc3QgJmFtcDsgbm9ybWFsaXplIOKGkiBjYW5vbmljYWwgRXZlbnQge2FjdG9yLCB0YXJnZXQsIGNoYW5uZWwsIHRleHQsIG1lZGlhX2hhc2gsIHRzLCBhZ2VfYmFuZCwgcHJvdmVuYW5jZX08L3RleHQ+CiAgPHBhdGggZD0iTTQ1MCwxNjYgTDQ1MCwxOTYiIHN0cm9rZT0idmFyKC0taW5rLTIpIiBzdHJva2Utd2lkdGg9IjEuNSIgZmlsbD0ibm9uZSIgbWFya2VyLWVuZD0idXJsKCNhcnIpIj48L3BhdGg+CiAgPCEtLSBrZXJuZWwgLS0+CiAgPHJlY3QgeD0iMjAiIHk9IjE5OCIgd2lkdGg9Ijg2MCIgaGVpZ2h0PSI5NiIgcng9IjUiIGZpbGw9InZhcigtLXN1cmZhY2UpIiBzdHJva2U9InZhcigtLWxpbmUpIj48L3JlY3Q+CiAgPHRleHQgeD0iMzQiIHk9IjIyMCIgZmlsbD0idmFyKC0taW5rKSIgZm9udC13ZWlnaHQ9IjYwMCI+RGV0ZWN0aW9uIGtlcm5lbDwvdGV4dD4KICA8ZyBmaWxsPSJ2YXIoLS1iZykiIHN0cm9rZT0idmFyKC0tbGluZSkiPgogICAgPHJlY3QgeD0iMzQiIHk9IjIzMiIgd2lkdGg9IjE1MCIgaGVpZ2h0PSI0OCIgcng9IjQiPjwvcmVjdD48cmVjdCB4PSIxOTYiIHk9IjIzMiIgd2lkdGg9IjE1MCIgaGVpZ2h0PSI0OCIgcng9IjQiPjwvcmVjdD48cmVjdCB4PSIzNTgiIHk9IjIzMiIgd2lkdGg9IjE1MCIgaGVpZ2h0PSI0OCIgcng9IjQiPjwvcmVjdD48cmVjdCB4PSI1MjAiIHk9IjIzMiIgd2lkdGg9IjE1MCIgaGVpZ2h0PSI0OCIgcng9IjQiPjwvcmVjdD48cmVjdCB4PSI2ODIiIHk9IjIzMiIgd2lkdGg9IjE4NCIgaGVpZ2h0PSI0OCIgcng9IjQiPjwvcmVjdD4KICA8L2c+CiAgPGcgZmlsbD0idmFyKC0taW5rKSIgZm9udC1zaXplPSIxMiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+CiAgICA8dGV4dCB4PSIxMDkiIHk9IjI1MiI+U3RhZ2UgY2xhc3NpZmllcjwvdGV4dD48dGV4dCB4PSIxMDkiIHk9IjI2OCIgZmlsbD0idmFyKC0taW5rLTIpIiBmb250LXNpemU9IjExIj50ZXh0LCBwZXIgbWVzc2FnZTwvdGV4dD4KICAgIDx0ZXh0IHg9IjI3MSIgeT0iMjUyIj5NaWdyYXRpb24gLyBQSUk8L3RleHQ+PHRleHQgeD0iMjcxIiB5PSIyNjgiIGZpbGw9InZhcigtLWluay0yKSIgZm9udC1zaXplPSIxMSI+Um9ibG94IHdlaWdodHM8L3RleHQ+CiAgICA8dGV4dCB4PSI0MzMiIHk9IjI1MiI+U2NyaXB0IG1hdGNoZXI8L3RleHQ+PHRleHQgeD0iNDMzIiB5PSIyNjgiIGZpbGw9InZhcigtLWluay0yKSIgZm9udC1zaXplPSIxMSI+TWluSGFzaCwgc2V4dG9ydGlvbjwvdGV4dD4KICAgIDx0ZXh0IHg9IjU5NSIgeT0iMjUyIj5HcmFwaCBmZWF0dXJlczwvdGV4dD48dGV4dCB4PSI1OTUiIHk9IjI2OCIgZmlsbD0idmFyKC0taW5rLTIpIiBmb250LXNpemU9IjExIj5mYW4tb3V0LCBhZ2UgZ2FwLCBhbHRzPC90ZXh0PgogICAgPHRleHQgeD0iNzc0IiB5PSIyNTIiPlNrZXcgdHJhY2tlciArIGZ1c2lvbjwvdGV4dD48dGV4dCB4PSI3NzQiIHk9IjI2OCIgZmlsbD0idmFyKC0taW5rLTIpIiBmb250LXNpemU9IjExIj5wZXIgcGFpciwgcGVyIGFjdG9yIOKGkiB0aWVyPC90ZXh0PgogIDwvZz4KICA8cGF0aCBkPSJNNDUwLDI5NCBMNDUwLDMyMiIgc3Ryb2tlPSJ2YXIoLS1pbmstMikiIHN0cm9rZS13aWR0aD0iMS41IiBmaWxsPSJub25lIiBtYXJrZXItZW5kPSJ1cmwoI2FycikiPjwvcGF0aD4KICA8IS0tIG91dHB1dHMgLS0+CiAgPGcgZmlsbD0idmFyKC0tc3VyZmFjZSkiIHN0cm9rZT0idmFyKC0tbGluZSkiPgogICAgPHJlY3QgeD0iMjAiIHk9IjMyNCIgd2lkdGg9IjI3MCIgaGVpZ2h0PSI0MCIgcng9IjUiPjwvcmVjdD48cmVjdCB4PSIzMTUiIHk9IjMyNCIgd2lkdGg9IjI3MCIgaGVpZ2h0PSI0MCIgcng9IjUiPjwvcmVjdD48cmVjdCB4PSI2MTAiIHk9IjMyNCIgd2lkdGg9IjI3MCIgaGVpZ2h0PSI0MCIgcng9IjUiPjwvcmVjdD4KICA8L2c+CiAgPGcgZmlsbD0idmFyKC0taW5rKSIgZm9udC13ZWlnaHQ9IjYwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+CiAgICA8dGV4dCB4PSIxNTUiIHk9IjM0OSI+UmV2aWV3IHF1ZXVlIChodW1hbik8L3RleHQ+CiAgICA8dGV4dCB4PSI0NTAiIHk9IjM0OSI+RXZpZGVuY2UgYnVuZGxlICsgaGFzaC1jaGFpbmVkIGF1ZGl0PC90ZXh0PgogICAgPHRleHQgeD0iNzQ1IiB5PSIzNDkiPkN5YmVyVGlwbGluZSByZXBvcnQgKyAxLXlyIHByZXNlcnZlPC90ZXh0PgogIDwvZz4KPC9zdmc+)

The kernel never sees who the customer is. It scores an event stream and returns a tier per (actor, target) pair and per actor. That's what lets one model serve a 40-person Discord server, a 2M-user game, and a single family's phone.

## 5. Signal catalog

Every signal below comes from a documented case or a published classifier. Weights are starting points for the fusion layer, not gospel. The last column is what will burn you.

| Signal                                                                                           | Stage    | Extractor                                                 | Weight | False-positive trap                                                                   |
|--------------------------------------------------------------------------------------------------|----------|-----------------------------------------------------------|--------|---------------------------------------------------------------------------------------|
| Supervision probing: parents' status, who checks your phone, own room/device, home alone         | 3        | Stage classifier + pattern list                           | high   | Peers ask this too. Needs age-gap or asymmetry to fire alone.                         |
| Off-platform migration ask: handle exchange, "add me on", emoji codes, "dm me", QR               | 4        | Roblox PII classifier v2 + emoji/leet lexicon             | high   | Kids swap handles with each other constantly. Weight by age gap and initiator.        |
| Secrecy instruction: "don't tell", "delete this", "our secret"                                   | 4        | Pattern + classifier                                      | high   | Surprise-party planning. Rare enough to accept.                                       |
| Economic bait: Robux, gift cards, Cash App, "I'll buy you", art commission from a minor          | 2        | Entity extraction (payment handles, currency, item names) | med    | Legit trading and giveaways in game communities. Requires directionality adult→minor. |
| Age/relationship framing: "u single", "age is just a number", dating talk to under-13            | 5        | Stage classifier                                          | high   | Teen-to-teen romance is lawful. Age bands decide.                                     |
| Image solicitation, reciprocal image offer                                                       | 5        | Stage classifier; media event without bytes               | high   | Selfie exchange among friends. Combine with 3/4.                                      |
| Threat template: "ruin your life", "send to your parents/school", countdown timers               | 6        | MinHash against script corpus; regex for countdowns       | crit   | Almost none. Scripts are reused verbatim.                                             |
| Payment demand within N minutes of a media exchange                                              | 6        | Temporal join: media event → payment entity               | crit   | None in practice.                                                                     |
| Meetup logistics: address, travel, "pick you up", bus/ride                                       | 6        | Entity + classifier                                       | crit   | Local friends. Age gap gates it.                                                      |
| Actor fan-out: one account initiating with many under-13/under-16 targets                        | 1        | Graph feature, rolling 7/30 day                           | med    | Popular streamers, mods, teachers. Whitelist roles, still surface.                    |
| Account age \< 72h + high outbound DM rate + no prior public activity                            | 1        | Graph feature                                             | med    | New legit users. Only a multiplier.                                                   |
| Alt-account clustering: device/IP/typing-fingerprint matches to a banned actor                   | 1        | Platform-supplied identifiers, hashed                     | high   | Shared household devices.                                                             |
| Skew: actor's message distribution drifting toward grooming index over time, not averaging out   | all      | Sentinel-style contrastive skew                           | high   | Requires exemplar set you build yourself.                                             |
| Known-CSAM hash match                                                                            | 5–6      | PhotoDNA / Safer on operator side                         | crit   | Hash collisions are rare; still human-reviewed by the operator, never by Guardian.    |
| Sex-ad content featuring a known minor's handle, face-hash, or phone (investigator surface only) | traffick | Scraper + hash join against tip data                      | crit   | Ad content is adult by default. Only joins to an existing tip count.                  |

## 6. Scoring algorithm

The mistake in every academic grooming paper is scoring a conversation as a whole and averaging. Averaging buries a 30-second escalation inside a week of "what's your favorite game." Sentinel's core insight is right: track skew, not mean. Guardian scores three things and fuses them.

### 6.1 Per-message stage probability

A small fine-tuned encoder (start with DeBERTa-v3-small or a distilled LLaMA-3.2-1B, whichever hits F1 ≥ 0.85 on the held-out PANC + your own labeled set) emits a distribution over {none, contact, trust, probe, migrate, sexualize, coerce}. It runs on every inbound message from an actor whose age band is above the target's. Messages between same-band accounts are scored at reduced priority.

### 6.2 Per-pair trajectory score

For each (actor, target) pair, maintain a stage vector over time. The score is not the sum. It's the ordered progression: how many stages have been hit, in what order, over what window. Stage 3 followed by stage 4 within 24 hours is the single strongest pattern in the case files, and it's cheap to compute.

    pair_score(P) =
        w_prog * progression(stage_hits, order_weights)     // did they walk the ladder
      + w_vel  * velocity(stage_hits, window=24h)           // how fast
      + w_asym * asymmetry(initiator_ratio, question_ratio) // who's driving
      + w_gap  * age_gap_multiplier(actor_band, target_band)
      + w_econ * economic_bait_events
      + crit_override(threat_template | payment_after_media | meetup_logistics)

    progression: pairs of consecutive stages hit in order get bonus,
      (3→4) and (5→6) transitions weighted 2x.
    crit_override: any critical signal sets tier ≥ T2 regardless of sum.

### 6.3 Per-actor skew score

Embed each of the actor's messages (same encoder, mean-pooled). Maintain two reference centroids: a grooming exemplar set and a benign chat set for the platform. The actor score is the fraction of their recent messages closer to the grooming centroid, weighted by recency, plus the graph features (fan-out to younger bands, account age, alt clustering). An actor whose skew is rising across many pairs is the fan-out predator Roblox missed for years.

### 6.4 Fusion and tiers

Fusion is a gradient-boosted model over the three scores plus raw features, trained on your labeled review outcomes once you have them. Until then it's hand-tuned. Output is one of four tiers, and every tier maps to an action the operator configured, never an accusation.

| Tier                                     | Meaning                                                 | Default action                                                                                  | Target PPV |
|------------------------------------------|---------------------------------------------------------|-------------------------------------------------------------------------------------------------|------------|
| `T0`             | Nothing notable                                         | Discard features after retention window                                                         | —          |
| `T1 watch`   | One or two mid signals                                  | Retain features 30d; raise priority on the pair; no human                                       | ≥ 10%      |
| `T2 review` | Progression pattern or one critical signal              | Human review queue within 4h; operator may friction the actor (rate-limit, block DMs to minors) | ≥ 40%      |
| `T3 report` | Reviewer-confirmed enticement, sextortion, or CSAM hash | CyberTipline report, 1-year preservation, operator enforcement                                  | ≥ 90%      |

**Base rates will wreck naive thresholds.** PAN-12 is 3% positive. Real platforms are closer to 0.01%. A classifier with 99% specificity at that rate produces about 100 false alarms per true hit. That's why T2 requires either a progression pattern or a critical signal, and why the reviewer, not the model, is the only thing that can produce T3. Budget reviewer minutes per 1,000 users as a first-class metric.

### 6.5 Evasion handling

Coded language and out-of-vocabulary tokens are the documented failure mode of fine-tuned encoders. Three cheap counters: a normalization layer that maps known emoji and leet codes before tokenization (👻→snapchat, 💿→discord, "leVe"→leave), a per-platform lexicon that operators can extend, and the skew tracker, which catches distribution drift even when individual messages don't classify. Periodically mine T2+ confirmed cases for new tokens the encoder missed and feed them back into the lexicon.

## 7. Architecture

Standard stack. The only Python is the ML service.

| Service    | Tech                                           | Job                                                                                                                                                                              |
|------------|------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `ingest`   | Fastify, TS                                    | Auth per customer (API key + HMAC on webhooks), schema validation, PII minimization, canonical Event write to a queue. Rejects raw media bytes at the edge; accepts hashes only. |
| `queue`    | Redis Streams (reuse the Hive routing pattern) | Fan events to feature workers. Per-customer partitions so a noisy platform can't starve a small one.                                                                             |
| `features` | TS workers                                     | Normalization, entity extraction, graph features, temporal joins. Stateless; state lives in Postgres + Redis.                                                                    |
| `ml`       | Python FastAPI, GPU on demand                  | Stage classifier, embeddings, Roblox PII classifier, MinHash script index. Versioned models; every score records model version.                                                  |
| `scorer`   | TS                                             | Pair trajectory, actor skew, fusion, tier assignment, action dispatch to the customer's webhook.                                                                                 |
| `cases`    | Postgres via Prisma                            | Pairs, actors, tiers, reviewer decisions, evidence bundles (text excerpts + hashes + timestamps + model versions), retention timers.                                             |
| `audit`    | Hash-chained append-only log (Latch pattern)   | Every score, every reviewer action, every export. Chain of custody is what makes a report survive a defense motion.                                                              |
| `report`   | TS                                             | CyberTipline ESP API client. Builds the report from the evidence bundle, submits, stores the report ID, starts the 1-year preservation timer.                                    |
| `review`   | Next.js                                        | Reviewer queue: evidence timeline, stage annotations, one-click decisions (dismiss / watch / confirm / report). Records decision + reason, feeds the fusion model.               |

### Data handling rules

- Media: hash in, hash stored, bytes never transit Guardian. If a customer sends bytes, the edge drops the request and logs a customer-side violation.
- Text: T0 events keep features only, raw text discarded within 24h. T1+ keep the excerpts needed for the evidence bundle. T3 keeps everything for one year per 2258A.
- Identifiers: customer-supplied user IDs are salted-hashed per customer. Guardian can't join across customers without the customer's key. (Lantern-style cross-platform sharing is a later, opt-in feature.)
- Age bands, not birthdates. Six bands matching Roblox's scheme so their classifiers drop in.
- Every stored row carries a retention class and a customer ID. Deletion is a job, not a hope.

## 8. The four surfaces

#### Platform SDK / API `core`

Small and mid games, chat apps, edtech, kids' communities. The customer is a 2258A provider and Guardian is their processor.

- TS and Python SDKs wrapping the Event schema; webhook for tiers.
- Customer runs PhotoDNA/Safer themselves or through Guardian's hosted proxy; Guardian gets the verdict.
- Review queue is white-label; customer's own reviewers make T3 calls. Guardian files the CyberTipline report as the customer's agent.
- Pricing per monthly active minor-band user plus reviewer seats.
- Must not: return "predator" labels, accept media bytes, expose one customer's signals to another without opt-in.

#### Discord bot `wedge`

Owners of kid-heavy servers (Roblox, Minecraft, Fortnite communities). Ships first.

- Reads server messages the bot is authorized to see. Cannot read DMs, and that's fine: the DM *request* happens in public channels first.
- Age bands from server roles + Discord's teen-by-default status; owner tags trusted adults.
- Actions: flag to a mod channel, auto-timeout on T2 if the owner enables it, evidence bundle for the owner to file at report.cybertip.org (owner is the reporter; Guardian drafts).
- Migration-ask and economic-bait detectors do most of the work here.
- Must not: scrape servers it isn't installed in, DM the suspected actor, DM the kid.

#### Investigator triage `partner-gated`

ICAC units, NCPTF-style NGOs, Tebow Foundation "Find" partners, C3 victim-ID analysts. Needs one real LE or NGO partner before you build past a demo.

- Tip triage: dedupe and cluster CyberTipline exports the unit already holds (Stanford's exact complaint), rank by identifiable-victim, production, enticement, live-stream.
- Victim-ID assist: incidental-detail extraction from case notes (not media): brands, place names, school mascots, dialect. Scout-style scope gating, every query logged.
- Sex-ad monitor: scrape new ads, extract handles/phones/face-hashes, join against the unit's existing minor tips. Alert only on a join. Mirrors the "Find" model TTF funds.
- Guardian never holds the imagery. It holds the unit's structured data and produces leads.
- Must not: take tasking that steers the platform kernel (private-search doctrine), operate without a signed agreement and a named custodian.

#### Parent app `last`

Parents of 8–15 year olds. Crowded market, weakest legal footing, iOS blocks in-app scanning.

- On-device scoring: the encoder runs on the phone; only tier events leave the device. Parent sees "a contact is pushing your kid to move to Snapchat and asking about your custody arrangement," never the transcript by default.
- Kid-visible. The app tells the child it's running. Overt monitoring is what makes vicarious consent defensible and what the child-safety orgs recommend (Safe House Project: collaborative monitoring).
- Android first via accessibility/notification access; iOS via Screen Time API + charger-sync fallback like Bark.
- Reports go through the parent (NCMEC public form, Know2Protect tipline 1-833-591-5669). Guardian drafts, preserves originals unaltered per DHS guidance.
- Must not: monitor a device the account holder doesn't own, monitor covertly, store transcripts server-side.

## 9. Legal guardrails

Things to do before the first paying customer. Get counsel for the two flagged items; I'm not one.

1.  Written data retention and security program (COPPA amended rule). Retention classes are in the schema from day one.
2.  Processor agreement template making the customer the 2258A provider and reporter of record, with Guardian as agent. **Counsel:** whether Guardian itself is a "provider" when it stores T1+ excerpts.
3.  NCMEC ESP registration for CyberTipline API access. Requires the customer relationship to be real; do this with the first platform customer, not before.
4.  Parent app: terms establishing device ownership and parental authority; state-by-state notice for all-party-consent states. **Counsel:** vicarious consent for a vendor rather than the parent.
5.  No decoy, no expose, no direct-to-police features. Write it into the product principles so a customer can't buy it.
6.  Reviewer wellness. ICAC funds Innocent Justice Foundation for a reason. Rotation limits, no-image policy (Guardian never shows imagery), counseling stipend in the reviewer contract.
7.  Investigator surface only under a signed agreement naming a custodian and scope, with audit export on demand.

## 10. Evaluation

Numbers to hit before calling any tier real.

| Test                            | Data                                                                                                                                       | Pass                                                   |
|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| Stage classifier, segment-level | PANC (3,179 grooming / 29,331 non) + PJZC + 2,000 hand-labeled modern samples you build from public case filings and platform-donated data | F1 ≥ 0.85, and ≥ 0.80 on the modern set alone          |
| Early warning latency           | Vogt 2021 protocol                                                                                                                         | Median ≤ 15 messages to first T1 on positives          |
| Base-rate simulation            | Inject positives at 0.01% into a benign stream (Discord public server dumps, ToS-cleared)                                                  | T2 PPV ≥ 40%, ≤ 2 reviewer-minutes per 1,000 users/day |
| Teen-romance control            | Same-band romantic chat corpus                                                                                                             | T2 rate ≤ 0.1% of pairs                                |
| Evasion red team                | Rewrite 500 positives with emoji codes, leet, indirection, non-English                                                                     | Recall drop ≤ 15 points                                |
| Sextortion script match         | Public threat-message corpus (Thorn/NCMEC excerpts, court filings)                                                                         | Recall ≥ 0.9 at ≤ 1 FP per 100k messages               |
| Audit chain                     | Tamper a stored evidence row                                                                                                               | Verification fails and names the row                   |

## 11. Build order

Sequenced so each step is sellable on its own and de-risks the next.

1.  **Kernel v0 + Discord bot (weeks 1–6).** Normalizer, migration/PII classifier (Roblox weights), economic-bait entities, sextortion MinHash, fan-out graph, rule-based fusion, mod-channel alerts, evidence bundle export. No NCMEC API yet. Install on three friendly servers. This proves the signal catalog on real traffic and starts the labeled set.
2.  **Stage classifier + review queue (weeks 6–12).** Fine-tune on PANC/PJZC + bot-collected labels. Ship the Next.js reviewer. Fusion becomes learned.
3.  **Platform SDK + reporting (weeks 12–20).** Event schema SDKs, webhooks, retention jobs, audit chain, NCMEC ESP registration with first customer, CyberTipline client. This is the revenue product.
4.  **Investigator triage (after one partner signs).** Tip dedupe/clustering first; it's the cheapest thing that solves Stanford's complaint. Sex-ad monitor second.
5.  **Parent app (last).** Only once the on-device encoder is small enough and counsel has cleared the consent posture. It reuses everything above.

## 12. Open risks

- **Labeled data.** Every public dataset is decoy-based. The first real labels come from the Discord bot and reviewer decisions. Until then production precision is a guess.
- **Platform hostility.** Roblox treats third-party safety actors as adversaries. The SDK sells to platforms that want help; it can't observe the ones that don't.
- **Thorn/Hive overlap.** Safer Predict already does the text classifier for big platforms. Guardian's edge is the trajectory/skew scoring, the reviewer workflow, the reporting pipeline, and a price small platforms can pay. If Hive undercuts on price, the differentiator is the workflow, not the model.
- **Reviewer supply.** T3 requires humans. Your customers may not have any. Offer reviewer-as-a-service only with the wellness program in place.
- **Regulatory drift.** KOSA advanced in Senate Commerce Aug 2026; STOP CSAM rode the Senate NDAA in July. Either could impose duties on small platforms overnight, which is good for demand and bad for compliance surface.
- **Discord API limits.** Message-content intent requires verification above 100 servers. Plan for it around week 10.

## Sources

From your list, plus the tech/legal sweep. Pages that returned 403 (state.gov, wng.org, DHS PSA, IMDb, APA) were reconstructed from mirrors or coverage; those are marked.

- [Child safety on Roblox (Wikipedia)](https://en.wikipedia.org/wiki/Child_safety_on_Roblox)
- [Roblox's Pedophile Problem (Bloomberg, 2024)](https://www.bloomberg.com/features/2024-roblox-pedophile-problem)
- [Roblox banned predator hunter Schlep (ABC Australia)](https://www.abc.net.au/news/2025-08-30/roblox-banned-predator-hunter-schlep-gaming-kids-watching/105711644) · IMDb item via [Wikipedia](https://en.wikipedia.org/wiki/Roblox%E2%80%93Schlep_controversy) and Tubefilter (403 direct)
- [APA Monitor Jan 2022](https://www.apa.org/monitor/2022/01/jn) (bot-blocked; not used for claims)
- [ICE/HSI victim identification](https://www.ice.gov/news/releases/route-locating-child-predators-often-through-identification-their-victims)
- [RCMP Gazette, Hunting online predators](https://rcmp.ca/en/gazette/hunting-online-predators)
- [Child Rescue Coalition, six grooming steps](https://childrescuecoalition.org/educations/investigator-shares-6-steps-predators-take-to-groom-kids-online/)
- [OJJDP ICAC Task Force Program](https://ojjdp.ojp.gov/programs/internet-crimes-against-children-task-force-program)
- [FBI VCAC](https://www.fbi.gov/investigate/violent-crime/vcac) · [FBI Parents and Caregivers](https://www.fbi.gov/how-we-can-help-you/parents-and-caregivers-protecting-your-kids)
- [DHS Know2Protect, Take Action](https://www.dhs.gov/know2protect/take-action) · PSA release via [HSToday](https://www.hstoday.us/subject-matter-areas/cybersecurity/dhs-know2protect-tim-tebow-foundation-release-new-psa-to-stop-online-child-exploitation/) (403 direct)
- [Predator Catching Discord](https://discord.com/servers/predator-catching-catching-watching-and-exposing-1358800547322396702) · [PredCord invite](https://discord.com/invite/J95xTTx)
- [TTF Anti-Human Trafficking](https://timtebowfoundation.org/ministries/anti-human-trafficking-1) · [TTF stories](https://timtebowfoundation.org/stories/anti-human-trafficking) · [TTF Disrupt](https://timtebowfoundation.org/disrupt)
- [Waltz/Tebow UN effort (Fox)](https://www.foxnews.com/politics/mike-waltz-tim-tebow-launch-effort-combat-online-child-exploitation-happening-their-backyard) · Renewed Hope Act via [TTF](https://timtebowfoundation.org/stories/tim-tebow-applauds-passage-legislation-rescue-tens-thousands-sexually-exploited-children) and [Fox](https://www.foxnews.com/sports/tim-tebow-testifies-before-senate-committee-bipartisan-bill-combat-child-exploitation) (wng.org 403)
- State Dept 20 Ways (403) via [HIPRC reprint](https://hiprc.org/blog/help-fight-human-trafficking/)
- [Our Rescue](https://ourrescue.org/) · [UNICEF USA](https://www.unicefusa.org/what-unicef-does/childrens-protection/end-child-trafficking) · [Safe House Project](https://www.safehouseproject.org/blog/how-can-i-protect-my-child-from-trafficking/) · [Polaris training](https://polarisproject.org/training/) · [ACF OTIP](https://acf.gov/otip/about/ways-endtrafficking) · [Texas HHSC donation portal](https://feepay.txapps.texas.gov/hhsc/stop-human-trafficking-donation-service/)
- [NCMEC CyberTipline 2025 data](https://www.missingkids.org/gethelpnow/cybertipline/cybertiplinedata) · [Stanford, online child safety ecosystem (2024)](https://cyberlaw.stanford.edu/publications/the-strengths-and-weaknesses-of-the-online-child-safety-ecosystem)
- [Roblox Sentinel](https://about.roblox.com/newsroom/2025/08/open-sourcing-roblox-sentinel-preemptive-risk-detection) · [GitHub](https://github.com/Roblox/Sentinel) · [Roblox/ROOST Aug 2026 models](https://about.roblox.com/newsroom/2026/08/roblox-open-source-safety-models-roost)
- [Thorn Safer](https://safer.io/solutions/) · [Hive CSE text classifier](https://thehive.ai/blog/hive-adds-thorns-grooming-detection-to-cse-text-classifier-api) · [PhotoDNA FAQ](https://www.microsoft.com/en-us/photodna/faq) · [Google Content Safety API](https://protectingchildren.google/tools-for-partners/) · [Tech Coalition Lantern](https://technologycoalition.org/programs/lantern/)
- [Thorn/NCMEC financial sextortion trends](https://www.thorn.org/research/library/financial-sextortion/)
- [Vogt et al. 2021, early grooming detection (PANC)](https://aclanthology.org/2021.acl-long.386.pdf) · [PJZ/PJZC](https://github.com/danielafe7-usp/BF-PSR-Framework) · [SCoRL (NAACL 2025)](https://arxiv.org/abs/2503.06627) · [coded-language failure modes](https://arxiv.org/abs/2502.12576) · [LLaMA-3.2-1B on PAN12 (2025)](https://www.frontiersin.org/journals/pediatrics/articles/10.3389/fped.2025.1591828/full)
- [18 USC 2258A](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title18-section2258A&num=0&edition=prelim) · [18 USC 2252](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title18-section2252&num=0&edition=prelim) · [US v. Wilson (EFF)](https://www.eff.org/deeplinks/2021/09/us-v-wilson-ninth-circuit-reaffirms-fourth-amendment-protection-electronic) · [Pollock v. Pollock](https://www.casemine.com/commentary/us/establishing-vicarious-consent-in-parental-wiretapping:-pollock-v-pollock/view) · [COPPA amended rule](https://www.hunton.com/privacy-and-cybersecurity-law-blog/coppa-rule-amendment-compliance-deadline-approaches) · [Take It Down Act enforcement](https://www.ftc.gov/news-events/news/press-releases/2026/05/ftc-begins-enforcing-take-it-down-act) · [KOSA (Aug 2026)](https://www.commerce.senate.gov/press/rep/release/commerce-committee-advances-kids-online-safety-legislation/) · [STOP CSAM in NDAA](https://www.hawley.senate.gov/hawley-negotiates-inclusion-of-stop-csam-act-in-senate-ndaa/)
- [Prosecutors on vigilante hunters](https://thewieczoreklawfirm.com/blog/prosecutors-warn-against-citizen-vigilante-predator-hunters/) · [Oklahoma Watch on predator hunters](https://oklahomawatch.org/2025/08/01/predator-hunters-tactics-draw-fans-but-concern-police-and-advocates/)

