# ARCHITECTURE — current state

**This file describes what exists right now, not what is planned.**

`CLAUDE.md` is the contract: rules that do not change. This file is the map: what is built,
how it fits together, and what is still missing. Claude Code reads both at the start of a
session and updates *this* one as the build progresses.

Keep it honest. A stale architecture file is worse than none, because it gets trusted.

---

## Status

| | |
|---|---|
| Current phase | Phase 6a — **Ask Sous shipped** (edge function written, NOT deployed). Scanners and dashboard remain |
| Last updated | 9 August 2026 |
| Repo | `Info-ArcAgentSystems/copper-pot-kitchen` (private) |
| Database | Supabase, schema + 9 migrations, **all applied** (9 Aug) |
| Unit tests | **787 pass**, 2 skipped, 2 todo (`npm run test`) — 0.5s, no network |
| Golden pack | **wired** — 15 pass, 2 skipped pending owner, 2 todo |
| Integration | **41 pass** (`npm run test:integration`) — live Supabase, run deliberately. Occasionally flaky under latency, see Known gaps |

---

## Progress log

Append a line whenever a phase or meaningful step completes. This is the record a future
session reads to work out where things stand.

| Date | Done |
|---|---|
| 30 Jul 2026 | GitHub org `Info-ArcAgentSystems` created; private repo `copper-pot-kitchen` |
| 30 Jul 2026 | Five contract documents committed (`README`, `REPO_SETUP_GUIDE`, `CLAUDE`, `ARCHITECTURE`, `schema.sql`) |
| 30 Jul 2026 | Supabase project created; `schema.sql` applied cleanly — 22 tables, RLS enabled |
| 30 Jul 2026 | Kitchen row created; `info@arcagentsystems.com` granted `owner`; membership verified |
| 31 Jul 2026 | `BUILD_GUIDE.md` committed — staged build sequence, A through the four priorities |
| 31 Jul 2026 | Vite + React 19 + TS scaffold (create-vite 9.1.2); `.gitignore`, `.gitattributes`, `.env.example`, package scripts. `typecheck`, `build`, `lint`, `dev` all green |
| 31 Jul 2026 | Golden fixture pack placed in `tests/fixtures/` (7 files). Not yet wired to a runner |
| 31 Jul 2026 | Stage B — owner-confirmed Rules 11–17 added to `CLAUDE.md`; three "awaiting owner" items closed |
| 31 Jul 2026 | C1 — `src/engine/types.ts`. Rules 4, 13 and 16 enforced structurally, each verified by compiling deliberate violations. Four items raised with the owner; five migrations proposed, none applied |
| 31 Jul 2026 | C1b — four migrations written; `schema.sql` updated to match. `types.ts` gains `meatEatingGuests`, `excludesMeat`, `recipeUnit`, `recipeUnitsPerStockUnit` |
| 31 Jul 2026 | Migrations **applied and verified** against the live database. 23 tables. `src/data` is unblocked |
| 31 Jul 2026 | C2 — `units.ts` and `meatEatingGuests()` in `rules.ts`, tests written first. `tsconfig.test.json` and an engine-purity test added. **30 tests green** |
| 31 Jul 2026 | C3 — `scaling.ts`: `scaleRecipe` (recurses sub-recipes, cycle-safe) and `portionsToUnits`. `CALC-CURRY-10` and `CALC-LASAGNE-29` reproduced as unit tests. **56 tests green** |
| 1 Aug 2026 | C4 — `production.ts`. Consolidate-then-round proven by temporarily inverting the implementation: the CLAUDE.md 12/18/9 example passed against the bug, the added 1/1/1 guard failed. **85 tests green** |
| 1 Aug 2026 | C5 — `shopping.ts`. All three unit systems run end-to-end. `units.ts` gained `stockToStock` and a pack-side factor fallback. Consolidation guard proven by inversion. **115 tests green** |
| 1 Aug 2026 | C6 — `costing.ts`. Rule 8's sharpest edge: any missing input voids the total. A double-rounding bug was caught by its own test and fixed. **151 tests green** |
| 1 Aug 2026 | C7 — `checks.ts`. Rule 9 enforced by a language test over real output. BBQ guard generalised to course structure. Three inversion checks passed. **185 tests green** |
| 1 Aug 2026 | C8 — `impact.ts`. A pure diff of two cascade runs, enforced by source inspection. Batch-boundary proof: 18→19 portions is +2 kg, not the linear +0.222. **214 tests green** |
| 1 Aug 2026 | C9 — `applyBuffetSplit` finishes `rules.ts` and closes the guest-count gap. Wired into `productionBuckets` and `jobFoodCost`. **231 tests green** |
| 1 Aug 2026 | C10 — `history.ts`. **THE ENGINE IS COMPLETE**: all ten files built, tests written before each. **253 tests green** |
| 1 Aug 2026 | C11 — **golden pack wired**. `npm run test:copperpot` runs: 15 pass, 2 skipped pending owner, 2 todo. Fixtures byte-identical. **268 pass overall** |
| 3 Aug 2026 | Phase 3 begun — `src/data`: client, port, rows, mappers, 9 repositories. **336 pass, 2 skipped, 16 todo** |
| 3 Aug 2026 | Audit trigger **applied and verified** — one row per changed field, nothing for a no-op. `changed_by` and RLS still need the integration tests |
| 3 Aug 2026 | Phase 4a — auth, shell, design tokens. `react-router-dom` added; Vite starter removed. Integration suite written: 17 live tests, **not yet run** |
| 3 Aug 2026 | Env vars re-verified against the correct project after a brief mix-up. Schema probed live: 12 tables, per-guest `job_dietaries` with **no** `guests` column, conversion columns, `job_extras`. Four triggers enabled. No key ever committed |
| 3 Aug 2026 | **Integration suite green — 18/18 against the live project.** RLS scoping, `changed_by`, and all three child triggers proven. Three Known gaps closed. A job-delete defect was found and fixed (`20260803000200`), and the database verified empty afterwards |
| 3 Aug 2026 | Phase 4b batch 1 — setup screens (customers, properties, suppliers, rate card, service templates) and the shared `src/ui` primitives. `service_templates` gained its row type, mapper and repository. **382 unit, 22 integration** |
| 3 Aug 2026 | Phase 4b batch 2 — ingredients and recipes. `save_recipe` RPC migration **written, not run**. `scaleRecipe` gained a `no_components` gap. **396 unit** |
| 5 Aug 2026 | Phase 4b batch 3 — **the jobs screen and the live impact preview**, the §4 feature the whole cascade was built for. `save_job` RPC migration written; the three `replaceX` repository methods removed in its favour. **434 unit** |
| 5 Aug 2026 | **All three pending migrations applied. Integration 27/27, green on two consecutive runs.** Two defects found by running tests that had only ever been written: PostgREST returns `numeric` as a number, not a string, and the suite's cleanup deleted ingredients before recipes across an `on delete restrict` edge, swallowing the error and orphaning a row |
| 8 Aug 2026 | Phase 4c — **the shopping screen, the first DERIVED one (Rule 6)**. The list is recomputed from jobs on every view; only `purchase_state` ticks persist. `Db` port gained `upsert`; `purchase_state` gained its row type, mapper and repository. `tests/ui/derived.test.ts` guards the rule and was verified by planting a cached figure. **497 unit, 30 integration** |
| 8 Aug 2026 | Two engine files contained a literal NUL as a composite-key separator, which made `file` report them as binary and **grep skip them silently** — `prepDateFor` was unfindable. Replaced with `\u0000`; behaviour identical, 255 engine tests unmoved |
| 9 Aug 2026 | Phase 4d — **the prep screen**, the second derived one. Grouped by prep date with `prioritisePrep` ordering, batch counts with surplus, and the per-job allocation. `prep_state` gained its row type, mapper and repository. Gap routing extracted to `src/ui/gapRouting.ts` and shared with Shopping. `tests/ui/derived.test.ts` generalised over both features and re-verified by inversion in prep. **547 unit, 33 integration** |
| 9 Aug 2026 | Phase 4e — **the packing screen**, the last derived one and the only one that does NOT consolidate: each job is packed and delivered separately. Tick keyed as `food:<recipeId>` / `equipment:<templateId>` because `packing_state.item` is free text. `tests/ui/derived.test.ts` now covers all three features. **597 unit, 36 integration** |
| 9 Aug 2026 | Phase 4f — **the money screen**. `rangeMoney` added to `costing.ts` (the only new engine code; a range figure is arithmetic and view-models are forbidden it). `gapRouting` gained `routeMissing` over the separate 15-member `MissingReason` union. **NO margin percentage** — basis is an open owner question, and a test forbids one being added quietly. **650 unit, 36 integration** |
| 9 Aug 2026 | Phase 5 — **backup, restore and clear-all**. Raw-row export with a coverage guard that reads `schema.sql`; `clear_kitchen` and `import_kitchen` RPCs **written, not run**. `job_changes` exported but never imported. **715 unit; 3 integration tests blocked on the migration** |
| 9 Aug 2026 | **Backup migration applied. Integration 39/39, green twice.** A leftover supplier from the new tests broke the first run: `cleanUp` never covered `suppliers`, the same gap that orphaned an ingredient in August. Cleanup now covers suppliers and properties and verifies both |
| 9 Aug 2026 | Date fields on Jobs, Shopping, Prep, Packing and Money switched to `<input type="date">`. Affordance only — the stored format, parsing and validation are untouched. Measured in-browser: 16px / 44px hold, and every malformed value (including 2026-02-31) comes back as empty string, so the control NARROWS what reaches the engine |
| 9 Aug 2026 | **Stock entry** — `stockRepository` gained `setOnHand`/`clearOnHand`, and the ingredient form writes them. Closes the cascade gap: `required − stock − purchased` finally has its middle term. Proven live end-to-end — 4 kg required drops to 1 kg outstanding with 3 kg on hand, and off the list entirely when fully stocked. Tab renamed Stock → Ingredients. **735 unit, 41 integration** |
| 9 Aug 2026 | Phase 6a — **Ask Sous**. The model returns an INTENT and never sees a computed number; the engine runs in the browser afterwards and the existing formatters render it. Rules 2, 3 and 7 each enforced structurally and verified by inversion. `ask-sous` edge function **written, NOT deployed**. **787 unit** |
| | *Next: deploy ask-sous, then the tab regrouping and the scanners* |

