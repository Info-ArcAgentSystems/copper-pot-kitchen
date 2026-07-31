# Building Copper Pot Kitchen — detailed build guide

Written for the current state: repo cloned, Supabase schema applied, Claude Code installed.
Every Claude Code prompt below is meant to be pasted as-is. Do not skip the reviews.

Paul's sequence is fixed: **get the baseline and all golden tests green FIRST, then build
his four priorities in order.** Do not start the rate table until the engine is green.

---

## The rhythm for every step

The same loop, all the way through. Learn it once:

1. `git pull` — start from the latest
2. `claude` — open Claude Code in the project folder
3. Paste the step's prompt
4. **Read the plan it proposes. Correct it. Only then approve.**
5. Let it build. Watch what it writes.
6. `npm run <the test for this step>` — must be green
7. `/diff` — read every change before committing
8. Commit with a clear message, push
9. Update `ARCHITECTURE.md` if anything structural changed

Never approve a plan you have not read. Never commit a diff you have not looked at. This is a
food-quantity and pricing system; a wrong number is worse than a missing feature.

---

# STAGE A — Finish the scaffold (Phase 0 remainder)

You have the docs and schema. You do not yet have a running app.

## A1 — Confirm where you are

In the VS Code terminal, inside the project folder:

```bash
ls -la
```

You must see `CLAUDE.md`, `ARCHITECTURE.md`, `schema.sql`, `.git`. If you see `.py` files you
are in the wrong folder — stop and `cd` to the copper-pot-kitchen folder.

```bash
git config user.name        # should be the person at this keyboard
git config user.email
```

If blank or wrong:

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@arcagentsystems.com"
```

## A2 — Scaffold Vite into the existing folder

The folder is not empty, so scaffold **into** it with the dot:

```bash
npm create vite@latest . -- --template react-ts
```

It warns the directory is not empty → choose **Ignore files and continue**. Your `.md` files
and `schema.sql` are kept.

```bash
npm install
npm install @supabase/supabase-js
npm install -D vitest @vitest/ui @types/node
npm install -D @playwright/test
npx playwright install
```

## A3 — Scripts and config

Open `package.json` and replace the `"scripts"` block with:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:copperpot": "vitest run tests/golden",
  "test:e2e": "playwright test"
}
```

Create `.gitattributes` (stops Windows↔Mac line-ending noise):

```
* text=auto eol=lf
```

Append to `.gitignore`:

```
.env
.env.local
.DS_Store
```

Create `.env.local` — values from Supabase → Settings → API:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## A4 — Drop in the golden fixtures

From Paul's v3 test pack, copy into `tests/fixtures/`:

```
tests/fixtures/fixtures.json
tests/fixtures/expected_results.json
tests/fixtures/PROVENANCE_RULES.md
```

These are imported by tests ONLY. If any file under `src/` ever imports them, that is a bug.

## A5 — Prove it runs, then commit

```bash
npm run dev          # Vite starter page should serve; Ctrl-C to stop
npm run typecheck    # clean
```

```bash
git add -A
git commit -m "Phase 0: Vite + React + TS scaffold, test tooling, golden fixtures"
git push
```

**Check on GitHub that `.env.local` is NOT in the pushed files.** If it is, stop and tell the team.

---

# STAGE B — Update the contract with Paul's new rules

Before any engine code, get Paul's confirmed rules into `CLAUDE.md` so Claude Code builds to
them from the first line. Open `claude` and paste:

```
Update CLAUDE.md with these confirmed business rules from the owner. Add them to the
non-negotiable rules section, keeping the existing numbering and adding new rules after it.
Do not remove anything.

- Pricing is by client group + service type. A rate has an optional per-head rate and an
  optional flat fee. Jobs may carry extras/surcharges as named line items. Revenue normally
  computes as guests × per-head rate + extras, or flat fee + extras. Any job may override the
  computed price with a manual figure, and the override is recorded as such.

- Uncertain input is never guessed. "A few vegetarians" is stored as the original wording,
  flagged unresolved, and blocks exact purchase quantities until a real number replaces it.
  The UI must make it obvious that confirmation is needed.

- Orange juice is a fixed 200 ml per person. There is no range. (Range support is a separate
  later feature for genuinely range-valued items; orange juice is not one.)

- Every meaningful change to a job, menu, dietary or price records who changed it, when, the
  old value and the new value, in job_changes.

- Completed and cancelled jobs stay in the system. A completed job can still be corrected, but
  the correction is logged, never a silent overwrite.

- Dietary requirements are structured where possible, but dietary counts must NOT be summed
  automatically, because one guest can belong to several dietary categories at once.

- Support access (the developer 'support' role) is acceptable during development provided it
  remains controlled and revocable.

Then show me the diff.
```

Read the diff. Commit:

```bash
git add CLAUDE.md
git commit -m "Contract: add owner-confirmed pricing, uncertainty, audit and dietary rules"
git push
```

