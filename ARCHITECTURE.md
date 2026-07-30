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
| Current phase | Phase 0 — repo skeleton |
| Last updated | (date) |
| Golden pack | not yet wired |
| `npm run test:copperpot` | not yet passing |

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

Mark each as `not started` / `in progress` / `done`, and keep the one-line description
accurate.

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
| | initial schema applied | |

Access model: one `kitchens` row, `kitchen_members` grants owner to Paul and `support` to
each developer. All RLS policies resolve through `my_kitchen_id()`.

---

## Decisions

Why things are the way they are, so a future session does not undo them by accident.

**Engine is dependency-free TypeScript.** No React, no Supabase, no fetch. It must run under
plain Node so the golden regression pack executes on every commit. This is the single most
important structural constraint in the repo.

**Modular, not a single file.** The prototype and MISE were both single-file. That is why the
calculation layer had to be extracted by hand before Paul's fixtures could run against it.

**Shopping, prep and packing are derived, never stored.** Only tick-off state persists. This
is what makes the cascade automatic rather than something that has to be kept in sync.

**BBQ is two recipes, not one.** Meat items scale to meat-eating guests; sides scale to all
guests. Bundling them under-ordered buns for vegetarians — a real defect caught by
`CALC-NUCELLA-BBQ-SPLIT` on the first golden run. Do not merge them back.

**No hardcoded business data.** The app ships empty. Fixtures are test-only. See Rule 1.

---

## Known gaps

Things that are genuinely absent, so nobody wastes an hour looking for them.

| Gap | Blocking? | Notes |
|---|---|---|
| Everything — Phase 0 | — | build not started |

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
| Golden | `npm run test:copperpot` | Paul's regression pack | not started |
| E2E | `npm run test:e2e` | workflows, desktop and mobile | not started |

Every confirmed bug gets a permanent regression test. Record notable ones here with the
fixture id, so the reason a test exists survives the person who wrote it.