---

## Environment

| | |
|---|---|
| GitHub org | `Info-ArcAgentSystems` |
| Repo | `copper-pot-kitchen`, private, branch `main` |
| Supabase project | Copper Pot Kitchen (free tier) |
| **Project ref** | `vhzpwdzrlrcfhxrjawym` — the subdomain of `VITE_SUPABASE_URL`. **Always pass it explicitly, see below** |
| Kitchen id | `15d29fdb-7d54-49b6-9665-2459e6a2a707` |
| Owner account | `info@arcagentsystems.com` — to be handed to the owner's own account later, with this one stepping down to `support` |
| Local path | `~/code/arcagent/copper-pot-kitchen` on both machines |

### EVERY supabase CLI COMMAND NEEDS `--project-ref vhzpwdzrlrcfhxrjawym`

**This machine has PCD PROD (`okkyabcaordghcqgoifk`) linked as well**, and the CLI deploys to
whatever is linked. The first `ask-sous` deploy went to PCD for exactly that reason — the
command was correct, the default was not.

`project_id` in `supabase/config.toml` does **not** prevent this. It names the LOCAL
development stack, not the remote target; the target comes from the machine-local link state in
`supabase/.temp/` or from an explicit flag. So the flag is the only reliable guard, and the npm
scripts bake it in:

| Instead of | Run |
|---|---|
| `supabase functions deploy ask-sous` | `npm run supabase:deploy:sous` |
| `supabase secrets set KEY=…` | `npm run supabase:secrets -- KEY=…` |
| `supabase db push` | `npm run supabase:push` |
| `supabase link` | `npm run supabase:link` |

Running the CLI directly is fine as long as `--project-ref vhzpwdzrlrcfhxrjawym` is on it. **This
is the deploy target for the scanners too** — `parse-image` in Phase 6b lands on the same
project and has the same failure mode.

`supabase/.temp/` is gitignored: it holds a pooler connection string, and the linked ref is
per-machine. The ref that matters is recorded in `config.toml` and in the scripts above.

### The AI provider is OpenAI

ArcAgent standardises on it. The key is `OPENAI_API_KEY`, a **function secret** on
`vhzpwdzrlrcfhxrjawym`, set with `npm run supabase:secrets -- OPENAI_API_KEY=sk-...` — **no
quotes around the value**, since a shell that passes them through makes them part of the secret
and the result authenticates as a 401 that looks exactly like a revoked key.

**`parse-image` (the scanners, 6b) uses the same secret on the same project** — same
`Authorization: Bearer`, same endpoint host, with the vision content shape instead of tools. One
secret, both functions.

The swap touched **only** `supabase/functions/ask-sous/`. Nothing in `src/` names a provider,
because the model returns an intent and never touches data: the client parses `{tool, args}` or
`{reason}` and does not care who produced it. That the change was containable is the
architecture working, not a happy accident.

Secrets live in `.env.local` (never committed) and, from Phase 6, in Supabase function
secrets. Both are recreated per machine from the Supabase dashboard.

**Check the project ref before trusting anything you verify.** On 3 Aug the env vars were
briefly pointed at a different project, and the mistake is invisible until something fails. Two
checks, neither of which needs the dashboard:

- the ref in `VITE_SUPABASE_URL` must be `vhzpwdzrlrcfhxrjawym`;
- a legacy anon key is a JWT whose payload carries its own `ref` claim, so decoding it proves
  the key and the URL belong to the same project. A URL and key from different projects fail
  with a 401 that looks like a permissions problem.

Note also that the **dashboard SQL editor is scoped by the open browser tab, not by
`.env.local`** — so a schema confirmation made there says nothing about which project the app
is pointed at. They are independent, and both need checking.

**Two machines.** Work moves between a Windows laptop and a Mac through GitHub. Claude Code
session history does not travel between them; this file is the handoff. Update and commit it
before stopping on either machine.

---

## Update rules

Update this file when any of the following happens. Not at the end of a phase — at the time.

- A module is created, renamed or deleted
- A schema change is applied
- A design decision is made that a future session would otherwise re-litigate
- A phase completes
- A known gap opens or closes

Before `/compact` in a long session, write current state here first. The conversation is
disposable; this file is not.

---

## Data flow

One direction, no exceptions:

```
Supabase row
   ↓  src/data/repositories   (fetch)
   ↓  src/data/mappers        (row → domain type)
   ↓  src/engine/*            (pure calculation, no I/O)
   ↓  src/features/*          (render)
```

The engine never imports from `data`, `features`, `sous`, or React. It takes domain objects
in and returns domain objects out. That constraint is what lets `tests/golden` run under
plain Node with no browser and no database — which is the whole reason this repo exists.

Writes go the other way and always pass through a repository, never direct from a component.
Any write to `jobs`, `job_dishes` or `job_dietaries` also writes a `job_changes` row.

---

## Modules

Mark each as `not started` / `in progress` / `done`, and keep the description accurate.

### `src/engine` — pure calculation · **COMPLETE** (1 Aug 2026)

| File | Responsibility | Status |
|---|---|---|
| `units.ts` | conversion across recipe / stock / purchase units | **done** — 31 Jul 2026 |
| `scaling.ts` | `scaleRecipe`, `portionsToUnits` | **done** — 31 Jul 2026 |
| `production.ts` | `prepDateFor`, `productionBuckets`, `prepPlanByDay`, `prioritisePrep` | **done** — 1 Aug 2026 |
| `shopping.ts` | `requirementsForRange`, `toPurchaseUnits`, `outstandingShopping` | **done** — 1 Aug 2026 |
| `costing.ts` | `recipeFoodCost`, `recipePortionCost`, `jobFoodCost`, `jobRevenue`, `jobMargin`, `rangeMoney` | **done** — `rangeMoney` added 9 Aug 2026 |
| `rules.ts` | `applyBuffetSplit`, `meatEatingGuests` | **done** — 1 Aug 2026 |
| `checks.ts` | `allergenScan`, `dietaryCrossCheck`, `readinessCheck`, `anomalyScan` | **done** — 1 Aug 2026 |
| `impact.ts` | `changeImpact` | **done** — 1 Aug 2026 |
| `history.ts` | `historicalAggregate` | **done** — 1 Aug 2026 |
| `types.ts` | shared domain types | **done** — 31 Jul 2026 |

