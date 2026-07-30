# Building Copper Pot Kitchen as a real repo

A step-by-step guide for two engineers who have not used Claude Code before.

Work through Part 1 once. Part 2 is a primer you can read in fifteen minutes. Part 3 is the
build, in phases. Part 4 is the daily loop once it is running.

---

# PART 0 — What we are changing, and why

The prototype worked. It caught a genuine food-quantity bug on the first run of Paul's golden
test pack. What it cannot do is be tested automatically, because a published artifact is not a
codebase — no repo, no test runner, nothing for Claude Code to point at.

**Same stack as MISE, different shape.** MISE is a single ~7,300-line `App.jsx`. That is the
one thing not to repeat: it is why the calculation engine had to be lifted out by hand to run
the fixtures. Here the engine is isolated from the start.

Three decisions worth stating:

**The engine is pure TypeScript with no dependencies.** No React, no Supabase. It runs under
plain Node, which is what makes the golden pack executable on every commit.

**Nothing is hardcoded.** The app ships empty. Paul enters every recipe, ingredient, price and
job himself, or imports a backup he made. Test fixtures live in `tests/` and are never imported
by application code.

**One user, one kitchen.** Paul owns it. The dev team gets support access to the same rows for
debugging, through a members table — not by building an organisation model.

---

# PART 1 — Accounts and tools

Do this once, on each engineer's machine.

## 1.1 Install the basics

Check what you have:

```bash
node --version    # need 20 or newer
git --version
```

If Node is missing or old, install from nodejs.org (LTS).

## 1.2 Install Claude Code

