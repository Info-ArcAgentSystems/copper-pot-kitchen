# Provenance and Trust Rules

This dataset is assembled from historical Copper Pot Kitchen operations retained across prior work.

Use confidence labels:

- `confirmed`: safe to use as historical source input.
- `derived`: calculated from confirmed rules.
- `historical_output`: previously reported operational result; useful as a benchmark but investigate if it conflicts with confirmed rules.
- `uncertain`: must remain unresolved unless a later confirmed update resolves it.

## Never guess

Examples:
- 'a few vegetarians' is not 2 or 3.
- a missing breakfast choice is not automatically Full Irish.
- an unknown ingredient quantity is not zero.
- an old Eircode should not remain current after a confirmed correction.

The system should surface unresolved data instead of converting ambiguity into confidence.