`types.ts` has no imports and no logic; it erases at runtime apart from one `brand` symbol.
Three rules are enforced structurally there rather than left to be remembered downstream, and
each was verified by compiling deliberate violations and confirming they are rejected:

- **Rule 4** — `RecipeUnit` / `StockUnit` / `PurchaseUnit` are separate branded types, so a
  `StockQuantity` cannot be passed where a `RecipeQuantity` is expected. `units.ts` becomes
  the only place the three systems can meet, because nothing else can name both sides.
- **Rule 13** — a recipe line carries a single `qty: number | null`. There is no range type.
- **Rule 16** — `JobDietary` is `AllocatedDietary | UnresolvedDietary` and **neither variant
  has a count field**. `dietaries.reduce((n, d) => n + d.guests, 0)` fails to compile with
  "Property 'guests' does not exist". Counting means counting distinct `GuestRef`s.

Money is `Cents`, a branded integer — food cost sums many lines and euro floats drift. IDs are
branded, so a `RecipeId` cannot be passed as a `JobId`.

`units.ts` returns a `Conversion<T>` union — `converted` or `unresolved` with a reason — rather
than a nullable number, so a caller cannot treat a failed conversion as zero. Its dimensional
tables (`g/kg`, `ml/L/cl`) are physics, not business data: no ingredient, price, pack size or
recipe appears in the file, so Rule 1 is not engaged. Anything not dimensionally derivable
requires the ingredient's own owner-entered factor and is **refused** without it — it never
assumes a factor of 1.

`meatEatingGuests()` in `rules.ts` is **the only place in the engine that derives a headcount
from dietaries**, and the only place permitted to subtract from a guest count. It counts
distinct `GuestRef`s, never a sum of categories, and returns null when the guest count is
unknown or any dietary is unresolved. Keeping it in one function is what makes Paul's eventual
answer a one-line change. No caller re-derives it.

**`scaleRecipe` rounds batches up internally, so it must be called ONCE PER CONSOLIDATED
PORTION TOTAL, never once per job.** Two jobs of 10 lasagne portions is 3 trays consolidated
(20 / 9) but 4 if each is rounded separately (10 / 9, twice). Scaling per job and summing
over-orders by a whole tray. Consolidate portions first, then scale once — that ordering is
what Rule 5 means by one recalculation path. The alternative, keeping `scaleRecipe` linear and
rounding only in `production.ts`, was considered and rejected: it would make
`CALC-LASAGNE-29` uncallable against `scaleRecipe` alone, since the fixture expects 8 kg of
mince for 29 portions rather than the linear 6.44. `scaling.test.ts` demonstrates the
divergence, so the reason stays executable rather than folklore.

**`productionBuckets` is what enforces that contract**, and the arithmetic proving it is worth
recording. The `CLAUDE.md` §3 example — three jobs of 12 / 18 / 9 lasagne consolidating to 39
portions and 5 trays — gives **5 either way**, because `2 + 2 + 1` is also 5. As a test it pins
the allocation breakdown but does **not** catch per-job rounding. This was verified empirically:
with the implementation temporarily switched to per-job rounding, the 12/18/9 test **passed**
while `1 / 1 / 1 → 1 tray` and `4 / 4 / 4 → 2 trays` failed. Keep both guards. A test that
agrees with the bug is the same defect shape the golden pack caught in the BBQ split.

**The consolidation discipline holds one more link in `shopping.ts`.** `requirementsForRange`
runs `productionBuckets` → `scaleRecipe` (once per bucket) → `recipeToStock` → consolidate
across the whole range → `toPurchaseUnits` (once per ingredient). Packs are rounded on the
consolidated total, never per item: 0.4 kg of flour on three prep days is 1.2 kg and **2**
packs, where per-item rounding buys 3. Verified the same way as C4, by temporarily inverting
the implementation and watching the guard go red.

**`toPurchaseUnits` delegates to `stockToPacks` and does no arithmetic.** The two have
identical worked numbers, and Rule 5 forbids a second version of a step. It exists to give
shopping the name `CLAUDE.md` §3 uses and to carry shopping's gap semantics.

**`outstandingShopping` computes packs from the OUTSTANDING amount, not the required one.**
4.2 kg required with 4 kg on hand is 0.2 kg outstanding and one pack, not five. Reusing the
required-side pack count is the obvious mistake and re-buys the store cupboard; a test pins it.
Surplus is reported on its own field so `outstanding` is never negative — a negative would
silently offset another line if anything ever summed them.

**Stock that cannot be restated in the requirement's unit is counted, not dropped.** Each
`OutstandingLine` carries an `unreconciled` count. Non-zero means the outstanding figure is an
over-estimate because some stock row could not be converted. Silently treating unconvertible
stock as absent would be a Rule 8 failure wearing a Rule 4 costume.

**The golden pack reads the fixture, never restates it.** `tests/golden/adapter.ts` turns
`business_rules.recipes` and `historical_jobs` into engine domain objects; the assertions read
expected values out of `expected_results.json` rather than hardcoding them, so a fixture change
shows up as a failure instead of passing silently against a stale copy.

Two guards make that safe. `qty()` throws when the engine produces no such component and `num()`
throws when a fixture key is not a number — without them a typo yields `undefined` on both sides
and the test passes vacuously, which is the worst possible outcome for a regression pack. The
pack's teeth were verified by inversion: merging BBQ back into one recipe fails the split test,
and making Lasagne per-person fails the tray test and the downstream-recalc behaviour test.

**BBQ is two recipes in the adapter too** — `BBQ Meat` (course `main`) and `BBQ Sides` (course
`side`). Merging them is precisely the defect the pack was built to catch.

**`Continental Breakfast.orange_juice_ml_range` is mapped as unquantified, not as a number.**
`types.ts` has no range type (Rule 13) and picking either end would be inventing owner data. It
surfaces as an unquantified component, and the assertion that depends on it is skipped.

**`historicalAggregate` never averages an unknown as zero.** Revenue divides by `priced`, not
by every job; covers divide by `withGuestCount`, not by every job. The excluded count sits beside
each figure so it can never be mistaken for complete. On the real weekend set this is the
difference between the honest **€249.71** over 7 priceable jobs and the silent-zero **€218.50**
over 8 — verified by inverting the divisor and watching the test report exactly those two
numbers.

**Cancelled jobs are counted, excluded, and reported separately.** Rule 15 keeps them in history;
they contribute nothing to covers served or revenue earned, and their value lands in
`cancelledRevenue` so "what did we lose to cancellations" is answerable without contaminating
the earned total. Only closed statuses aggregate at all — an enquiry has not happened, and
counting it would inflate both figures with work that may never exist.

**`applyBuffetSplit` is the single place guests become portions**, called by both
`productionBuckets` and `jobFoodCost` so prep, shopping, costing and impact cannot disagree
(Rule 5). It only ever fills `portions: null` — the owner's explicit numbers always win — and
only when the guest count is known; deriving from an unknown would be the invention Rule 8
forbids, so a null-portion dish on a job with no guest count is still a gap.

Mains and desserts split evenly; sides take the full guest count however many there are, which
is the BBQ rule. **Breakfast is deliberately excluded**, on evidence rather than by omission:
`CALC-SWEETPEA-BREAKFAST` is 12 guests across Full Irish / pancakes / continental at 5 / 3 / 4,
a choice the owner recorded rather than a division. An even split would say 4/4/4 and break a
golden expectation.

The split is not cosmetic — it feeds batch consolidation. 17 guests across curry + lasagne gives
the lasagne 8 portions and **one** tray; the wrong full-17 gives **two**. Remainders go to the
earliest dishes by `position`, which is deterministic and consequential: with 19 guests a batch
dish listed first takes 10 and needs two trays, listed second it takes 9 and needs one. Both are
tested.

**`changeImpact` holds no arithmetic of its own, and a test enforces it.** `impact.test.ts`
reads `src/engine/impact.ts` as source, strips comments, and fails if it contains `Math.ceil`,
`Math.floor`, `Math.round`, `portionsToUnits`, `packSizeIn`, `recipeToStock` or `stockToPacks`.
The file builds an after-state, runs the existing cascade twice and subtracts — subtraction is
the only arithmetic in it. A private copy of any rounding or conversion rule would drift from
the engine and then lie on the screen the owner uses to accept a change.