**macOS / Linux / WSL:**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://claude.ai/install.ps1 | iex
```

Verify:

```bash
claude --version
claude doctor        # diagnoses a broken install
```

If you would rather not live in a terminal, the Claude desktop app has a **Code** tab with the
same capability and a friendlier interface. Everything below works either way.

## 1.3 Accounts

- **GitHub** — one private repo, `copper-pot-kitchen`.
- **Supabase** — free tier. One project. Note the project URL and anon key.
- **Anthropic Console** — one API key for Ask Sous and the scanners. This key goes into a
  Supabase secret, never into the repo.
- **Vercel** — free tier, connected to the GitHub repo.

---

# PART 2 — Claude Code in fifteen minutes

Skip this if you already use it.

## 2.1 The mental model

Claude Code is an agent that works **inside a folder on your machine**. It reads your files,
edits them, runs your commands, and shows you what it did. It is not a chat window that emits
code for you to paste — it changes the actual repo.

Two consequences:

- **Git is your undo button.** Commit often. Before anything risky, branch.
- **It only knows what it can read.** `CLAUDE.md` is how you give it standing context so you
  are not re-explaining the project every session.

## 2.2 Starting a session

```bash
cd ~/code/copper-pot-kitchen
claude
```

You are now in an interactive session, in that folder. Type what you want in plain English.

Useful launch flags:

```bash
claude -c                        # continue the last session
claude --permission-mode plan    # start read-only, in plan mode
claude "run the test suite"      # one-shot task, then exit
```

## 2.3 The five commands to learn first

Type `/` in a session to see everything. These five carry most of the value:

| Command | What it does | When |
|---|---|---|
| `/plan` | Read-only planning mode. Claude analyses and proposes, but cannot write. | Before any change touching more than one file |
| `/diff` | Shows the file changes made so far | Before you commit |
| `/context` | Shows what is filling the context window | When replies start degrading |
| `/compact` | Summarises the conversation to free space | When `/context` looks full |
| `/cost` | Token spend for this session | Paul watches this; so should you |

Also worth knowing early: `/init` generates a starter `CLAUDE.md` (we are supplying our own,
so you will not need it), `/memory` edits it, `/rewind` rolls back to a checkpoint, and
`/clear` wipes the conversation while staying in the folder.

**Keyboard:** `Shift+Tab` cycles Normal → Plan → Auto-accept. `Esc` interrupts a running
response. Double-tap `Esc` opens the rewind menu.

Avoid auto-accept mode on this project. Food quantities and prices are not a place for
unreviewed edits.

## 2.4 The habit that matters most

**Plan before you build.** For anything non-trivial:

```
/plan
Read CLAUDE.md and ARCHITECTURE.md. We are building Phase 3, the shopping engine.
Propose the approach before writing anything.
```

Read the plan. Correct it. Then approve. Letting it write first and reviewing after is how
these projects drift.

## 2.5 A warning about scope

Claude Code will happily rewrite more than you asked. Counter it two ways: the working
agreement in `CLAUDE.md` says not to, and `/diff` before every commit shows you if it did.

---

# PART 3 — The build

Seven phases. Ship each one working before starting the next.

## Phase 0 — Repo skeleton (½ day)

### 0.1 Scaffold

```bash
npm create vite@latest copper-pot-kitchen -- --template react-ts
cd copper-pot-kitchen
npm install
git init
```

### 0.2 Dependencies

```bash
npm install @supabase/supabase-js
npm install -D vitest @vitest/ui typescript @types/node
npm install -D @playwright/test
npx playwright install
```

### 0.3 Scripts

Put these in `package.json`:

```json
{
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
}
```

`npm run test:copperpot` is required by Paul's test pack. Keep that name.

### 0.4 Drop in the contract files

Copy into the repo root:

- `CLAUDE.md` (supplied)
- `ARCHITECTURE.md` — create it empty; Claude Code maintains it
- `.gitignore` — confirm it contains `.env`, `.env.local`, `node_modules`, `dist`

Copy Paul's pack into `tests/fixtures/`:

- `fixtures.json`
- `expected_results.json`
- `PROVENANCE_RULES.md`

### 0.5 First commit

```bash
git add -A
git commit -m "Scaffold: Vite + React + TS, Vitest, Playwright, project contract"
```

Push to GitHub.

---

## Phase 1 — Database (½ day)

### 1.1 Run the schema

Supabase dashboard → SQL Editor → paste `schema.sql` → run.

It creates every table, index and row-level-security policy. **It inserts no data.**

### 1.2 Create the accounts

Paul signs up once through the app's login screen (built in Phase 5) or via Supabase
Auth → Users → Add user. Each developer does the same.

Then, in the SQL editor:

```sql
insert into kitchens (name) values ('Copper Pot Kitchen') returning id;
```

Note the returned id, then:

```sql
insert into kitchen_members (user_id, kitchen_id, role)
select id, '<kitchen-id>', 'owner'
from auth.users where email = 'paul@example.com';

insert into kitchen_members (user_id, kitchen_id, role)
select id, '<kitchen-id>', 'support'
from auth.users where email = 'engineer@arcagent.ie';
```

That is the whole access model. Paul owns it, you can see it, nobody else can.

### 1.3 Environment

`.env.local` — never committed:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

The Anthropic key does **not** go here. It goes into a Supabase secret in Phase 6.

### 1.4 Verify RLS

Sign in as a developer, query `jobs`, get an empty list rather than an error. Sign out, query
again, get nothing. If an unauthenticated query returns rows, RLS is misconfigured — stop and
fix it before continuing.

---

## Phase 2 — The engine (1–2 weeks) · **Engineer 1**

This is the product. Nothing else is worth building until this is right.

Start Claude Code in the repo:

```bash
claude
```

Then:

```
/plan
Read CLAUDE.md. Build Phase 2 only: the pure calculation engine under src/engine.
No UI, no Supabase, no React imports anywhere in that folder.

Work in this order, writing the Vitest test with worked numbers BEFORE each function:

