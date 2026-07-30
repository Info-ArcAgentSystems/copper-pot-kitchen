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
| Current phase | Phase 0 — scaffold (in progress) |
| Last updated | 30 July 2026 |
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
| | *Phase 0 remaining: Vite scaffold, dependencies, package scripts, fixtures* |

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

### `src/engine` — pure calculation · **not started**

| File | Responsibility | Status |
|---|---|---|
| `units.ts` | conversion across recipe / stock / purchase units | not started |
| `scaling.ts` | `scaleRecipe`, `portionsToUnits` | not started |
| `production.ts` | `prepDateFor`, `productionBuckets`, `prepPlanByDay`, `prioritisePrep` | not started |
| `shopping.ts` | `requirementsForRange`, `toPurchaseUnits`, `outstandingShopping` | not started |
| `costing.ts` | `recipeFoodCost`, `jobFoodCost`, `jobMargin` | not started |
| `rules.ts` | `applyBuffetSplit`, BBQ meat/sides split | not started |
| `checks.ts` | `allergenScan`, `dietaryCrossCheck`, `readinessCheck`, `anomalyScan` | not started |
| `impact.ts` | `changeImpact` | not started |
| `history.ts` | `historicalAggregate` | not started |
| `types.ts` | shared domain types | not started |

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

---

## Known gaps

Things that are genuinely absent, so nobody wastes an hour looking for them.

| Gap | Blocking? | Notes |
|---|---|---|
| No application code yet | — | Phase 0 scaffold outstanding |
| Golden pack not wired | Phase 2 | fixtures still to be copied into `tests/fixtures/` |
| Owner's own account not created | Phase 8 | `info@arcagentsystems.com` holds `owner` in the meantime |

Awaiting owner decisions (see Part 5 of the setup guide):

- Tranquillity BBQ rate — history says €20pp, rate card has no entry
- Whether revenue derives from the rate card or is typed per job
- Continental orange juice: lock a number or keep 150–200 ml as a range
- Whether an unresolved dietary count blocks the shopping list or only warns

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