The proof case is a batch boundary: 18 → 19 portions of a 9-per-tray lasagne moves mince from
4 kg to 6 kg, **+2 kg**, where a linear extrapolation says **+0.222 kg** — nine times off, in
the direction that under-orders. Beyond checking the number, one test asserts the after figure
equals an independent `requirementsForRange` run on the after-state, which is what proves it
came from the real engine. Both were verified by injecting a linear extrapolation and watching
eight tests go red.

**`npm run test` never touches the database.** `vite.config.ts` excludes `tests/integration`
from the default run, and the live suite has its own config invoked by
`npm run test:integration`. Without that separation the unit suite silently changed shape
depending on whether `.env.local` held credentials — and on the owner's machine, running the
unit tests would have written to and deleted from his live data. A CLI `--exclude` appends to
the config list rather than replacing it, so there is no way to opt back in by accident.

**Rule 9 is enforced by a language test, not by discipline.** `checks.test.ts` serialises the
whole `allergenScan` result and asserts it contains none of `safe`, `no allergen`,
`allergen-free`, `free from`, `none found`, `no conflict`, `verified`, `guaranteed`, `cleared`.
Verified by inversion: changing the shared message to "no conflict found — safe to serve" turns
it red. `AllergenScanResult` also carries **no boolean verdict of any kind** — no `safe`, no
`hasConflicts` — because a `false` invites exactly the reading Rule 9 forbids.

**`allergenScan` reports what it could NOT check.** The golden fixture has no allergen tags on
any ingredient, so a keyword scan finds nothing on `HIST-2026-07-20-NUCELLA-BUFFET`, which
carries a severe mushroom allergy. Empty findings is the *normal* case on real data. `unchecked`
names every dish with a missing recipe or no allergen tags, so absence of findings is visibly
not a clean bill of health. The severe-without-assigned-dish rule is the only thing that catches
that job at all — which is why CLAUDE.md says "regardless of keyword hits".

**Allergen matching uses no built-in vocabulary.** Token overlap between two owner-entered
strings: the dietary's `dietType`/`details` and the ingredient's `allergens` tags. A hardcoded
allergen list would be business data in `src/` (Rule 1) and would miss owner phrasings like
`no_pork_no_alcohol`, which token overlap catches against an ingredient tagged `pork`.

**The BBQ guard is expressed through `Recipe.course`, not through `serviceType`.** `serviceType`
is owner-defined free text; putting `"BBQ"` in `src/` would breach Rule 1 and break silently if
he renamed it. So the guard is structural: a menu with mains and no side is flagged, and a side
whose portions fall below the guest count is flagged. A main below the guest count is *not*
flagged the same way — meat legitimately scales to meat eaters, so its floor is
`meatEatingGuests` when set. The 27-guest / 22-meat-eater case is a test, and inverting the
sides comparison to use meat eaters turns it red.

**Money composes in fractional cents and rounds exactly once, at the boundary.** `costing.ts`
keeps unrounded internals (`recipeCostFractional`, `portionCostFractional`) precisely so a
rounded per-portion figure is never multiplied back up. A tray costing 200c across 9 portions
is 22.22c each; ten of those is 222c, but ten times a rounded 22c is 220c. The first draft had
this bug and a test caught it — the expectation was right and the implementation was wrong.
`recipePortionCost` is the rounded display figure; `jobFoodCost` does not use it.

**`jobFoodCost` is proportional per portion, not whole batches.** Batch rounding is consolidated
across jobs, so two jobs can share a tray; charging each a whole tray double-counts and per-job
costs would not sum to what was spent. The deliberate consequence: **surplus from batch rounding
is attributed to no job**, so job costs sum to slightly less than the shopping spend. That is
correct for margin, and the surplus belongs on a range view rather than smuggled into a job.
`recipeFoodCost(recipe, portions)` is the other question — what it costs to *make* that many —
and does round to whole batches.

**A manual override replaces the whole revenue figure, extras included** (Rule 11). The typed
figure IS the revenue, so an unpriced extra cannot block it. The rate-card figure stays on
`RevenueResult.computed` so a screen can show "computed €300, overridden to €320" without a
second calculation. A rate carrying both a per-head rate and a flat fee adds them.

**`prioritisePrep`'s ordering is a documented default, not an owner decision.** Prep date →
slack (service date − prep date, tightest first) → portions descending → recipe name. Only the
slack step makes an operational claim: something made on the day it is served cannot be moved.
Paul has not said how he sequences a prep day, so this is a guess with a rationale, and should
be put to him.

**Calendar arithmetic uses UTC accessors and ignores `Kitchen.timezone`.** These are plain
calendar dates, not instants; mixing a timezone into date-only arithmetic is how off-by-one-day
bugs start. A test pins the Europe/Dublin DST boundary (2026-03-29) to keep it that way.

A sub-recipe line's `qty` is **portions of the sub-recipe**, not a measured amount. A measured
amount would need each recipe's total yield in a measurable unit, which the schema does not
carry — `portions_per_batch` and `batch_unit` are all there is.

`scaleRecipe` consolidates by `(ingredientId, unit)` only. It receives no `Ingredient` records
and therefore cannot convert, so the same ingredient in `ml` and `L` stays on two lines for
`units.ts` to reconcile later (Rule 4).

### `src/data` — persistence · **in progress** (1 Aug → 3 Aug 2026)

| File | Responsibility | Status |
|---|---|---|
| `db.ts` | the narrow port repositories depend on | **done** |
| `client.ts` | Supabase client + `Db` adapter. **The only file that may import `@supabase/supabase-js`** | **done** |
| `rows.ts` | hand-written row types for 14 tables | **done** |
| `mappers.ts` | row ↔ domain, pure | **done** |
| `repositories.ts` | 9 repositories over 14 tables | **done** |

Remaining: `purchase_state`, `prep_state`, `packing_state`, `service_templates`, `invoices`,
`invoice_lines`, `ingredient_price_history`, `kitchens`, `kitchen_members` — tick-state and
admin tables with no engine consumer yet.

**The audit trail is a database trigger, not repository code** — applied and verified 3 Aug. Repository code cannot be
unbypassable: anything holding a client writes around it, and so does the SQL editor. The
trigger in `20260803000100_job_change_audit.sql` fires inside the same transaction as the
write, so there is no window in which a change lands unlogged. `jobRepository.update` therefore
writes **no** `job_changes` row of its own — doing so would double-log, and doing it *instead*
would be bypassable. A test asserts it does not.

`jobs` is audited field by field, comparing columns explicitly rather than diffing `to_jsonb`,
so `updated_at` never generates noise — Rule 14's "meaningful" excludes bookkeeping. A manual
price change logs as `price_override`, not `price` (Rule 11). Menu, dietary and extra rows are
audited whole, since those tables carry no bookkeeping columns.

**No repository filters by `kitchen_id`.** RLS scopes through `my_kitchen_id()`; a hand-written
filter would be a second copy of the policy, free to drift, and would mask a broken one rather
than expose it.

**Money crosses at the mapper and nowhere else.** `numeric(10,2)` euros become `Cents`, a
branded integer, rounded once. `1.005` is outside the contract — the column holds two decimal
places, so it can never arrive.

### `src/auth` — sign in and kitchen resolution · **done** (3 Aug 2026)

| File | Responsibility |
|---|---|
| `session.ts` | signIn / signOut / currentUser / onAuthChange |
| `kitchenState.ts` | the three-state union and `useKitchen` |
| `KitchenContext.tsx` | provider — resolves membership on every auth change |
| `SignIn.tsx` · `RequireKitchen.tsx` | the form and the route guard |

**Three states, kept distinct**: `signed_out`, `no_kitchen`, `ready`. The middle one is Rule 17
working — the account exists, the `kitchen_members` row does not — and it gets its own screen
saying so. Collapsing it into an empty app is how "why can't I see anything" becomes an hour of
debugging.

**Membership is re-read on every auth change, never cached.** "Revocable, taking effect
immediately through RLS" is the whole of Rule 17; a cached membership would keep a revoked
developer inside the app until reload. A failed read reports `no_kitchen` but does **not** claim
access was revoked — a dropped connection is not proof of anything.

`src/auth/session.ts` is the second and last file permitted to import the Supabase client, named
explicitly in `tests/data/purity.test.ts` rather than the rule being widened. A further test
asserts it never touches `.from()` or `.rpc()`, so the exception cannot grow into table access
that would step around the repositories and the audit trail.

