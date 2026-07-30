# COPPER POT KITCHEN — repo contract

Claude Code reads this file at the start of every session. It is the standing brief.
Read `ARCHITECTURE.md` before any structural change.

---

## 0. WHAT THIS IS

An operations system for Copper Pot Kitchen, a private chef and catering business run by
one owner-operator. It replaces a working prototype that proved the model; this repo is the
durable version.

**One user.** No multi-tenancy, no team features, no roles beyond owner and support. If a
decision hinges on "what if another business used this" — it won't. Ignore it.

**A small support team** (2–3 developers) needs read/write access to the same data for
debugging. That is handled by `kitchen_members`, not by building an org model.

---

## 1. NON-NEGOTIABLE RULES

These override everything else in this file. If a later instruction conflicts, follow the
rule and say so.

### Rule 1 — No hardcoded business data. Ever.

The app ships **empty**. Every recipe, ingredient, job, customer, property, price and
template is entered by the owner through the UI, or imported by him from a backup file.

There are no seed recipes in `src/`. There is no "demo data" toggle. There is no fallback
list of ingredients. A fresh install shows empty states that invite the owner to add
something.

Fixtures for tests live in `tests/fixtures/` and are imported **only** by test files. If a
fixture is ever imported by anything under `src/`, that is a bug.

### Rule 2 — The database is the source of truth. AI never calculates.

Every operational number comes from deterministic code over database rows. Never ask a model
to compute a quantity, cost, total or count.

Correct: a typed function calculates, the model phrases the result.
Forbidden: the model reads job data as prose and produces a number.

### Rule 3 — Ask Sous is a tool-calling layer, not a chat box.

It has a fixed set of typed tools over the engine. Adding a capability means writing a new
tool function, not extending a prompt.

### Rule 4 — Three unit systems exist and are never conflated.

| System | Example | Used by |
|---|---|---|
| Recipe unit | 150 g chicken per portion | recipe definitions, scaling |
| Stock unit | kg chicken on hand | inventory, consumption |
| Purchase unit | 1 kg pack | shopping lists, pricing |

All conversion happens in `src/engine/units.ts`. Nowhere else. Every quantity crosses this
layer. It is the single most common source of silently wrong answers.

### Rule 5 — One recalculation path.

Any change to a job runs the same chain:

```
job change
  → portion requirements
  → ingredient requirements (consolidated across jobs)
  → purchase units
  → outstanding shopping (required − stock − purchased)
  → production batches
  → packing quantities
  → food cost and revenue
```

Never write a second version of a step for one screen.

### Rule 6 — Shopping, prep and packing are derived, never stored.

Only the owner's ticks persist (`purchase_state`, `prep_state`, `packing_state`). The lists
themselves are recomputed from jobs every time. This is what makes the cascade automatic.

### Rule 7 — Any write triggered by AI requires human confirmation.

Ask Sous and the scanners produce a **proposal** with a before/after diff and downstream
impact. A separate explicit commit call, fired by the owner tapping confirm, performs the
write. The model cannot call commit.

### Rule 8 — Never invent missing data.

Absent or ambiguous values are stored as null and surfaced as unresolved. Never substitute a
plausible number. A price is null, not 0. A guest count is null, not a guess. "A few
vegetarians" is stored verbatim as unresolved and blocks exact purchase quantities.

### Rule 9 — Never assert allergy safety.

Surface *possible* conflicts for human review. Language is always "possible conflict — review
required". Never "safe" or "no allergens".

### Rule 10 — Every job mutation is logged.

`job_changes` records field, old value, new value, who, when, source. A corrected eircode
leaves a trail. This is not optional.

---

## 2. STRUCTURE

```
src/
  engine/          pure TypeScript. NO imports of react, supabase, or anything in src/ui.
    units.ts       conversion between recipe / stock / purchase units
    scaling.ts     scaleRecipe, portionsToUnits
    production.ts  productionBuckets, prepPlanByDay, prioritisePrep
    shopping.ts    requirementsForRange, toPurchaseUnits, outstandingShopping
    costing.ts     recipeFoodCost, jobFoodCost, jobMargin
    rules.ts       applyBuffetSplit, bbq split guard, service rules
    checks.ts      allergenScan, dietaryCrossCheck, readinessCheck, anomalyScan
    impact.ts      changeImpact
    history.ts     historicalAggregate
    types.ts       shared domain types
  data/            supabase client, repositories, row <-> domain mappers
  features/        jobs, recipes, ingredients, shopping, prep, packing, money, setup, scan
  sous/            tool definitions, prompt, chat UI
  components/      shared UI
tests/
  fixtures/        golden pack — imported by tests ONLY
  engine/          unit tests, no DB, no browser
  e2e/             Playwright
supabase/
  migrations/
  functions/       ask-sous, parse-image
ARCHITECTURE.md
CLAUDE.md
```

The engine must run under plain Node with no browser and no database. That property is what
makes the golden regression pack executable. Do not break it.

---

## 3. THE ENGINE — required behaviour

Every function below is pure, typed, and unit-tested with worked numbers **before** it is
wired to a screen.

**scaleRecipe(recipe, portions)** — scaled ingredient list. Recurses through sub-recipes.

**portionsToUnits(portionsRequired, portionsPerBatch)** — rounds **up** to production
reality. 27 portions at 9 per tray = 3 trays. 29 = 4 trays. Never fractional. Also returns
surplus.

