# Pending owner — assertions C6 must NOT wire as expected values

Read this before wiring the golden pack in C6.

Every `deterministic_test` in `tests/fixtures/expected_results.json` becomes an executable
case **except** the ones listed here. These have a known conflict with a confirmed business
rule, and the owner has not yet said which side is right.

`CLAUDE.md` §5: **never change an expected test value to make a test pass.** So these are not
edited and not quietly dropped — they are wired as explicit skips that name the reason, so the
suite stays green without pretending the question is settled. `PROVENANCE_RULES.md` says an
`uncertain` value stays unresolved "unless a later confirmed update resolves it"; that is
precisely what is in dispute below.

---

## 1. `CALC-SWEETPEA-BREAKFAST` — the orange juice assertion only

**Wire the rest of this test normally.** Only the orange juice line is pending.

| | |
|---|---|
| Fixture expects | `continental.orange_juice_ml_range: [600, 800]` |
| Source rule | `fixtures.json` → `business_rules.recipes["Continental Breakfast"].per_portion.orange_juice_ml_range: [150, 200]`, marked `confidence: "confirmed"` |
| Conflicting rule | `CLAUDE.md` Rule 13 — orange juice is a fixed 200 ml per person. There is no range |
| If Rule 13 holds | 4 continental guests × 200 ml = **800 ml**, a single number, not a range |

The engine cannot produce `[600, 800]` at all: `types.ts` has no range type, by design. A
recipe line carries one `qty`. So this assertion is not merely wrong-valued, it is
unrepresentable — which is the strongest possible signal that one of the two sources is stale.

**Most likely resolution:** the fixture predates Rule 13. `fixtures.json` self-identifies as
`"Copper Pot Kitchen Golden Regression Dataset v2"` in `metadata.name`, while
`ENGINEER_README.md` describes the pack as v3 — worth confirming with Paul at the same time.

**Needed from the owner:** confirm the 150–200 ml range is superseded by the flat 200 ml. Then
update the fixture (not the engine), delete this entry, and let the assertion run.

### How to wire it

```ts
it.skip('CALC-SWEETPEA-BREAKFAST orange juice — pending owner, see PENDING_OWNER.md', () => {
  // Fixture says [600, 800]; Rule 13 says a flat 800.
  // Do not edit either until Paul confirms which is current.
});
```

Do **not** use `it.todo` — a skip with the reason in the title keeps it visible in every run.

---

## 2. `FIN-REVENUE-WEEKEND-17-19` — blocked on the Tranquillity BBQ rate

| | |
|---|---|
| Fixture expects | `expected_revenue_eur: 2068` across eight named jobs |
| The problem | `HIST-2026-07-18-TRANQUILLITY-BBQ` has **no rate**. 16 guests, €320, `confidence: "historical_output"`, note: "rate may reflect booking-specific pricing" |
| Conflicting rule | `CLAUDE.md` Rule 11 — a job with no applicable rate and no manual figure has revenue **null**, not 0, and "never present a partial sum as a total" |

The €2068 sums exactly from the eight job revenues, and the other seven all resolve cleanly
from the rate card. Only this one does not: the rate card has no (Tranquillity, BBQ) entry,
which is the **single remaining open owner decision** in `ARCHITECTURE.md`.

Under a correct implementation that job's revenue is null, so the weekend total cannot be
computed at all. Not €1748 — null. Rule 11 forbids reporting the sum of seven as a total of
eight.

**Two ways out, both Paul's:**

1. He confirms the Tranquillity BBQ rate. History suggests €20pp, and 16 × €20 = €320, which
   fits. Then it is an ordinary rate-card lookup and this entry goes away.
2. That job is recorded with a **manual override** of €320. This is the better fit — "rate may
   reflect booking-specific pricing" is a description of an override, and it needs no rate-card
   change. `jobRevenue` already returns the typed figure as the total and keeps the computed
   figure visible alongside it, per Rule 11.

Option 2 is the recommendation. **Neither has been applied**, and no fixture is edited.

### How to wire it

```ts
it.skip('FIN-REVENUE-WEEKEND-17-19 — pending owner, see PENDING_OWNER.md', () => {
  // Blocked on the Tranquillity BBQ rate. Under Rule 11 the weekend total is
  // null, not 2068, because one of the eight jobs has no applicable rate.
  // Do NOT invent a rate to make this pass.
});
```

The warning matters more than usual here: adding a €20pp Tranquillity BBQ rate to a test
fixture would make this go green while inventing owner data, which is a Rule 1 breach dressed
up as a passing test.

---

## 3. Nothing else is pending

The other four `deterministic_tests` — `CALC-CURRY-10`, `CALC-LASAGNE-29`,
`CALC-NUCELLA-BBQ-SPLIT`, `WARN-SEVERE-MUSHROOM-ALLERGY` — have no known rule conflict and
should be wired as ordinary assertions.

Note on `CALC-NUCELLA-BBQ-SPLIT`: it expects `meat_eaters: 22`, and the historical job carries
`guest_split.meat_eaters: 22` explicitly at `confidence: "confirmed"`. Feed that through
`jobs.meat_eating_guests`, which `meatEatingGuests()` in `src/engine/rules.ts` returns
unchanged. Do **not** let the test derive 22 as `27 − (4 + 1)` — that is the summing Rule 16
forbids, and the reason the explicit field exists.

---

## 4. `WEEKEND-2026-07-13-22` — not wired, same blocker

The €4748 ten-day benchmark spans 13–22 July, so it contains the same unpriceable
`HIST-2026-07-18-TRANQUILLITY-BBQ`. Its own note already warns it is valid "only when the same
full set of included jobs is loaded".

It is **not wired** at all — it is a `weekend_benchmark`, not a `deterministic_test`, so it was
never in scope, and it would be blocked by §2 even if it were. It becomes wireable at the same
moment §2 is resolved.

---

## 5. Still open with the owner, not blocking a specific assertion

- **The "33 tests" figure.** BUILD_GUIDE Stage C is titled "the engine and the 33 tests". No
  count in this pack is 33: there are 6 `deterministic_tests`, 4 `system_behavior_tests`, 39
  leaf assertions across the deterministic six, and 30 fixture entities in total. The dataset
  calls itself v2 in `metadata.name` while `ENGINEER_README.md` calls the pack v3. The likely
  explanation is that 33 describes an earlier or larger pack than the one delivered. **Not
  reconciled by inventing cases.**
- **Fixture count.** `expected_results.json` holds 6 `deterministic_tests` and 4
  `system_behavior_tests`. BUILD_GUIDE Stage C refers to "the 33 tests". Reconcile before
  treating the pack as complete.