### `src/ui` and `src/styles` — shell · **done** (3 Aug 2026)

Bottom tab bar, not a top nav: used one-handed, and the top of a phone is where a thumb cannot
reach. `useAsync` is a ~40-line hook over the repositories — deliberately not a cache, since one
user on one device does not need staleness bugs.

`styles/tokens.css` holds the `CLAUDE.md` §5 kitchen constraints as definitions rather than
conventions, and `tests/ui/tokens.test.ts` checks the checkable parts: a 44px touch floor with
no rule allowed below it, tabular numerals, 16px inputs so iOS Safari does not zoom on focus, a
`:focus-visible` for every `:hover`, no webfont, `100dvh` rather than `100vh`, and safe-area
insets at both ends.

### `src/features` — screens · **in progress**

| Area | Status |
|---|---|
| `setup` — customers, properties, suppliers, rate card, service templates | **done** — 3 Aug 2026 |
| `recipes` · `ingredients` | **done** — 3 Aug 2026 |
| `jobs` — including the live impact preview | **done** — 5 Aug 2026 |
| `shopping` · `prep` · `packing` · `money` · `scan` | not started |

**Ingredients keeps the three unit systems visibly apart.** The form has three labelled
groups — "how recipes measure it", "how you count it", "how you buy it" — not one "unit" box.
Collapsing them is the Rule 4 conflation the engine exists to avoid, and a form that invited it
would undo the type-level separation at the point of entry. The conversion factor between the
first two appears only when the pair is not dimensionally derivable (`g → kg` needs nothing;
`each → kg` for eggs cannot be guessed), and its hint says that leaving it blank makes
`units.ts` refuse rather than assume.

**The assumed pack flag is shown until confirmed.** `pack_assumed` defaults true, so a new
ingredient renders a visible "assumed — not confirmed" state with a control to confirm it. An
assumed pack size trusted silently is a wrong shopping quantity.

**A recipe saves through one RPC, not three writes.** `save_recipe` runs all three tables in a
single transaction. Without it, delete-then-insert from the client could leave a recipe with no
components — and `scaleRecipe` on a component-less recipe returned empty lines and *no gaps*,
so it would have contributed silently nothing to a shopping list. `scaleRecipe` now also emits a
`no_components` gap as a second line of defence. The function is `security invoker` on purpose,
so RLS still applies, and it resolves `kitchen_id` from `my_kitchen_id()` rather than trusting
the payload.

**Unquantified components have no quantity control at all.** Not a blank input — the field does
not exist, so a zero cannot be typed into it (Rule 8).

**The impact preview computes nothing.** `ImpactPreview.tsx` calls `changeImpact` and formats
the result; `impactSummary.ts` formats and nothing else. Every figure on it comes from two full
engine runs diffed against each other, per Rule 5 — a preview that did its own arithmetic would
be exactly the second calculation path `changeImpact` exists to prevent, and it would drift on
the one screen the owner uses to decide.

It is synchronous. Jobs, recipes and ingredients load once when the form opens; every keystroke
re-runs a pure function with no network. That is what makes it live rather than laggy, and it
is only possible because the engine has no I/O.

Two behaviours in it were worth tests of their own:

- **A money delta from unknown is not an increase.** Revenue that was null and becomes €360
  reads "was unknown, now €360", never "+€360". `MoneyDelta` carries both sides for this, and
  its `delta` is null whenever either side is (Rule 8).
- **A guest change that moves no food says why.** Ingredients follow the guest count only when a
  dish has `portions: null`, so `applyBuffetSplit` derives them; with portions typed in, the
  owner's numbers win and guests move revenue alone. That is correct, but silence would read as
  a broken preview, so the preview states which case applies.

**A job saves through one RPC, not four writes.** `save_job` writes the header and replaces
dishes, dietaries and extras in a single transaction. The atomicity matters, but the audit
matters more: the child triggers fire per statement, so four round trips would record one edit
as several unrelated changes in `job_changes`. The three `replaceDishes` / `replaceDietaries` /
`replaceExtras` methods were removed rather than kept alongside it — two write paths is one too
many. `security invoker` again, so RLS applies and `auth.uid()` inside the triggers is still the
real user.

**The job form has no count input for dietaries anywhere.** Each requirement is either allocated
to one named guest, or unresolved carrying the owner's original wording verbatim. Two guests
with the same requirement are two rows; one guest with two requirements shares a guest ref. That
is what makes the Rule 16 sum have no operand at the form, on the wire and in the table — not
just in the TypeScript types.

**Status is not a lock (Rule 15).** `delivered`, `invoiced`, `paid` and `cancelled` all stay
fully editable, and the form says so rather than disabling the fields. An invoice arrives late
and a guest count is misremembered; the correction is logged by the trigger like any other.

**The shared primitives live in `src/ui` and were settled by batch 1**, which is why the
shallow screens came first: a mistake in them is cheap here and expensive once eight screens
depend on it.

- `form.ts` holds parsing, validation and formatting as PURE functions, so the behaviour that
  matters is tested in plain Node with no DOM and no new dependency. Components stay thin.
- `Field.tsx` wires `htmlFor` rather than wrapping the input, so tapping a label focuses the
  control — a real difference one-handed.
- `RecordScreen.tsx` is the list-empty-form shape all five use. There is no code path that
  renders seeded content: an empty list renders `EmptyState`, and a row appears only if the
  owner saved one (Rule 1).

**Blank is null, never 0.** `parseMoney('')` returns null and `formatMoney(null)` renders
"not set", never "€0.00". Zero euros is a real price meaning free; blank means the owner has
not said, and under Rule 11 a job under an unpriced rate has null revenue rather than a zero
total.

**Deletes name their consequence.** `customers`, `properties` and `suppliers` are
`on delete set null`, so anything referring to them survives and loses the reference — a job
that loses its customer loses its client group and stops being priceable. The confirmation
counts the references first and says "3 jobs refer to this customer" rather than "are you
sure?".

### `src/sous` — Ask Sous · **not started**

Tool definitions over the engine, chat UI, propose-and-confirm flow.

### `supabase/functions` — server side · **not started**

`ask-sous` (intent parsing) · `parse-image` (three scan modes). Anthropic key lives here as a
secret and nowhere else.

---

## Schema

Applied from `schema.sql`. Record every change made after that here, with date and reason —
this is the only migration history a future session can read.

| Date | Change | Why |
|---|---|---|
| 30 Jul 2026 | Initial schema applied — 22 tables, indexes, RLS policies | baseline |
| 31 Jul 2026 | Four migrations applied — see below. 22 tables → 23 | Rules 4, 11, 12, 16 |

### Applied 31 Jul 2026

Run against the live database through the dashboard SQL editor and verified: `job_dietaries`
no longer carries a summable `guests` column, and both `job_extras` and the ingredient
conversion columns exist. `schema.sql` matches, so a fresh install and the live project now
agree. **23 tables.**

| Migration | Change | Why |
|---|---|---|
| `20260731000100_job_extras.sql` | new `job_extras` table | Rule 11 — named line items. Per-each with a quantity, matching the fixtures |
| `20260731000200_ingredient_conversion.sql` | `ingredients` + `recipe_unit`, `recipe_units_per_stock_unit` | Rule 4 — the gap that blocked C2. `each → kg` is not derivable and nothing held the factor |
| `20260731000300_job_dietaries_per_guest.sql` | `job_dietaries` − `guests`, + `guest_ref`, + `excludes_meat`, + allocation check constraint | Rules 16 and 12 — removes the summable count; the constraint enforces the allocated/unresolved union at the DB level |
| `20260731000400_jobs_meat_eating_guests.sql` | `jobs` + `meat_eating_guests` | The BBQ resolution — owner-set rather than derived by subtraction |

### Applied 3 Aug 2026

Two migrations. `20260803000100_job_change_audit.sql` added the audit triggers;
`20260803000200_audit_allow_job_delete.sql` fixed a defect it introduced — see below.

**The defect, and why it matters.** The child triggers made it impossible to delete a job that
had any dish, dietary or extra: the cascade fired an `insert into job_changes` for a job already
deleted in the same statement, and `job_changes_job_id_fkey` rejected it. A job with no children
deleted fine, so it stayed hidden until the triggers ran end to end. `CLAUDE.md` §4 ships
"Jobs — create, edit, delete (with confirm)", so it would have surfaced the first time the owner
removed a mistaken booking. The fix guards the DELETE branch with an existence check on the
parent job; Rules 10 and 14 are untouched, since every change to a *living* job is still logged.

