# CLAUDE CODE TASK — VALIDATE AND HARDEN THE EXISTING COPPER POT KITCHEN MVP

You are working on the **already-built Copper Pot Kitchen Operations MVP**.

This is not a greenfield build task. Your primary job is to **test, validate, harden and fix the existing MVP** using the historical Golden Regression Dataset supplied in this pack.

Do not rebuild working features or redesign architecture simply because you would implement them differently. Make changes when evidence from tests, defects or safety/correctness concerns justifies them.

## Goal

Prove that the existing application can take historical Copper Pot Kitchen jobs and reliably reproduce the correct operational outputs while key workflows behave correctly end-to-end.

The owner should not need to manually verify routine calculations or repeat historical scenarios.

## Team split

Support two engineers working in parallel.

### Engineer 1 track — calculation/data validation
Focus on:
- fixture mapping;
- pricing;
- recipes;
- recipe scaling;
- tray/batch rounding;
- units and purchase rounding;
- dietary allocation;
- allergy warnings;
- consolidated ingredients;
- shopping/prep calculations;
- historical totals;
- Ask Sous grounding;
- regression automation for deterministic logic.

### Engineer 2 track — workflow/end-to-end validation
Focus on:
- job creation;
- job edits;
- menu changes;
- guest changes;
- dietary changes;
- date/time/location changes;
- downstream recalculation;
- prep and shopping workflows;
- status changes;
- responsive/mobile behavior;
- end-to-end historical scenario replay;
- regression checks around fixes.

Avoid having both engineers duplicate the same manual test work.

## Instructions

1. Inspect the existing repo before changing code.
2. Identify the current domain/calculation layer, UI layer, persistence layer and test framework.
3. Import/adapt `fixtures.json` into the current test/seed architecture.
4. Convert `expected_results.json` into executable tests where confidence/provenance allows.
5. Preserve provenance/confidence metadata.
6. Keep deterministic calculations outside UI components.
7. Never promote `uncertain` data into exact numeric expectations.
8. For `historical_output`, do not rewrite expected values merely because current code disagrees. Investigate first.
9. When a failure occurs, report exact input, expected output and actual output.
10. Isolate the smallest responsible layer before applying a fix.
11. Prefer minimal, targeted fixes over broad rewrites.
12. Add regression coverage for every confirmed bug.
13. After a fix, rerun the failed test and then the entire Copper Pot suite.
14. Create or preserve a single repeatable command such as:
   `npm run test:copperpot`
   that runs the historical regression suite.
15. Where practical, also create an end-to-end command/suite for workflow replay.
16. Do not hide failures with mocks, hard-coded UI values or altered expected results.

## Minimum calculation/data test groups

- pricing
- recipe scaling
- batch/tray rounding
- breakfast choice splits
- BBQ dietary allocation
- severe allergy warnings
- ingredient consolidation
- stock/purchase calculations where supported
- weekend revenue consolidation
- Ask Sous grounding / no-hallucination behavior

## Minimum workflow test groups

- create historical job
- edit guest count and verify recalculation
- edit menu and verify downstream changes
- add/remove dietary requirement and verify outputs/warnings
- change date/time/location
- prep list updates
- shopping list updates
- job status transitions
- unresolved-input behavior
- mobile/responsive critical flows

## Required reporting after each test cycle

Return:

PASSING
- cases passing

FAILING
- exact expected vs actual
- severity
- likely responsible layer

FIXED THIS CYCLE
- defect
- fix
- regression test added

DATA CONFLICTS
- cases where source history and rules disagree

OWNER DECISIONS
- only genuine business decisions that cannot be resolved from source data

NEXT TEST TARGETS
- highest-risk remaining scenarios

## Safety rule

Food quantity, dietary/allergy, pricing and financial outputs must never be made to look correct using UI-only patches or fabricated values.

## End state

The aim is not to produce more code. The aim is to make the existing MVP demonstrably trustworthy using real Copper Pot Kitchen history, with Claude Code handling as much automated QA and regression work as possible.
