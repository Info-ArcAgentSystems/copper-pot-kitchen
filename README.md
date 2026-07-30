# Copper Pot Kitchen

Operations system for a private chef and catering business — jobs, menus, recipe scaling,
shopping, prep, packing and financials, with a natural-language assistant on top.

One user: the owner. A small support team has read/write access to the same data for
debugging.

**Just been handed this repo?** Read Part 1, install what is listed, then pick up
`REPO_SETUP_GUIDE.md` at the first unticked step in Part 2 below.

---

## What is in this folder

| File | What it is | When you read it |
|---|---|---|
| **README.md** | this file — setup, orientation, progress | once, first |
| **REPO_SETUP_GUIDE.md** | the build, in eight phases, with the exact prompts to give Claude Code | follow it start to finish |
| **CLAUDE.md** | the contract: rules that never change | Claude Code reads it every session; you read it once so you know what it enforces |
| **ARCHITECTURE.md** | the map: what exists right now | check before any structural change; update whenever something changes |
| **schema.sql** | the database, run once in Supabase | Phase 1 |

The distinction that matters: **`CLAUDE.md` is what must always be true. `ARCHITECTURE.md` is
what happens to be true today.** The first you write once. The second changes constantly, and
is the handoff between machines and between people.

---

# Part 1 — What to install

## 1.1 Node and git

```bash
node --version     # need v20 or newer
git --version
```