---

# STAGE C — The engine and the 33 tests (Phase 2) · Engineer 1

This is the product. Everything else is a shell around it. Build it as pure TypeScript with
no React and no Supabase, so the golden pack runs under plain Node.

## C1 — Types first

```
/plan
Read CLAUDE.md and ARCHITECTURE.md. We are on Phase 2, the pure engine under src/engine.

Start with src/engine/types.ts only: the domain types for kitchen, property, customer,
recipe, recipe ingredient (including sub-recipes and a fixed quantity — no ranges yet),
ingredient with its three unit systems, job, job dish, job dietary (with an unresolved flag
and original wording), client rate, and job extra.

No logic yet. Just the types. Present them for review before writing.
```

Review the types carefully — everything downstream leans on them. Commit.

## C2 — Units, then scaling

```
/plan
Build src/engine/units.ts: conversion between recipe, stock and purchase units, driven by
each ingredient's own conversion factors. Write the Vitest test with worked numbers first:
150 g → 0.15 kg, 4.2 kg into 1 kg packs = 5 packs, 17 eggs into dozens = 2 packs.

Then src/engine/scaling.ts: scaleRecipe (recurses through sub-recipes) and portionsToUnits
(rounds UP, returns surplus). Test 27/9 = 3 trays, 29/9 = 4 trays, before the code.
```

```bash
npm run test        # both green before moving on
```

## C3 — Production and shopping

```
/plan
Build src/engine/production.ts: prepDateFor, productionBuckets (consolidate portions per
recipe per prep date, then round up to whole batches with surplus and per-job allocation),
prepPlanByDay, prioritisePrep.

Then src/engine/shopping.ts: requirementsForRange (consolidated totals plus a gaps list for
unquantified or recipe-missing items), toPurchaseUnits (whole packs, rounded up, with
overage), outstandingShopping (required − stock − purchased, clamped at zero).

Tests with worked numbers before each function.
```

## C4 — Costing and rules

```
/plan
Build src/engine/costing.ts: recipeFoodCost, jobFoodCost, jobMargin. Each returns null with
a 'missing' list when any input is unpriced — never a partial number that looks complete.

Then src/engine/rules.ts:
- applyBuffetSplit: several mains or several desserts split guests evenly (17 across curry +
  lasagne = 9 and 8); sides and single-dish courses take the full guest count.
- the BBQ split: meat items (mince, pork, drumsticks) scale to meat-eating guests; sides
  (baps, corn, potatoes, slaw) scale to ALL guests. This is the defect the golden pack caught.
  27 guests, 22 meat eaters must produce 27 baps and 2700 g potatoes.

Tests first, including the 27-guest BBQ case.
```

## C5 — Checks, impact, history

```
/plan
Build src/engine/checks.ts (allergenScan — possible conflicts only, never asserts safety;
dietaryCrossCheck; readinessCheck; anomalyScan including the BBQ-no-sides and
sides-below-guests flags), src/engine/impact.ts (changeImpact as a diff of two full engine
runs), and src/engine/history.ts (historicalAggregate).

Tests first. allergenScan must flag a severe requirement with no assigned dish regardless of
keyword hits.
```

## C6 — Wire the golden pack

```
Create tests/golden/. Load tests/fixtures/fixtures.json and expected_results.json and turn
every deterministic_test into an executable Vitest case, so `npm run test:copperpot` runs the
whole pack.

Honour PROVENANCE_RULES.md:
- 'confirmed' may seed inputs
- 'derived' is ground truth only where the underlying rule is confirmed
- 'historical_output' is a benchmark — investigate a conflict, never overwrite an expected value
- 'uncertain' must NEVER become a hard expectation

Do not change any expected value to make a test pass. If one fails, show me the input,
expected and actual, and the responsible engine function.
```

## C7 — The bar for leaving Stage C

```bash
npm run test:copperpot
```

**All green.** Especially `CALC-NUCELLA-BBQ-SPLIT` — 27 guests, 22 meat eaters, 27 baps,
2700 g potatoes. This is Paul's line in the sand: baseline and 33/33 before any new feature.

Commit, push, and update `ARCHITECTURE.md` to mark the engine modules done and the golden
suite green. **Tell Paul the baseline is green before building further** — that is the
checkpoint he asked for.

---

# STAGE D — Data layer (Phase 3)

```
/plan
Build src/data: the Supabase client (reading VITE_ vars), one typed repository per table, and
mappers converting database rows to the engine's domain types and back.

The engine must not import anything from here — data flows one way: repository reads a row,
mapper converts, engine calculates.

Every write to jobs, job_dishes, job_dietaries or pricing also writes a job_changes row with
field, old value, new value, the acting user, and source. This is the audit rule; build it
into the repository so it cannot be bypassed.
```