It was found because an integration-test cleanup step **verified its own work** instead of
assuming it. The original cleanup swallowed errors and left rows behind silently.

`20260803000100_job_change_audit.sql` was verified two ways:

- **Structural** — `app_change_source`, `log_jobs_change` and `log_job_child_change` all exist.
  The two trigger functions are `security definer`; `app_change_source` is not, correctly, since
  it is a `stable` function that only reads a setting. All four triggers — `jobs_audit`,
  `job_dishes_audit`, `job_dietaries_audit`, `job_extras_audit` — are present and `enabled` in
  `pg_trigger`, so the script applied in full.
- **Functional** — a transaction-wrapped smoke test inserted a job, changed `guests` 15→20 and
  `notes` null→'changed', then repeated the `guests` update as a no-op, and rolled back. It
  produced **exactly two rows**, one per changed field, and **nothing** for the no-op. That is
  the behaviour that matters: the trail records changes, not writes.

`changed_by` was null in that test because the SQL editor runs as the service role, where
`auth.uid()` has no session. Populating it from a real signed-in user is still unproven — see
Known gaps.

| Migration | Change | Why |
|---|---|---|
| `20260803000100_job_change_audit.sql` | `app_change_source()`, `log_jobs_change()`, `log_job_child_change()` and four triggers | Rules 10 and 14 — an audit trail that cannot be bypassed, not even from the SQL editor |

### Still proposed, not written

| Proposed change | Why |
|---|---|
| `recipe_ingredients` — drop `qty_min`, `qty_max` | Rule 13: no range type. Harmless meanwhile — `types.ts` does not map them |
| `jobs` — reconsider `price` / `price_source` | `JobPricing` needs only the override amount; the engine recomputes the rate-card figure |
| ~~`job_dishes.portions` — allow null~~ | **Applied 5 Aug** as `20260805000100`. Promoted from nice-to-have to blocker first: `not null default 0` turned "let the guest count decide" into "make none of this dish", disabling the impact cascade at the column level. A null now round-trips, proven live |

**Tables in place (23):** `kitchens`, `kitchen_members`, `properties`, `customers`,
`client_rates`, `suppliers`, `ingredients`, `ingredient_price_history`, `stock`, `recipes`,
`recipe_ingredients`, `recipe_unquantified`, `jobs`, `job_dishes`, `job_dietaries`,
`job_extras`, `job_changes`, `purchase_state`, `prep_state`, `packing_state`,
`service_templates`, `invoices`, `invoice_lines`.

**Access model.** One `kitchens` row. `kitchen_members` grants `owner` to the business owner
and `support` to each developer. Every RLS policy resolves through `my_kitchen_id()`, which
returns the caller's kitchen with `limit 1` — so there must never be more than one kitchen
row, or membership becomes ambiguous.

All tables are empty by design. Nothing is seeded. See Rule 1 in `CLAUDE.md`.

---

## Decisions

Why things are the way they are, so a future session does not undo them by accident.

**Engine is dependency-free TypeScript.** No React, no Supabase, no fetch. It must run under
plain Node so the golden regression pack executes on every commit. This is the single most
important structural constraint in the repo.

**Modular, not a single file.** The prototype and MISE were both single-file. That is why the
calculation layer had to be extracted by hand before the owner's fixtures could run against it.

**Shopping, prep and packing are derived, never stored.** Only tick-off state persists. This
is what makes the cascade automatic rather than something that has to be kept in sync.

**BBQ is two recipes, not one.** Meat items scale to meat-eating guests; sides scale to all
guests. Bundling them under-ordered buns for vegetarians — a real defect caught by
`CALC-NUCELLA-BBQ-SPLIT` on the first golden run. Do not merge them back.

**No hardcoded business data.** The app ships empty. Fixtures are test-only. See Rule 1.

**One repo per project.** Sprints are tracked with GitHub Projects, milestones and tags, not
with dated folders in the repo path.

**`typecheck` is `tsc -b`, not `tsc --noEmit`.** BUILD_GUIDE A3 specifies `tsc --noEmit`, but
the Vite template's root `tsconfig.json` is solution-style — `"files": []` plus project
references — so `tsc --noEmit` compiles zero files and exits 0 unconditionally. That is a
green check that checks nothing. `tsc -b` builds the referenced projects; `tsconfig.app.json`
already sets `"noEmit": true`, so nothing is written.

**Linter is oxlint, not ESLint.** create-vite 9 ships oxlint in the react-ts template. The
`lint` script was kept as generated rather than swapped for ESLint. Revisit only if a rule we
need turns out to be ESLint-only — the engine import boundary is the likely test of that.

**No `.env.local` in the repo, and none generated.** `.env.example` is the committed template
with empty values. Real credentials are created per machine from the Supabase dashboard and
never pass through a tool or a commit.

**Rules 11–17 landed in `CLAUDE.md` on 31 Jul 2026** — the owner's confirmed rules, added
after Rule 10 with nothing above them changed. Three of them constrain the engine types
directly and must be in place before `types.ts` is written:

- **Rule 11, pricing.** A rate is keyed on (client group, service type) and carries an
  optional per-head rate *and* an optional flat fee. Extras are named line items, not folded
  into the rate. A manual override is stored as an override, with the computed figure still
  visible beside it. No rate and no manual figure means revenue is null, not 0.
- **Rule 13, orange juice, recorded as a modelling decision rather than the literal reading.**
  Taken literally — "200 ml per person" — it is business data, which Rule 1 forbids in `src/`.
  What it actually settles is that a recipe ingredient quantity is **one number**: no range
  type, no min/max pair, no "about" qualifier. The 200 ml is a value the owner enters through
  the UI. The rule carries an explicit tripwire: a literal `200` appearing in engine or UI
  code means the rule was misread. Genuine range-valued items remain a later feature.
- **Rule 16, dietary counts are never summed.** One guest can be coeliac *and* vegetarian.
  The corollary matters as much as the rule: "remaining standard guests" must not be derived
  by subtracting the dietary sum from the guest count — same double-count, opposite
  direction. Types must not model dietary counts as a summable set.

Rules 12, 14 and 15 extend Rules 8 and 10 rather than standing alone, and are marked as such
in `CLAUDE.md` so the pairs cannot drift apart. Rule 17 governs `support` access: controlled
via `kitchen_members`, revocable by deleting the row, and no code path may assume it exists.

---

## Known gaps

Things that are genuinely absent, so nobody wastes an hour looking for them.

