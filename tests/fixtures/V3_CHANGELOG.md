# v3 Change Log

Updated testing instructions to reflect the actual project stage:

- MVP is already built.
- Scope is validation, hardening, bug-fixing and regression testing.
- Explicitly instructs engineers not to rebuild working features unnecessarily.
- Defines parallel ownership for two engineers.
- Engineer 1: data, calculations and business rules.
- Engineer 2: workflow, UI and end-to-end testing.
- Claude Code is positioned as the automation/test/fix assistant for the existing MVP.
- Adds failure triage, severity and fix/rerun workflow.
- Adds `TESTING_WORKFLOW.md` for day-to-day execution.
