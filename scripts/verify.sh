#!/usr/bin/env bash
#
# Every local gate, with each result stated.
#
# WHY THIS EXISTS
#
# The ask-sous syntax error reached a deploy attempt even though `npm run lint`
# caught it perfectly — exit 1, naming the file, line and column, in the same
# words the deploy later used. It was missed because it was checked like this:
#
#     npm run lint >/dev/null 2>&1 && echo "lint ok"
#
# When lint failed, the `&&` short-circuited and the command printed NOTHING. An
# absent success message reads like a quiet pass, and a single error line among
# forty pre-existing warnings is easy to scroll past.
#
# So this script never hides output behind a success message. Each gate prints
# PASS or FAIL with its exit code, and the run fails loudly at the end.
#
# NOTE ON COVERAGE. oxlint scans the whole repo except dist/ and node_modules/,
# so supabase/functions/ IS linted — parse-image will be covered the same way,
# with no change needed. `tsc` does NOT see the functions (its projects include
# only src, tests and vite.config) and cannot: they use Deno globals and remote
# https imports. Catching parse errors there is oxlint's job, and it does it.

set -uo pipefail

failed=0

run() {
  label="$1"
  shift
  out=$("$@" 2>&1)
  code=$?

  if [ "$code" -eq 0 ]; then
    printf '  PASS  %s\n' "$label"
  else
    printf '  FAIL  %s (exit %d)\n' "$label" "$code"
    # Errors only. The pre-existing warnings are noise here, and drowning the
    # signal in them is precisely what this script exists to stop.
    printf '%s\n' "$out" | grep -iE '\berror\b' | head -20 | sed 's/^/        /'
    failed=1
  fi
}

echo "Copper Pot — local gates"
run "typecheck   (src, tests, vite.config)" npm run typecheck
run "lint        (whole repo, incl. supabase/functions)" npm run lint
run "unit        (engine, data, ui, sous)" npm run test
run "golden pack (the contract with the owner)" npm run test:copperpot

echo
if [ "$failed" -eq 0 ]; then
  echo "All gates passed."
else
  echo "SOMETHING FAILED — see above. Do not deploy."
  exit 1
fi
