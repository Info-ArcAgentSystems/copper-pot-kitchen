# Copper Pot Kitchen

Operations system for a private chef and catering business — jobs, menus, recipe scaling,
shopping, prep, packing and financials, with a natural-language assistant on top.

One user: the owner. A small support team has read/write access to the same data for
debugging.

**Start here if you have just been handed this repo.** Read Part 1, install what is listed,
then follow `REPO_SETUP_GUIDE.md`.

---

## What is in this folder

Four documents. Read them in this order the first time; after that, only the first two matter
day to day.

| File | What it is | When you read it |
|---|---|---|
| **README.md** | this file — setup and orientation | once, first |
| **REPO_SETUP_GUIDE.md** | the build, in eight phases, with the exact prompts to give Claude Code | follow it start to finish |
| **CLAUDE.md** | the contract: rules that never change | Claude Code reads it every session; you read it once so you know what it enforces |
| **ARCHITECTURE.md** | the map: what exists right now | check it before any structural change; update it whenever something changes |
| **schema.sql** | the database, run once in Supabase | Phase 1 |

The distinction that matters: **`CLAUDE.md` is what must always be true. `ARCHITECTURE.md` is
what happens to be true today.** The first you write once. The second changes constantly.

---

# Part 1 — What to install

## 1.1 Node and git

Check first:

```bash
node --version     # need v20 or newer
git --version
```

Missing or too old? Install the **LTS** release from [nodejs.org](https://nodejs.org). Git
comes with Xcode command line tools on macOS (`xcode-select --install`), or from
[git-scm.com](https://git-scm.com).

## 1.2 Claude Code

This is the only unfamiliar piece. It is a command-line agent that works inside a folder on
your machine — it reads your files, edits them, and runs your commands.

**macOS, Linux, or Windows WSL:**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://claude.ai/install.ps1 | iex
```

Then check it worked:

```bash
claude --version
```

If something looks wrong:

```bash
claude doctor
```

The first time you run `claude`, it will ask you to sign in. Use the account with your Claude
subscription.

**Prefer not to use a terminal?** The Claude desktop app has a **Code** tab with the same
capability and a friendlier interface. Everything in the setup guide works either way — the
slash commands and prompts are identical.

## 1.3 Accounts

| Service | Why | Cost |
|---|---|---|
| **GitHub** | one private repo | free |
| **Supabase** | database, auth, edge functions | free tier is enough |
| **Anthropic Console** | API key for Ask Sous and the scanners | pay as you go, small for one user |
| **Vercel** | hosting | free tier |

The Anthropic key is **not** the same as your Claude subscription. Create one at
[console.anthropic.com](https://console.anthropic.com). It goes into a Supabase secret in
Phase 6 — never into the repo, never into the browser bundle.

---

# Part 2 — Your first Claude Code session

Worth doing once before you start the real build, just to see how it behaves.

```bash
cd path/to/copper-pot-kitchen
claude
```

You are now in a session, scoped to that folder. Type in plain English.

Try this:

```
Read CLAUDE.md and ARCHITECTURE.md and tell me what state this project is in.
```

It will read both files and summarise. That is the loop: it reads, you steer.

## The five commands to learn first

Type `/` in a session to see everything available. These five carry most of the value:

| Command | What it does | When to use it |
|---|---|---|
| `/plan` | read-only mode — analyses and proposes, cannot write | before any change touching more than one file |
| `/diff` | shows the file changes made so far | before every commit |
| `/context` | shows what is filling the context window | when answers start getting vague |
| `/compact` | summarises the conversation to free space | when `/context` looks full |
| `/cost` | token spend this session | regularly — the owner watches this |

Also useful once you are comfortable: `/memory` edits `CLAUDE.md`, `/rewind` rolls back to a
checkpoint, `/clear` wipes the conversation while staying in the folder.

## Keyboard

- `Shift+Tab` cycles Normal → Plan → Auto-accept
- `Esc` interrupts a running response
- Double-tap `Esc` opens the rewind menu

## Launch flags

```bash
claude                          # start a session here
claude -c                       # continue the last session
claude --permission-mode plan   # start read-only
claude "run the test suite"     # one-shot task, then exit
```

## Two habits that decide whether this goes well

**Plan before you build.** For anything non-trivial, `/plan` first, read what it proposes,
correct it, then approve. Letting it write first and reviewing afterwards is how these
projects drift.

**Never use auto-accept on this project.** Food quantities, allergy warnings and prices are
not a place for unreviewed edits. `CLAUDE.md` tells it to stay in scope; `/diff` before each
commit tells you whether it listened.

---

# Part 3 — How the documents are used

## During the build

Follow `REPO_SETUP_GUIDE.md` phase by phase. Each phase contains the prompt to paste into
Claude Code. They are written to be pasted as-is.

Claude Code reads `CLAUDE.md` at the start of every session automatically, so you do not need
to re-explain the rules. If it does something the contract forbids, that is worth telling us —
it usually means the rule is ambiguous rather than that the agent ignored it.

Update `ARCHITECTURE.md` as you go. Not at the end of a phase — at the time. A useful prompt:

```
Update ARCHITECTURE.md to reflect what we just built. Modules, status, and any
decision a future session would otherwise re-litigate.
```

Before running `/compact` in a long session, do that first. The conversation is disposable;
the architecture file is what the next session reads instead.

## After the build

The daily loop is in Part 4 of the setup guide. Short version:

```bash
git pull
npm run test:copperpot     # green before you start
claude
```

Fix understood failures only. Never edit an expected test value to make a test pass. Add a
regression test for every confirmed bug. `/diff`, then commit.

---

# Part 4 — Ground rules, in one place

The full set is in `CLAUDE.md`. These four cause the most trouble if forgotten:

**No hardcoded data.** The app ships empty. Every recipe, ingredient, price and job is entered
by the owner or imported from his own backup. Test fixtures live in `tests/fixtures/` and are
imported by test files only. A fixture appearing under `src/` is a bug.

**The engine stays pure.** Nothing under `src/engine` imports React, Supabase, or anything
else. It must run under plain Node — that is what makes the regression pack executable, and
it is the entire reason this repo exists rather than the prototype.

**Code calculates, AI explains.** No model ever produces a quantity, cost or total. A typed
function calculates; the model phrases the result.

**Nothing is invented.** A missing price is null, not zero. A missing guest count is null, not
a guess. "A few vegetarians" is stored as written and blocks exact purchase quantities until
resolved.

---

# Part 5 — Where to go next

1. Install everything in Part 1
2. Run one throwaway Claude Code session (Part 2) so the tool is not new when the work starts
3. Open `REPO_SETUP_GUIDE.md` and start at Phase 0
4. Before Phase 2, get the owner's answers to the four questions in Part 5 of that guide —
   two of them affect money, and building around a guess there means rewriting the costing
   layer later

## Commands, once the repo exists

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