**productionBuckets(jobs, recipes)** — groups portions per recipe **per prep date**, then
rounds up. Three jobs needing 12 / 18 / 9 lasagne on the same prep date become one line:
39 portions, 5 trays, allocated 12 / 18 / 9.

**prepDateFor(job, recipe)** — service date minus `make_ahead_days`, or service date when
`same_day_only`.

**requirementsForRange(jobs, recipes)** — consolidated ingredient totals in base units, plus
a `gaps` list naming anything unquantified or missing a recipe. 4.5 kg chicken for curry plus
2 kg for Caesar is one line reading 6.5 kg.

**toPurchaseUnits(qtyBase, unitBase, ingredient)** — whole packs, rounded up, plus overage.
4.2 kg with 1 kg packs = 5. 17 eggs with 12 per pack = 2.

**outstandingShopping(...)** — required − stock − purchased, clamped at zero, surplus
reported separately.

**recipeFoodCost / jobFoodCost / jobMargin** — returns null with a `missing` list when any
input is unpriced. Never partial-sums to a number that looks complete.

**applyBuffetSplit(guests, dishes, recipes)** — where a buffet has several mains or several
desserts, guests divide evenly across them. 17 across curry + lasagne = 9 and 8. Sides and
single-dish courses take the full guest count.

**BBQ split** — meat items (mince, pork, drumsticks) scale to **meat-eating guests**. Sides
(baps, corn, potatoes, slaw) scale to **all guests**. These are two separate recipes. A BBQ
with meat and no sides line is an anomaly, and so is a sides count below the guest count.
This was a real defect found by the golden pack; it must never regress.

**allergenScan(job, recipes)** — possible conflicts only. Severe requirements with no
assigned dish are flagged regardless of keyword hits.

**readinessCheck / anomalyScan** — guest counts, times, addresses, menus, dietary allocation,
outstanding shopping, unpriced jobs, buffets without dessert, main portions below guest count,
missing recipes.

**changeImpact(jobs, recipes, jobId, changes)** — runs the whole cascade twice and diffs.
Returns ingredient deltas, batch deltas and revenue delta. It is a diff of two engine runs,
never a separately maintained calculation.

**historicalAggregate** — counts, average covers, revenue by service type, customer and period.

---

## 4. FEATURES — all of these ship

Carried over from the prototype. Nothing on this list is optional.

**Jobs** — create, edit, delete (with confirm), status transitions, customers, properties,
job groups for multi-service events, dietaries with severity and dish assignment, notes.
Guest-count change shows a live impact preview before saving.

**Recipes** — per-person and batch yields, portions per batch, batch unit, confidence
(`locked` / `confirm` / `missing`), unquantified components, make-ahead days, sub-recipes,
scale-to preview, per-recipe food cost.

**Ingredients** — category, three units, pack size with an "assumed" flag until confirmed,
supplier, price with history, allergen tags, stock.

**Shopping** — grouped by supplier, purchase units, outstanding vs required vs stock vs
bought, tick-off state, a "check these yourself" section for unquantified items, plain-text
export for WhatsApp.

**Prep** — consolidated production by day, batch counts with surplus, per-job allocation,
priority ordering, tick-off state.

**Packing** — per job, food lines from the menu plus equipment from owner-defined service
templates, tick-off state.

**Money** — revenue, food cost, margin per job and per range; derived from the rate card
where one exists, typed in otherwise. Blank when unknown, never zero.

**Ask Sous** — natural-language questions answered from engine output; conversational job
creation and job changes via propose-and-confirm; conversational shopping list building.

**Scan** — job sheets (a page of bookings), recipe cards (working out per-person vs per-batch),
supplier invoices (deriving price per pack from line total ÷ quantity). All three go through
review before saving.

**Dashboard** — covers, revenue, readiness percentage, anomalies, dietary warnings, next jobs,
outstanding shopping, stale-backup reminder.

**Setup** — import and export of a full JSON backup, rate card, service templates, clear-all
behind a confirm.

---

## 5. WORKING AGREEMENT

- Read this file and `ARCHITECTURE.md` at the start of every session.
- Use plan mode for anything touching more than one file. Present the plan; wait.
- Write the unit test with worked numbers **before** the calculation function.
- Keep the engine free of React and Supabase imports. It takes data in, returns data out.
- Never refactor working code outside the current task.
- Never change an expected test value to make a test pass. Investigate first.
- Propose schema changes; never apply them unilaterally.
- Every confirmed bug gets a permanent regression test.
- After a fix: rerun the failing test, then `npm run test:copperpot`, then the full suite.
- Every screen works on an iPhone in Safari. Used one-handed, in a kitchen and in a
  supermarket. Large touch targets, readable numerals, no hover-dependent interaction.
- When context runs long, update `ARCHITECTURE.md` with current state before compacting.

---

## 6. COMMANDS

```
npm run dev              local dev server
npm run test             all unit tests
npm run test:copperpot   golden regression pack
npm run test:e2e         Playwright workflows
npm run build            production build
npm run typecheck        tsc --noEmit
```

`npm run test:copperpot` must stay a single repeatable command. The golden pack is the
contract with the owner.

---

## 7. STACK

React + Vite + TypeScript · Supabase (Postgres, Auth, Edge Functions) · Vitest · Playwright ·
Vercel.

The Anthropic API key lives in a Supabase Edge Function secret. It is never in the browser
bundle, never in `.env` files that ship, never in the repo.