Missing or too old? Install the **LTS** release from [nodejs.org](https://nodejs.org). Git
comes with Xcode command line tools on macOS (`xcode-select --install`), or from
[git-scm.com](https://git-scm.com).

Set your identity before your first commit, or git stamps commits with whatever account was
configured previously:

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@arcagentsystems.com"
```

## 1.2 Claude Code

A command-line agent that works inside a folder on your machine — it reads your files, edits
them, and runs your commands. **Install it on every machine you work from.** Session history
does not sync; `ARCHITECTURE.md` is what carries context across.

**macOS, Linux, Windows WSL:**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://claude.ai/install.ps1 | iex
```

Check it:

```bash
claude --version
claude doctor        # if something looks wrong
```

Sign in on first run with your Claude subscription account.

**Prefer not to use a terminal?** The Claude desktop app has a **Code** tab with the same
capability, and there is a VS Code extension. Slash commands and prompts are identical.

## 1.3 Accounts

| Service | Why | Needed by |
|---|---|---|
| **GitHub** | the repo | Phase 0 |
| **Supabase** | database, auth, edge functions | Phase 1 |
| **Anthropic Console** | API key for Ask Sous and the scanners | Phase 6 |
| **Vercel** | hosting | Phase 8 |

All free tier except the Anthropic key, which is pay-as-you-go and small for one user.

**The Anthropic API key is not your Claude subscription.** Claude Code runs on the
subscription; the app calls the API directly and needs a separate key from
[console.anthropic.com](https://console.anthropic.com). It goes into a Supabase function
secret — never into the repo, never into the browser bundle.

---

# Part 2 — Build progress

Tick these off as you go. `ARCHITECTURE.md` holds the detail; this is the quick view.

### Phase 0 — Repo skeleton

- [x] GitHub org `Info-ArcAgentSystems` created
- [x] Private repo `copper-pot-kitchen`
- [x] Five contract documents committed
- [ ] `.gitattributes` with `* text=auto eol=lf` (matters when moving Windows ↔ Mac)
- [ ] Vite scaffold — `npm create vite@latest . -- --template react-ts` (the dot keeps the existing files)
- [ ] Dependencies: `@supabase/supabase-js`, `vitest`, `@playwright/test`
- [ ] `package.json` scripts replaced with the block in the setup guide
- [ ] `.env.local` created (never committed)
- [ ] Test pack copied into `tests/fixtures/`

### Phase 1 — Database

- [x] Supabase project created
- [x] `schema.sql` applied — 22 tables, RLS enabled
- [x] Kitchen row created
- [x] `info@arcagentsystems.com` granted `owner`, membership verified
- [ ] Developer accounts added as `support`
- [ ] Owner's own account created and promoted (Phase 8)

### Phases 2–8

- [ ] Phase 2 — engine + golden pack · *Engineer 1*
- [ ] Phase 3 — data layer
- [ ] Phase 4 — core and derived screens · *Engineer 2*
- [ ] Phase 5 — auth, setup, backup
- [ ] Phase 6 — Ask Sous and scanners
- [ ] Phase 7 — end-to-end tests · *Engineer 2*
- [ ] Phase 8 — deploy

---

# Part 3 — Working across two machines

The repo is the sync. Nothing else needs moving.

**Starting a session:**

```bash
git pull
npm install        # only if package.json changed
claude
```

Then, first thing you type:

```
Read CLAUDE.md and ARCHITECTURE.md. Tell me where we got to and what's next.
```

**Finishing a session:**

```
Update ARCHITECTURE.md with what we built and anything a fresh session needs to know.
```

Then commit and push. Even half-finished work — an uncommitted afternoon stranded on the
wrong laptop costs you a morning.

**First time on a new machine** it is a clone, not a pull:

```bash
mkdir -p ~/code/arcagent && cd ~/code/arcagent
git clone https://github.com/Info-ArcAgentSystems/copper-pot-kitchen.git
cd copper-pot-kitchen
npm install
```

Two things never arrive with a clone, by design: `node_modules` (run `npm install`) and
`.env.local` (recreate it from Supabase → Settings → API).

---

# Part 4 — Claude Code in five commands

Type `/` in a session to see everything. These five carry most of the value:

| Command | What it does | When |
|---|---|---|
| `/plan` | read-only — analyses and proposes, cannot write | before any change touching more than one file |
| `/diff` | shows the file changes made so far | before every commit |
| `/context` | shows what is filling the context window | when answers get vague |
| `/compact` | summarises the conversation to free space | when `/context` looks full |
| `/cost` | token spend this session | regularly |

**Keyboard:** `Shift+Tab` cycles Normal → Plan → Auto-accept · `Esc` interrupts ·
double-`Esc` opens rewind.

**Launch:** `claude` starts a session · `claude -c` continues the last one ·
`claude --permission-mode plan` starts read-only.

**Two habits that decide whether this goes well.** Plan before you build — `/plan`, read the
proposal, correct it, then approve. And never use auto-accept on this project: food
quantities, allergy warnings and prices are not a place for unreviewed edits.

---

# Part 5 — Ground rules

Full set in `CLAUDE.md`. These four cause the most trouble if forgotten:

**No hardcoded data.** The app ships empty. Every recipe, ingredient, price and job is entered
by the owner or imported from his own backup. Fixtures live in `tests/fixtures/` and are
imported by test files only. A fixture appearing under `src/` is a bug.

**The engine stays pure.** Nothing under `src/engine` imports React, Supabase, or anything
else. It must run under plain Node — that is what makes the regression pack executable, and
the entire reason this repo exists rather than the prototype.

**Code calculates, AI explains.** No model ever produces a quantity, cost or total. A typed
function calculates; the model phrases the result.

**Nothing is invented.** A missing price is null, not zero. A missing guest count is null, not
a guess. "A few vegetarians" is stored as written and blocks exact purchase quantities until
resolved.

---

# Part 6 — What is next

1. Finish the Phase 0 boxes in Part 2 above
2. Open `REPO_SETUP_GUIDE.md` at Phase 2 — the engine, where the real work is
3. Get the owner's answers to the four questions in Part 5 of that guide **before Phase 2
   completes**. Two affect how revenue is calculated, and guessing means rewriting the costing
   layer later.

## Commands

```bash
npm run dev              # local dev server
npm run test             # all unit tests
npm run test:copperpot   # the golden regression pack
npm run test:e2e         # Playwright workflow tests
npm run typecheck        # tsc --noEmit
npm run build            # production build
```

`npm run test:copperpot` is the one that matters. It is the contract with the owner: his
historical jobs, reproduced correctly, on every commit.
