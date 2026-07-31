# Copper Pot Kitchen MVP — Parallel Testing Workflow

## Daily loop

1. Pull latest agreed branch.
2. Run the full Copper Pot regression suite before changes.
3. Engineer 1 works data/calculation failures.
4. Engineer 2 works workflow/end-to-end failures.
5. Log each failure with fixture ID, expected, actual, severity and owner.
6. Fix only understood failures.
7. Add a permanent regression test for confirmed bugs.
8. Rerun affected test.
9. Rerun full suite.
10. Merge only when the relevant suite remains green or the remaining issue is explicitly documented.

## Suggested severity

### Critical
- allergy/dietary safety failure
- materially wrong food quantity
- materially wrong pricing/revenue
- data loss/corruption
- app blocks execution of a confirmed job

### High
- incorrect prep/shopping output
- failed recalculation after job edit
- Ask Sous returns confident wrong operational data
- key mobile workflow unusable

### Medium
- workflow friction with workaround
- display/state inconsistency that does not change underlying calculation

### Low
- cosmetic or polish issue

## Shared rule

The two engineers should test different layers in parallel but use the same fixtures, expected results and business-rule source of truth.