| Gap | Blocking? | Notes |
|---|---|---|
| ~~Audit trigger written but NOT RUN~~ | **closed 3 Aug** | Applied and verified: functions present, and a rolled-back smoke test produced exactly one row per changed field and nothing for a no-op update |
| ~~`changed_by` unproven through the app~~ | **closed 3 Aug** | Proven live: `changed_by` equals the signed-in user's id, for both job and child changes |
| ~~Child triggers created but never fired~~ | **closed 3 Aug** | All three execute: `job_dishes.added`, `job_dishes.removed` with the old value, `job_dietaries.added`, `job_extras.added` |
| ~~RLS scoping is unverified~~ | **closed 3 Aug** | Proven live: a select with no `kitchen_id` filter returns only this kitchen's rows, an insert carrying another kitchen is rejected by the with-check policy, and the caller resolves exactly one distinct kitchen. The decision not to hand-filter `kitchen_id` is now tested, not assumed |
| Bundle is 443 kB (128 kB gzip) | no | Almost all `@supabase/supabase-js`. Fine over wifi, noticeable on supermarket 4G. Worth measuring again before it grows |
| `source` is always `'ui'` | no | PostgREST runs each request in its own transaction, so a client-side `set_config` does not carry into the following statement. Writes attributable to `ask_sous` or `scan` need an RPC that sets the value and writes in one transaction. Rule 7's propose-and-confirm commit call is the natural place |
| ~~Three migrations written, not run~~ | **closed 5 Aug** | All three applied and proven live: `save_recipe` lands three tables in one call, `save_job` lands four and refuses a forged kitchen, and `job_dishes.portions` now accepts null so a dish can scale with the guest count. **27/27 integration, green twice in a row** |
| ~~A guest-count change does not move ingredients~~ | **closed 1 Aug** | `applyBuffetSplit` landed and is wired into `productionBuckets` and `jobFoodCost`. The impact preview now moves revenue, ingredients and food cost together. The `impact.test.ts` test that pinned the gap was rewritten to assert the corrected cascade |
| `anomalyScan` false-positives on sides | no | It flags any menu with mains and no side, because keying off the service type would put owner-defined text ("BBQ") in `src/` and breach Rule 1. A precise version needs an owner-configured "service types that require sides" table, which does not exist. It is a report, not a blocked action |
| `prioritisePrep` ordering is a guess | no | Prep date → slack → size → name. Only Paul knows how he actually sequences a prep day. Put it to him with the other open items |
| ~~Golden pack not wired~~ | closed 1 Aug | `npm run test:copperpot` runs it: 15 pass, 2 skipped pending owner, 2 todo |
| The "33 tests" figure is unexplained | no | Counted every way, nothing in the pack is 33: 6 deterministic, 4 system-behaviour, 39 leaf assertions, 30 fixture entities. The dataset calls itself v2 while `ENGINEER_README` calls it v3. Likely describes an earlier or larger pack. Recorded in `PENDING_OWNER.md` §5, not reconciled by inventing cases |
| ~~`tests/` not covered by typecheck~~ | closed | `tsconfig.test.json` added 31 Jul, referenced from the root config. No DOM lib, so a test needing a browser global fails to compile |
| ~~No engine import boundary enforced~~ | closed | Enforced by `tests/engine/purity.test.ts`, **not** by oxlint — oxlint 1.75 has no `no-restricted-imports`. A test is stronger here: it asserts the real rule ("imports nothing outside `src/engine`", including Node builtins) and was verified to fail on a planted `react` import |
| Playwright browsers not installed | Phase 5 | `@playwright/test` is installed; `npx playwright install` deliberately deferred |
| Owner's own account not created | Phase 8 | `info@arcagentsystems.com` holds `owner` in the meantime |

Awaiting owner decisions (see Part 5 of the setup guide):

- **Margin basis — % of price or % of cost?** Raised 9 Aug at the money screen. The absolute
  margin is shown; no percentage is displayed and a test forbids one being added until this is
  answered. Ask alongside the `prioritisePrep` ordering and the Tranquillity BBQ rate, so it is
  one conversation rather than three.

- **Tranquillity BBQ rate** — history says €20pp, rate card has no entry. **This now blocks a
  golden test.** `FIN-REVENUE-WEEKEND-17-19` expects €2068, which sums exactly from eight jobs,
  but `HIST-2026-07-18-TRANQUILLITY-BBQ` (16 guests, €320) has no applicable rate. Under Rule 11
  its revenue is null, so the weekend total is null too — not €1748, since Rule 11 forbids
  presenting a partial sum as a total. Recommended resolution: record that job with a **manual
  override** of €320, which is what "rate may reflect booking-specific pricing" describes and
  needs no rate-card change. Recorded in `tests/golden/PENDING_OWNER.md` §2. Not applied.

**Raised 31 Jul 2026 at C1. Paul unavailable, so items 1, 3 and 4 proceeded on documented
defaults; item 2 could not, because it needs his ground truth and nothing else will do:**

1. ~~**Ingredient conversion factors.**~~ **Closed 31 Jul by default, not by Paul.** Added
   `recipe_unit` + `recipe_units_per_stock_unit`; anything not dimensionally derivable is
   *refused* rather than guessed. Follows from Rule 4 and needed no owner input, but he should
   still see it.
2. **The orange juice fixture is superseded.** `fixtures.json` carries
   `orange_juice_ml_range: [150, 200]` marked `confidence: "confirmed"`, and
   `CALC-SWEETPEA-BREAKFAST` expects `[600, 800]` for 4 continental guests. Rule 13 makes the
   correct answer a flat `800`. Per `CLAUDE.md` §5 **no expected value has been edited** — the
   owner confirms the v2 fixture is superseded, or Rule 13 is wrong. One or the other.
   (`metadata.name` says v2 while `ENGINEER_README` calls it v3; worth resolving together.)
   **STILL OPEN — this one cannot be defaulted.** The marker lives in
   `tests/golden/PENDING_OWNER.md`, which C6 must honour by wiring that single assertion as a
   skip. No fixture file has been touched.
3. **The BBQ meat-eater conflict.** `CALC-NUCELLA-BBQ-SPLIT` expects `meat_eaters: 22` from
   27 guests, 4 salmon-vegetarians and 1 vegan — i.e. `27 − (4 + 1)`, summing dietary counts
   and subtracting from the guest count, which Rule 16 forbids.
   **Built 31 Jul on the proposed resolution, pending Paul's confirmation.** The count is now
   an explicit owner-set field, `jobs.meat_eating_guests`. The fixture already records it that
   way (`guest_split.meat_eaters: 22`, `confidence: "confirmed"`), so the test passes on the
   owner's own figure rather than on anything inferred.
   The fallback in `meatEatingGuests()` fires only when the field is unset: it counts
   **distinct** `GuestRef`s flagged `excludesMeat` — never a sum — and returns **null** when
   the guest count is unknown or any dietary is unresolved, rather than treating "a few
   vegetarians" as zero. If Paul wants it to work differently, one function changes.
4. ~~**Five schema migrations proposed, none applied.**~~ Four now **written**, none run — see
   the Schema section. The remaining three stay proposed.

Closed on 31 Jul 2026 by the owner-confirmed rules (see Decisions below):

- ~~Whether revenue derives from the rate card or is typed per job~~ → both, plus a recorded
  manual override. `CLAUDE.md` Rule 11.
- ~~Continental orange juice: lock a number or keep 150–200 ml as a range~~ → a single fixed
  value. No range type in the schema. Rule 13.
- ~~Whether an unresolved dietary count blocks the shopping list or only warns~~ → it blocks
  exact purchase quantities. Rule 12.

Recipes with no usable quantities, to stay flagged and never guessed: sticky toffee pudding,
the eight tapas dishes. Cheesecake needs confirming before it is treated as locked.

---

## Ask Sous — why the model cannot calculate

The model **returns an intent, never an answer**. It reads the question, picks one of seven
registered tools, and stops. The engine then runs *in the browser, after the model has
finished*, and the same formatters the screens use render the result.

So Rule 2 is not something tests hunt for here — there is no path by which a figure the model
produced can reach the screen. The strongest guard is the absence of a mechanism.

Three consequences worth keeping:

- **The context carries identifiers, never figures.** Job ids, dates, customer names, recipe
  names, and the owner's own guest count. No total, cost, batch count or outstanding quantity —
  sending one would invite the model to restate it, and a restated figure is calculation by the
  back door.
- **`commit` is not a tool.** It lives in `src/sous/commit.ts`, is absent from the registry and
  from the schema, is not imported by any executor, and accepts only a `Proposal` the propose
  path built. Four independent barriers, so no single edit removes the guarantee.
- **The proposal IS `changeImpact`.** Rule 7's before/after was not invented for Ask Sous; it is
  what that function has returned since it was written.

`tests/sous/guards.test.ts` is the file to read first, and every guard in it was verified by
planting the violation.

## Proposed: five tabs (not built — 9 Aug)

Group by **when a screen is used**, not by what it is:

| Tab | Holds |
|---|---|
| Jobs | the diary and job detail |
| Service | Shopping · Prep · Packing, as a segmented control |
| Money | revenue, cost, margin |
| Library | Recipes · Ingredients |
| Setup | customers, properties, suppliers, rates, templates, backup |

The reason it is more than tidying: **Shopping, Prep and Packing each carry their own from/to
range today**, so the owner sets the same window three times and nothing keeps them in step —
you can be looking at next week's shopping beside this week's prep without noticing. One shared
range under `Service` fixes that.

Sub-navigation is a **segmented control at the top of Service, not a hub page**: these are
daily-use screens and a menu tap would cost real time in a kitchen. Each stays one tap away,
exactly as now.

Phase 6 then needs no new tabs. **Scan is not a destination** — it produces jobs, recipes and
prices, so it belongs as an action on those screens. **Ask Sous is cross-cutting**, so it wants
a persistent affordance rather than somewhere to navigate to.

Cost: `/shopping`, `/prep` and `/packing` become children of `/service`, breaking bookmarks.
Redirects cover it in three lines.

## Test coverage

