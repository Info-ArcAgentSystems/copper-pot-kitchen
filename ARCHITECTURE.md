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
| Current phase | Phase 3 — `src/data` built; audit trigger **applied and verified** |
| Last updated | 1 August 2026 |
| Repo | `Info-ArcAgentSystems/copper-pot-kitchen` (private) |
| Database | Supabase, schema + 4 migrations applied, 23 tables |
| Unit tests | **336 pass**, 2 skipped, 16 todo (`npm run test`) |
| Golden pack | **wired** — 15 pass, 2 skipped pending owner, 2 todo |
| `npm run test:copperpot` | **passing** |

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
| | *Next: the remaining data tables, or Phase 4 UI. Integration tests need a signed-in session* |

---

## Environment

| | |
|---|---|
| GitHub org | `Info-ArcAgentSystems` |
| Repo | `copper-pot-kitchen`, private, branch `main` |
| Supabase project | Copper Pot Kitchen (free tier) |
| Kitchen id | `15d29fdb-7d54-49b6-9665-2459e6a2a707` |
| Owner account | `info@arcagentsystems.com` — to be handed to the owner's own account later, with this one stepping down to `support` |
| Local path | `~/code/arcagent/copper-pot-kitchen` on both machines |

Secrets live in `.env.local` (never committed) and, from Phase 6, in Supabase function
secrets. Both are recreated per machine from the Supabase dashboard.

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
| `costing.ts` | `recipeFoodCost`, `recipePortionCost`, `jobFoodCost`, `jobRevenue`, `jobMargin` | **done** — 1 Aug 2026 |
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

### `src/features` — screens · **not started**

`jobs` · `recipes` · `ingredients` · `shopping` · `prep` · `packing` · `money` · `setup` · `scan`

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

`20260803000100_job_change_audit.sql` ran in the dashboard SQL editor. Verified two ways:

- **Structural** — `app_change_source`, `log_jobs_change` and `log_job_child_change` all exist.
  The two trigger functions are `security definer`; `app_change_source` is not, correctly, since
  it is a `stable` function that only reads a setting.
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
| `job_dishes.portions` — allow null | Currently `not null default 0`. Rule 8 wants null for "not yet allocated" |

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
| `changed_by` unproven through the app | **yes** | The smoke test ran in the SQL editor, where `auth.uid()` is null. That a real signed-in user lands in `changed_by` is still untested — it needs `tests/integration/` |
| Child triggers not directly observed | no | `jobs_audit` is proven by the smoke test. `job_dishes_audit`, `job_dietaries_audit` and `job_extras_audit` were created by the same script but have not been fired; they need a job with a recipe to exercise |
| **RLS scoping is unverified** | **yes** | No repository filters by `kitchen_id` — deliberately, so the policy is the single definition. The cost is that nothing in CI proves it works. Only `tests/integration/` can |
| `source` is always `'ui'` | no | PostgREST runs each request in its own transaction, so a client-side `set_config` does not carry into the following statement. Writes attributable to `ask_sous` or `scan` need an RPC that sets the value and writes in one transaction. Rule 7's propose-and-confirm commit call is the natural place |
| No UI | Phase 4 | `src/` outside `engine` and `data` is still the Vite starter page |
| ~~A guest-count change does not move ingredients~~ | **closed 1 Aug** | `applyBuffetSplit` landed and is wired into `productionBuckets` and `jobFoodCost`. The impact preview now moves revenue, ingredients and food cost together. The `impact.test.ts` test that pinned the gap was rewritten to assert the corrected cascade |
| `anomalyScan` false-positives on sides | no | It flags any menu with mains and no side, because keying off the service type would put owner-defined text ("BBQ") in `src/` and breach Rule 1. A precise version needs an owner-configured "service types that require sides" table, which does not exist. It is a report, not a blocked action |
| `prioritisePrep` ordering is a guess | no | Prep date → slack → size → name. Only Paul knows how he actually sequences a prep day. Put it to him with the other open items |
| Golden pack not wired | Phase 2 | fixtures are in `tests/fixtures/`; `tests/golden/` runner not written |
| The "33 tests" figure is unexplained | no | Counted every way, nothing in the pack is 33: 6 deterministic, 4 system-behaviour, 39 leaf assertions, 30 fixture entities. The dataset calls itself v2 while `ENGINEER_README` calls it v3. Likely describes an earlier or larger pack. Recorded in `PENDING_OWNER.md` §5, not reconciled by inventing cases |
| ~~`tests/` not covered by typecheck~~ | closed | `tsconfig.test.json` added 31 Jul, referenced from the root config. No DOM lib, so a test needing a browser global fails to compile |
| ~~No engine import boundary enforced~~ | closed | Enforced by `tests/engine/purity.test.ts`, **not** by oxlint — oxlint 1.75 has no `no-restricted-imports`. A test is stronger here: it asserts the real rule ("imports nothing outside `src/engine`", including Node builtins) and was verified to fail on a planted `react` import |
| Playwright browsers not installed | Phase 5 | `@playwright/test` is installed; `npx playwright install` deliberately deferred |
| Owner's own account not created | Phase 8 | `info@arcagentsystems.com` holds `owner` in the meantime |

Awaiting owner decisions (see Part 5 of the setup guide):

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

## Test coverage

| Suite | Command | Covers | Status |
|---|---|---|---|
| Unit | `npm run test` | engine functions | **253 green** — every engine module, plus `purity` |
| Golden | `npm run test:copperpot` | the owner's regression pack | **15 pass, 2 skipped, 2 todo** — read `tests/golden/PENDING_OWNER.md` before touching |
| E2E | `npm run test:e2e` | workflows, desktop and mobile | not started |

Every confirmed bug gets a permanent regression test. Record notable ones here with the
fixture id, so the reason a test exists survives the person who wrote it.

| Fixture id | Why the test exists |
|---|---|
| `CALC-NUCELLA-BBQ-SPLIT` | BBQ sides were scaling to meat eaters instead of all guests. 27 guests, 22 meat eaters, must produce 27 baps and 2700 g of potatoes. |
