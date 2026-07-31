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

## 2. Nothing else is pending

The other five `deterministic_tests` — `CALC-CURRY-10`, `CALC-LASAGNE-29`,
`CALC-NUCELLA-BBQ-SPLIT`, `WARN-SEVERE-MUSHROOM-ALLERGY`, `FIN-REVENUE-WEEKEND-17-19` — have
no known rule conflict and should be wired as ordinary assertions.

Note on `CALC-NUCELLA-BBQ-SPLIT`: it expects `meat_eaters: 22`, and the historical job carries
`guest_split.meat_eaters: 22` explicitly at `confidence: "confirmed"`. Feed that through
`jobs.meat_eating_guests`, which `meatEatingGuests()` in `src/engine/rules.ts` returns
unchanged. Do **not** let the test derive 22 as `27 − (4 + 1)` — that is the summing Rule 16
forbids, and the reason the explicit field exists.

---

## 3. Still open with the owner, not blocking a specific assertion

- **Tranquillity BBQ rate.** History says €20pp; the rate card has no entry.
  `HIST-2026-07-18-TRANQUILLITY-BBQ` is `confidence: "historical_output"` with the note "rate
  may reflect booking-specific pricing", so revenue for it should stay unpriced rather than be
  back-derived.
- **Fixture count.** `expected_results.json` holds 6 `deterministic_tests` and 4
  `system_behavior_tests`. BUILD_GUIDE Stage C refers to "the 33 tests". Reconcile before
  treating the pack as complete.
