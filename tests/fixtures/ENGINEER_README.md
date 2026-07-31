# Copper Pot Kitchen Golden Regression Dataset v3

## Current project stage

**The Copper Pot Kitchen MVP is already built.**

This pack is for **validation, hardening, bug-fixing and regression testing**. Do not treat it as a greenfield build brief and do not rebuild working parts of the MVP unless a verified test failure shows that a change is necessary.

The owner does not have time to manually test every feature. The engineering team should use Claude Code to do as much of the repetitive testing, comparison, bug isolation and regression rerunning as possible.

## Objective

Use real historical Copper Pot Kitchen operations as the benchmark for deciding whether the MVP is correct and trustworthy.

The app is not considered correct because a screen looks plausible. It is correct when historical inputs reliably reproduce the expected operational outputs and key workflows behave properly end-to-end.

## Two-engineer split

### Engineer 1 — Data, calculations and business-rule validation

Own:
- historical fixture ingestion;
- recipe scaling;
- tray/batch rounding;
- units and pack rounding;
- menu allocation;
- dietary splits;
- allergy warnings and blocking behavior;
- pricing and revenue calculations;
- ingredient consolidation;
- shopping/prep calculations;
- weekend totals;
- Ask Sous factual grounding against structured data;
- automated regression results for calculation/business logic.

Engineer 1 is the source-of-truth owner for deterministic operational calculations.

### Engineer 2 — Workflow, UI and end-to-end validation

Own:
- job creation and editing;
- menu changes;
- guest-count changes;
- dates, times and locations;
- dietary updates;
- recalculation after edits;
- prep workflow;
- shopping workflow;
- job status behavior;
- mobile/responsive usability;
- end-to-end replay of historical scenarios;
- verifying that fixes do not break surrounding workflows.

Engineer 2 should consume the same calculation/business-rule layer rather than recreating logic in UI code.

## Claude Code role

Claude Code should do most of the repetitive engineering work:
- inspect existing implementation;
- map fixture fields to the MVP data model;
- create or improve automated tests;
- run historical scenarios;
- compare expected vs actual outputs;
- isolate likely causes of mismatches;
- propose minimal fixes;
- implement approved/obvious low-risk fixes;
- rerun the full suite after each meaningful change;
- add a permanent regression test for every confirmed bug.

Do not use Claude Code to redesign or rewrite the application merely because a different implementation is possible.

## Required engineering workflow

1. Inspect the existing MVP and identify its domain/calculation layer and current test setup.
2. Load `fixtures.json` and `expected_results.json` without discarding provenance/confidence metadata.
3. Seed/use records marked `confirmed`.
4. Treat `derived` expected values as mathematical ground truth only where the underlying business rule is confirmed.
5. Treat `historical_output` as a regression benchmark, but investigate if it conflicts with confirmed rules.
6. Never convert `uncertain` values into hard pass/fail expectations.
7. Split testing between the two engineers as defined above and avoid duplicate manual work.
8. Automate repeatable checks wherever possible.
9. When a failure is confirmed, fix the smallest responsible layer rather than patching the displayed output.
10. Add regression coverage for each confirmed bug.
11. Run the full Copper Pot suite after each material fix.
12. Do not release/merge calculation or workflow changes while known high-confidence regression failures remain unresolved.

## Failure handling

When a test fails:
1. capture exact input;
2. capture expected output;
3. capture actual output;
4. identify whether the failure is code, fixture, data mapping or unresolved business rule;
5. inspect provenance;
6. fix only when the cause is understood;
7. rerun the failed case;
8. rerun the full suite;
9. preserve the case as a permanent regression test.

Do **not** change an expected result just to make a test pass.

## Core principle

**AI explains. Code calculates. Historical operations verify.**

## Owner burden

The owner should only be asked for:
- missing business rules that materially affect food quantity, pricing, allergies or service;
- true contradictions in historical source data;
- operational decisions that cannot be inferred safely.

Do not ask the owner to manually check arithmetic, replay routine scenarios, or perform repetitive software testing that can be automated by Claude Code and the engineering team.

## Definition of done for this testing phase

The MVP is ready to progress when:
- high-confidence golden scenarios pass;
- critical dietary/allergy behavior passes;
- pricing and recipe calculations pass;
- historical edit/recalculation scenarios pass;
- major end-to-end workflows work on desktop and mobile;
- known confirmed bugs have regression tests;
- the full suite can be run with one repeatable command;
- outstanding uncertainty is clearly documented rather than silently assumed.
