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
| Current phase | Phase 0 — scaffold complete; Phase 2 (engine) not started |
| Last updated | 31 July 2026 |
| Repo | `Info-ArcAgentSystems/copper-pot-kitchen` (private) |
| Database | Supabase, schema applied, 22 tables |
| Golden pack | not yet wired |
| `npm run test:copperpot` | not yet passing |

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
| | *Next: C2 (`units.ts`) — **held** pending the ingredient conversion-factor decision* |

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

### `src/engine` — pure calculation · **in progress**

| File | Responsibility | Status |
|---|---|---|
| `units.ts` | conversion across recipe / stock / purchase units | **blocked** — see conversion-factor gap |
| `scaling.ts` | `scaleRecipe`, `portionsToUnits` | not started |
| `production.ts` | `prepDateFor`, `productionBuckets`, `prepPlanByDay`, `prioritisePrep` | not started |
| `shopping.ts` | `requirementsForRange`, `toPurchaseUnits`, `outstandingShopping` | not started |
| `costing.ts` | `recipeFoodCost`, `jobFoodCost`, `jobMargin` | not started |
| `rules.ts` | `applyBuffetSplit`, BBQ meat/sides split | not started |
| `checks.ts` | `allergenScan`, `dietaryCrossCheck`, `readinessCheck`, `anomalyScan` | not started |
| `impact.ts` | `changeImpact` | not started |
| `history.ts` | `historicalAggregate` | not started |
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

### `src/data` — persistence · **not started**

Supabase client, one repository per table, mappers both ways.

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

### Proposed at C1, NOT applied

`CLAUDE.md` §5: propose schema changes, never apply them unilaterally. Every table is empty,
so all of these are cheap — but none has been run, and `schema.sql` is unchanged.

| Proposed change | Why |
|---|---|
| `job_dietaries` — drop `guests`, add `guest_ref text` | Per-guest identity. `guests` is the summable column Rule 16 forbids, and `types.ts` has nowhere to map it |
| new `job_extras` table | Rule 11 requires named line items. Needs label, amount-each and quantity — the fixtures' extras are per-each, not flat |
| `recipe_ingredients` — drop `qty_min`, `qty_max` | Rule 13: no range type. These columns exist only for the orange juice range that Rule 13 superseded |
| `jobs` — reconsider `price` / `price_source` | `JobPricing` needs only the override amount; the engine recomputes the rate-card figure, so `price_source` overlaps |
| `job_dishes.portions` — allow null | Currently `not null default 0`. Rule 8 wants null for "not yet allocated"; 0 reads as "none" |
| *(if the BBQ resolution is confirmed)* `jobs` — add a meat-eating-guest count | Makes the count owner-entered rather than derived by subtraction. See awaiting-owner item 3 |

**Tables in place:** `kitchens`, `kitchen_members`, `properties`, `customers`,
`client_rates`, `suppliers`, `ingredients`, `ingredient_price_history`, `stock`, `recipes`,
`recipe_ingredients`, `recipe_unquantified`, `jobs`, `job_dishes`, `job_dietaries`,
`job_changes`, `purchase_state`, `prep_state`, `packing_state`, `service_templates`,
`invoices`, `invoice_lines`.

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
| **No ingredient conversion factor** | **blocks C2** | `g → kg` is dimensional and derivable. `each → kg` for eggs is not, and no column holds it — `pack_size`/`pack_unit` only covers purchase → stock. `units.ts` cannot be written until this is settled: new column, or an explicit unresolved state. **C2 is held pending this decision.** |
| **No `job_extras` table** | Phase 3 | Rule 11 requires named line items and `fixtures.json` has real ones ("Bistro steak surcharge €10 each", "Birthday cake €30 each" — per-*each* with a quantity, not flat amounts). `JobExtra` exists in the engine with nothing to persist to |
| **`job_dietaries` shape vs Rule 16** | Phase 3 | The table has a `guests` count — the summable column Rule 16 forbids. `types.ts` models per-guest `AllocatedDietary` records with a `GuestRef` and has nowhere to put a count. Migration proposed below, **not applied** |
| No engine code beyond `types.ts` | Phase 2 | `src/` is otherwise still the Vite starter page |
| Golden pack not wired | Phase 2 | fixtures are in `tests/fixtures/`; `tests/golden/` runner not written |
| Fixture count vs BUILD_GUIDE | Phase 2 | `expected_results.json` holds 6 `deterministic_tests` + 4 `system_behavior_tests`. BUILD_GUIDE Stage C says "33 tests". Reconcile with Paul before C6 |
| `tests/` not covered by typecheck | Phase 2 | `tsconfig.app.json` includes `src` only. Add `tsconfig.test.json` at C2, with the first test |
| No engine import boundary enforced | Phase 2 | nothing yet stops `src/engine` importing React or Supabase. `types.ts` imports nothing, but that is convention, not enforcement. Add an oxlint rule at C2 |
| Playwright browsers not installed | Phase 5 | `@playwright/test` is installed; `npx playwright install` deliberately deferred |
| Owner's own account not created | Phase 8 | `info@arcagentsystems.com` holds `owner` in the meantime |

Awaiting owner decisions (see Part 5 of the setup guide):

- Tranquillity BBQ rate — history says €20pp, rate card has no entry

**Raised 31 Jul 2026 at C1, all four with the owner and none actioned:**

1. **Ingredient conversion factors.** Blocks C2. `each → kg` is not derivable and no column
   holds it. Needs either a new column or a defined unresolved state.
2. **The orange juice fixture is superseded.** `fixtures.json` carries
   `orange_juice_ml_range: [150, 200]` marked `confidence: "confirmed"`, and
   `CALC-SWEETPEA-BREAKFAST` expects `[600, 800]` for 4 continental guests. Rule 13 makes the
   correct answer a flat `800`. Per `CLAUDE.md` §5 **no expected value has been edited** — the
   owner confirms the v2 fixture is superseded, or Rule 13 is wrong. One or the other.
   (`metadata.name` says v2 while `ENGINEER_README` calls it v3; worth resolving together.)
3. **The BBQ meat-eater conflict.** `CALC-NUCELLA-BBQ-SPLIT` expects `meat_eaters: 22` from
   27 guests, 4 salmon-vegetarians and 1 vegan — i.e. `27 − (4 + 1)`, summing dietary counts
   and subtracting from the guest count, which Rule 16 forbids.
   **Proposed resolution, pending owner confirmation:** the meat-eater count becomes an
   **explicit job field the owner sets**, not a value the engine derives by subtraction. Rule
   16 then holds untouched and `CALC-NUCELLA-BBQ-SPLIT` still passes, because 22 is entered
   rather than inferred. This also matches Rule 16's own escape hatch — a true count "comes
   from per-guest allocation the owner has entered". **Not built.** It needs a `Job` field and
   a column, neither of which exists.
4. **Five schema migrations proposed, none applied** — see the Schema section.

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
| Unit | `npm run test` | engine functions | not started |
| Golden | `npm run test:copperpot` | the owner's regression pack | not started |
| E2E | `npm run test:e2e` | workflows, desktop and mobile | not started |

Every confirmed bug gets a permanent regression test. Record notable ones here with the
fixture id, so the reason a test exists survives the person who wrote it.

| Fixture id | Why the test exists |
|---|---|
| `CALC-NUCELLA-BBQ-SPLIT` | BBQ sides were scaling to meat eaters instead of all guests. 27 guests, 22 meat eaters, must produce 27 baps and 2700 g of potatoes. |