| Suite | Command | Covers | Status |
|---|---|---|---|
| Integration | `npm run test:integration` | RLS, audit triggers, job delete, `save_recipe`, `save_job`, three tick tables, on-hand stock, backup/restore/clear — live Supabase | **41 pass** (9 Aug). Needs `CPK_TEST_EMAIL`/`CPK_TEST_PASSWORD`. **`clear_kitchen` deletes the whole signed-in kitchen** — never point this at real owner data |
| Unit | `npm run test` | engine, data, ui, sous | **787 green**, 2 skipped, 2 todo — every engine module, plus `purity`, mappers, repositories, the pure form/impact/shopping formatting, and the Rule 6 derived guard |
| Golden | `npm run test:copperpot` | the owner's regression pack | **15 pass, 2 skipped, 2 todo** — read `tests/golden/PENDING_OWNER.md` before touching |
| E2E | `npm run test:e2e` | workflows, desktop and mobile | not started |

Every confirmed bug gets a permanent regression test. Record notable ones here with the
fixture id, so the reason a test exists survives the person who wrote it.

| Fixture id | Why the test exists |
|---|---|
| `CALC-NUCELLA-BBQ-SPLIT` | BBQ sides were scaling to meat eaters instead of all guests. 27 guests, 22 meat eaters, must produce 27 baps and 2700 g of potatoes. |
| `job_dishes.portions` nullable | `not null default 0` turned "let the guest count decide" into "make none of this dish", silently disabling the impact cascade at the column level. The live `save_job` test asserts a null round-trips. |
| backup round-trip was LOSSY | The Phase 5 round-trip test read five tables, cleared all nineteen, and restored five — so it destroyed properties, rates, templates, stock and the tick tables on every run while reporting success. It passed only for as long as nothing referenced the missing fourteen, then failed on `jobs_property_id_fkey` once a job had a property. Now driven from `EXPORTED_TABLES` through the app's own `buildBackup`/`importable`, so the test cannot drift from what the app backs up. |
| integration cleanup coverage | The backup tests created suppliers, which `cleanUp` did not delete. The leftover then broke the NEXT run on the unique (kitchen_id, name) constraint — identical in shape to the orphaned ingredient, and identical in cause: a test created data the cleanup did not know about. Cleanup now covers suppliers and properties and verifies suppliers are gone, alongside jobs and ingredients. |
| integration cleanup ordering | Ingredients were deleted before recipes across an `on delete restrict` edge and the error was swallowed, orphaning a row that broke the NEXT run on a unique constraint — a failure that looks nothing like its cause. Cleanup now runs parents-first at both ends of the suite and verifies ingredients as well as jobs. |
| ~~`20260809000100_backup` not applied~~ | **closed 9 Aug** | Applied and proven live: a full export → clear → restore round trip returns every row, a payload naming an unknown table is refused **before** anything is deleted, and a forged `kitchen_id` in the file is overwritten with the caller's. **39/39, green on two consecutive runs** |
| Stale-backup reminder is per device | no | The last-backup fingerprint lives in `localStorage`, so exporting on the phone leaves a laptop still reminding. Stated on screen. A `kitchens.last_backup_at` column would fix it but is a migration for a reminder |
| ~~On-hand stock cannot be entered anywhere~~ | **closed 9 Aug** | `setOnHand`/`clearOnHand` added and wired to the ingredient form. Proven live: with 4 kg required, 3 kg of stock leaves 1 kg outstanding and 4 kg drops the line off the list. The mislabelled "Stock" tab that hid it is now "Ingredients" |
| ~~`ask-sous` deploy target~~ | closed | Went to **PCD PROD** because that project was linked here. Guarded by `npm run supabase:deploy:sous`, which bakes in `--project-ref vhzpwdzrlrcfhxrjawym`. PCD has been cleaned |
| ~~ask-sous unreachable from the browser~~ | **closed 13 Aug** | The function answered the CORS preflight with 405 and no allow-origin, so `fetch` rejected and the client said "could not reach Sous" — a misleading diagnosis for a healthy function. **Invisible to curl and to every offline test, which is why it shipped.** Fixed in the OpenAI rewrite, and `tests/sous/guards.test.ts` now checks the OPTIONS branch exists AND comes before the method check — the wrong-order version looks fine at a glance |
| Eight bottom tabs is too many | no | At 375px that is ~47px each; Phase 6 would make it ten at 37px, below the 44px floor enforced everywhere else. Scrolling is a mitigation, not a fix. **A five-tab regrouping is proposed and not built** — see "Proposed: five tabs" below |
| Integration suite is latency-flaky | no | Observed 9 Aug: three consecutive runs gave 36 pass (46s), 1 fail (148s), 36 pass (49s). The failure was a 30s test timeout in a run that was ~3x slower overall; per-test timings are normally 0.4–2.3s. It is round-trip latency, not a defect, and it is NOT concurrency — the slow run had the database to itself. The timeout is deliberately NOT raised: 30s is already ample for 2–4 sequential requests, and raising it would mask a real hang. Re-run before believing a single red |
| Stock has THREE states, not two | blank = no row = "I have not counted this"; `qty 0` = "I counted, there is none"; `qty 2.5` = a figure. Clearing DELETES the row rather than writing zero. Both make the shopping list order the full amount, so the bug would be invisible there — which is exactly why it needs a test rather than a comment. |
| A backup is ROWS, not domain objects | The domain types are a deliberate narrowing of the schema — `ingredient_price_history` has no domain type at all, and every future column starts life unmapped. A backup built from domain objects would silently drop whatever nobody has modelled yet, invisibly, in the file, until a restore. `tests/ui/backup.test.ts` reads `schema.sql` and fails if any table is neither exported nor explicitly excluded with a reason; verified by dropping a table from the export AND by adding one to the schema. |
| `job_changes` is exported, never imported | It is the owner's history so it belongs in the file, but writing it back would forge audit rows with a meaningless `changed_by`. Rule 10: a trail that can be written from a file is not a trail. |
| Margin percentage is absent BY DESIGN | The basis (% of price vs % of cost) is unanswered, and the two differ substantially at catering margins. The screen shows the absolute figure and says the percentage is waiting on the owner. `tests/ui/moneyView.test.ts` fails on a percent sign, a division by revenue or cost, or a `*100` in the money feature — verified by planting one, which tripped three assertions. Without that guard a future session adds a percentage in thirty seconds and nobody notices which basis it chose. |
| A range total over a subset must say so | `rangeMoney` totals only the jobs it could value and reports the count it could not. The trap: summing revenue over one set of jobs and cost over a different set, then subtracting — the result belongs to no actual set of jobs. Margin therefore totals only jobs where BOTH figures are known. |
| Packing does NOT consolidate | Shopping and Prep roll up across jobs; packing must not, because each job goes into its own boxes and its own van run. Three jobs needing lasagne are three lists, not one line of 39 portions. The headline test asserts two jobs needing the same recipe stay two lines. |
| `packing_state` tick key | The column is free text and unique on (kitchen, job, item). A bare label would collapse a recipe named "Chafing dish" and an equipment item of the same name into ONE tick, and orphan every tick on a rename. Keyed `food:<recipeId>` / `equipment:<templateId>` instead, built in one place so read and write cannot diverge. |
| Empty service template ≠ nothing to pack | Rule 1 ships the app with no templates, so an empty equipment section is the NORMAL early state and reads as "no equipment needed". The screen states which it is, and points at Setup. |
| Prep filters DAYS, not jobs | Prep happens before service (`prepDateFor` = service date − make_ahead_days), so filtering jobs by service date would silently lose prep days falling inside the window for jobs served just outside it — the work he most needs warning about. The screen filters the engine's output days instead. |
| Rule 6 derived guard | A stored shopping list would keep every other test green while quietly killing the cascade — the list would stop following the jobs, and the first sign would be food bought for a guest count that changed a week earlier. `tests/ui/derived.test.ts` source-inspects the feature; verified by planting a cached figure and watching it go red. |
| engine purity word boundaries | The no-browser-globals guard matched `window` as a SUBSTRING and fired on `PurchaseState.windowFrom`, which is the schema's own word. Now matched on word boundaries, re-verified against `window.location`, `document.title`, `fetch(` and `localStorage`. |
| `recipe_ingredients.qty` type | An assertion written but never run guessed PostgREST returns `numeric` as the string `'2.0000'`. It returns a number. The test now asserts `typeof === 'number'`, because the engine multiplies this value and a string would concatenate. |