Verify against real Supabase: sign in as a support user, write a job, confirm a `job_changes`
row appears. Sign out, confirm RLS blocks the read.

---

# STAGE E — Screens (Phase 4) · Engineer 2

## E1 — Core records

```
/plan
Build the CRUD screens under src/features: jobs, customers, properties, recipes, ingredients,
suppliers, the client rate card, and service templates.

Every screen starts EMPTY — no seed data, no demo toggle, no fallback lists. Empty states
invite the owner to add the first record.

The job screen shows a live impact preview when guest count changes, before saving. Dietaries
are entered structured, with severity and an 'unresolved' option that stores the original
wording. Never sum dietary counts.

Mobile first: iPhone Safari, one-handed, large touch targets, tabular numerals for quantities.
```

## E2 — Derived screens

```
/plan
Build shopping, prep, packing and money — all computed from the engine on every render. Only
tick-off state persists (purchase_state, prep_state, packing_state).

Shopping groups by supplier, shows purchase units, has a 'check these yourself' section for
unquantified items, and a plain-text WhatsApp export. Prep groups by production day with batch
counts and surplus. Money shows revenue (guests × rate + extras, or the manual override),
food cost and margin per job and per range — blank, never zero, when unknown.
```

---

# STAGE F — Auth, setup, backup (Phase 5)

```
/plan
Build the login screen (Supabase email/password) and the Setup tab: full JSON export and
import, rate-card editing, service templates, and a clear-all behind a confirmation.

Export downloads a dated .json file, falls back to the clipboard, and always shows the text
on screen so it works even if the download is blocked. The dashboard shows a reminder when
there are unsaved changes since the last export.
```

---

# STAGE G — Ask Sous and scanners (Phase 6)

Edge functions first:

```bash
npx supabase init
npx supabase link --project-ref <your-ref>
npx supabase functions new ask-sous
npx supabase functions new parse-image
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

```
/plan
Implement supabase/functions/ask-sous: takes a message plus a compact context summary,
returns a structured intent as JSON. It never calculates — the client runs the engine on the
intent. Implement parse-image for the three scan modes (job sheet, recipe card, invoice),
each returning JSON with an 'uncertain' array.

Then src/sous: typed tools over the engine, chat UI, and the propose-and-confirm flow. Write
tools return a proposal with a before/after diff; a separate commit call, fired by the owner
tapping confirm, performs the write. The model cannot call commit.

Scan review screens: nothing saves straight from OCR. Flag any dish or ingredient not already
in the owner's data rather than creating it silently. Invoice scans derive price per pack
deterministically: line total ÷ quantity, converted to the stored pack size.
```

---

# STAGE H — End-to-end tests (Phase 7) · Engineer 2

```
/plan
Build tests/e2e with Playwright covering: create a job; change guest count and verify
shopping, prep, packing and money all move; change the menu; add and remove a dietary; change
date/time/location and verify the audit trail; tick-off persistence; job status transitions
including completed-stays-correctable; unresolved input blocking exact quantities; and the
same critical flows at iPhone viewport size.

Seed each test through the UI or a test-only helper. Never import fixtures into src/.
```

Then wire GitHub Actions to run `npm run test:copperpot` and `npm run test:e2e` on every push.

---

# STAGE I — Deploy (Phase 8)

```bash
npm run build      # clean
```

Vercel → import the repo → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` → deploy.
Paul signs in to an empty app and enters his recipe bank, or imports the prototype backup.

---

# THEN — Paul's four priorities, in his order

Only after the baseline is green and the core app works. Each is a feature branch, each ends
with new golden/regression tests, each keeps the suite green.

1. **Client rate table / revenue.** Rate card by client group + service type, extras as line
   items, per-job manual override. Revenue = guests × rate + extras. Adds the FIN-REVENUE
   fixture as a real derivation rather than typed totals.

2. **Uncertainty / no-guessing.** The unresolved dietary path end to end: stored wording,
   unresolved flag, shopping blocked until confirmed, obvious in the UI. Satisfies
   UNCERTAINTY-NO-GUESSING.

3. **Audit / change history.** Surfacing the job_changes trail in the UI — who, when, old,
   new — for job, menu, dietary and price changes, including corrections to completed jobs.
   Satisfies AUDIT-CHANGE-HISTORY.

4. **Range quantities.** Genuine min/max quantities for items that are truly ranges, with the
   shopping list rounding up on max. (Orange juice is NOT one of these — it is fixed at 200 ml.)

---

# A note on working style

- One person drives Claude Code per repo at a time. If both of you push, `git pull` before you
  start and after the other commits.
- End every session with: "Update ARCHITECTURE.md with what we built and what's next," then
  commit. The next session — or the other engineer — reads that to get oriented.
- Watch `/cost` occasionally. Paul tracks spend.
- When a test fails, never edit the expected value. Find the cause. Fix the smallest
  responsible layer. Add a regression test.