1. units.ts        — conversion between recipe, stock and purchase units
2. scaling.ts      — scaleRecipe, portionsToUnits (round UP, return surplus)
3. production.ts   — prepDateFor, productionBuckets, prepPlanByDay, prioritisePrep
4. shopping.ts     — requirementsForRange, toPurchaseUnits, outstandingShopping
5. costing.ts      — recipeFoodCost, jobFoodCost, jobMargin (null when unpriced)
6. rules.ts        — applyBuffetSplit, BBQ meat/sides split
7. checks.ts       — allergenScan, dietaryCrossCheck, readinessCheck, anomalyScan
8. impact.ts       — changeImpact, as a diff of two full engine runs
9. history.ts      — historicalAggregate

Section 3 of CLAUDE.md specifies the required behaviour of each.
Present the plan before writing anything.
```

Review the plan properly. Then let it build, committing after each file.

### 2.1 Wire the golden pack

```
Create tests/golden/. Load tests/fixtures/fixtures.json and expected_results.json,
and turn every deterministic_test into an executable Vitest case.

Preserve the confidence field. Rules:
- 'confirmed' may seed inputs
- 'derived' is ground truth only where the underlying rule is confirmed
- 'historical_output' is a benchmark — investigate conflicts, do not overwrite
- 'uncertain' must NEVER become a hard expectation

npm run test:copperpot must run this suite and nothing else.
```

### 2.2 The bar for leaving Phase 2

```bash
npm run test:copperpot
```

All six deterministic cases green, including `CALC-NUCELLA-BBQ-SPLIT` — 27 guests, 22 meat
eaters, **27** baps and **2700 g** of potatoes. That case caught a real bug in the prototype.
If it fails here, the split is wrong again.

---

## Phase 3 — Data layer (3 days)

```
/plan
Build src/data: the Supabase client, typed repositories per table, and mappers between
database rows and the engine's domain types.

The engine must not import anything from here. Data flows one way: repository reads a
row, mapper converts it to a domain type, engine calculates.

Every write to jobs, job_dishes or job_dietaries also writes a job_changes row recording
field, old value, new value, user and source.
```

---

## Phase 4 — Core screens (1 week) · **Engineer 2**

```
/plan
Build the CRUD screens under src/features: jobs, customers, properties, recipes,
ingredients, suppliers, rate card, service templates.

Every screen starts EMPTY. No seed data, no demo toggle, no fallback lists.
Empty states invite the owner to add the first record.

Mobile first: iPhone Safari, one-handed, large touch targets, tabular numerals for
every quantity.
```

Then the derived screens:

```
/plan
Build shopping, prep, packing and money. All four are computed from the engine on every
render. Only the owner's tick-off state persists, in purchase_state, prep_state and
packing_state.

Shopping groups by supplier, shows purchase units, and exports plain text for WhatsApp.
Prep groups by production day with batch counts and surplus.
```

---

## Phase 5 — Auth, setup, backup (2 days)

```
/plan
Build the login screen (Supabase email and password, single user), and the Setup tab:
full JSON export and import, rate card editing, service templates, and a clear-all
behind a confirmation step.

Export downloads a dated .json file, falls back to the clipboard, and always shows the
text on screen so it works even if the download is blocked.

The dashboard shows a reminder when there are changes since the last export.
```

Backup matters more than it sounds. Build it before real data exists, not after.

---

## Phase 6 — Ask Sous and the scanners (1–2 weeks)

### 6.1 Edge functions

```bash
npx supabase init
npx supabase link --project-ref <your-ref>
npx supabase functions new ask-sous
npx supabase functions new parse-image
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

The key lives here and only here. Never in the browser bundle.

```
/plan
Implement supabase/functions/ask-sous. It takes a user message plus a compact context
summary and returns a structured intent as JSON. It never calculates. The client runs
the engine against the returned intent and renders real numbers.

Implement supabase/functions/parse-image for the three scan modes: job sheet, recipe
card and supplier invoice. Each returns structured JSON with an "uncertain" array
naming anything guessed or unreadable.

Deploy both with: npx supabase functions deploy
```

### 6.2 The client side

```
/plan
Build src/sous: the tool definitions over the engine, and the chat UI.

Read tools answer questions. Write tools return a PROPOSAL with a before/after diff and
the downstream impact — never a direct write. A separate commit call, fired by the owner
tapping confirm, performs the write.

Build the scan review screens. Nothing saves straight from OCR. Flag any dish or
ingredient not already in the owner's data rather than creating it silently.

Invoice scans derive price per pack deterministically: line total ÷ quantity delivered,
converted to the stored pack size. The model reads the page; the code does the maths.
```

---

## Phase 7 — End-to-end tests (3 days) · **Engineer 2**

This is what the artifact could never give you.

```
/plan
Build tests/e2e with Playwright, covering the workflow groups in Paul's
CLAUDE_CODE_TEST_PROMPT.md:

- create a job
- change guest count, verify shopping, prep, packing and money all move
- change the menu, verify downstream
- add and remove a dietary, verify warnings
- change date, time and location, verify the audit trail
- prep and shopping tick-off persistence
- job status transitions
- unresolved input behaviour (an unresolved dietary count blocks exact quantities)
- the same critical flows at iPhone viewport size

Seed each test through the UI or a test-only repository helper. Never import fixtures
into application code.
```

Then wire CI so GitHub Actions runs `npm run test:copperpot` and `npm run test:e2e` on
every push.

---

## Phase 8 — Deploy

```bash
npm run build          # must pass clean
```

Vercel → import the GitHub repo → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
environment variables → deploy.

Paul gets the URL and signs in. **The app is empty.** He enters his recipe bank, or imports
the backup exported from the prototype.

---

# PART 4 — The daily loop

Matches Paul's `TESTING_WORKFLOW.md`.

```bash
git pull
npm run test:copperpot          # green before you start
claude
```

Then:

1. Engineer 1 takes calculation failures. Engineer 2 takes workflow failures.
2. For each failure, capture the exact input, expected and actual.
3. Work out whether it is code, fixture, mapping or an unresolved business rule.
4. Fix only when you understand the cause. Fix the smallest responsible layer.
5. **Never edit an expected value to make a test pass.**
6. Add a permanent regression test.
7. Rerun the failing test, then the full suite.
8. `/diff`, then commit.

A useful prompt shape for triage:

```
npm run test:copperpot is failing on CALC-NUCELLA-BBQ-SPLIT.
Show me the exact input, expected and actual. Identify the responsible layer.
Do not change any expected value. Propose the smallest fix.
```

---

# PART 5 — Four things only Paul can answer

Not bugs. Values the app was never told. Blocking for Phase 2 and Phase 5.

1. **Tranquillity BBQ rate.** History shows €320 for 16 guests (€20 per head), but the rate
   card has no Tranquillity BBQ entry. Which is correct?
2. **Should revenue derive** from client group + service + head count, or be typed per job?
3. **Continental orange juice** is 150–200 ml. Lock a number, or keep it a range the
   shopping list rounds up?
4. **Unresolved quantities** — should "a few vegetarians" block the shopping list until
   resolved, or warn and continue? Same question for a missing eircode.

Still outstanding from earlier: cheesecake quantities need confirming, and there are no
quantities at all for sticky toffee pudding or the eight tapas dishes. Those stay flagged,
never guessed.

---

# Timeline

| Phase | Work | Time |
|---|---|---|
| 0 | Repo skeleton | ½ day |
| 1 | Database | ½ day |
| 2 | Engine + golden pack | 1–2 weeks |
| 3 | Data layer | 3 days |
| 4 | Core and derived screens | 1 week |
| 5 | Auth, setup, backup | 2 days |
| 6 | Ask Sous and scanners | 1–2 weeks |
| 7 | End-to-end tests | 3 days |
| 8 | Deploy | ½ day |

**Roughly 5–7 weeks with two engineers**, faster than the prototype took because the domain
is now understood and the golden pack tells you when you are right.

The hidden cost is unchanged: Paul entering his real recipes with accurate quantities and
yields. Scaling and shopping are only as good as that data, and it is what decides whether
he is still using this in six months.
