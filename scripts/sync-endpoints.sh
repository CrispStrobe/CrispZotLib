#!/usr/bin/env bash
# Sync shared cross-repo files from this repo (the canonical source) to the
# sibling repos, so a fix lands once for all projects:
#   - endpoints.json         -> CrispLib + citer  (shared endpoint manifest)
#   - test/fixtures/parity/* -> CrispLib          (formatter parity fixtures +
#     goldens, asserted by test/formatterParity.test.ts here and
#     test_formatter_parity.py there; citer has no BiblioRecord formatters)
#   - parity/parser-records.json -> citer         (SRU parser golden; CrispLib
#     already receives it via the test/fixtures/parity/* glob above. Asserted by
#     test_parser_parity.py / tests/parser_parity_test.py, and the DC cases by
#     test/parserParity.test.ts here.)
#
#   scripts/sync-endpoints.sh          # copy canonical -> siblings
#   scripts/sync-endpoints.sh --check  # verify identical (CI/pre-commit)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"

# "canonical<TAB>target" pairs; targets in missing sibling repos are skipped.
pairs=()
endpoints="$here/src/modules/librarySearch/endpoints.json"
pairs+=("$endpoints	$here/../CrispLib/endpoints.json")
pairs+=("$endpoints	$here/../citer/endpoints.json")
for f in "$here"/test/fixtures/parity/*; do
  pairs+=("$f	$here/../CrispLib/fixtures/parity/$(basename "$f")")
done
# citer parses SRU but has no BiblioRecord formatters, so it only needs the
# parser golden (not records.json/expected.bib/expected.ris).
parser_golden="$here/test/fixtures/parity/parser-records.json"
pairs+=("$parser_golden	$here/../citer/fixtures/parity/parser-records.json")

# The repo a target belongs to: the path component right after $here/../
repo_of() { local rel="${1#"$here/../"}"; printf '%s' "$here/../${rel%%/*}"; }

if [[ "${1:-}" == "--check" ]]; then
  rc=0
  for pair in "${pairs[@]}"; do
    src="${pair%%	*}" t="${pair#*	}"
    if [[ ! -d "$(repo_of "$t")" ]]; then continue; fi
    if [[ ! -f "$t" ]]; then echo "MISSING: $t"; rc=1; continue; fi
    if ! diff -q "$src" "$t" >/dev/null; then echo "DRIFT: $t differs from canonical"; rc=1; fi
  done
  [[ $rc -eq 0 ]] && echo "shared files in sync across all repos."
  exit $rc
fi

for pair in "${pairs[@]}"; do
  src="${pair%%	*}" t="${pair#*	}"
  if [[ -d "$(repo_of "$t")" ]]; then
    mkdir -p "$(dirname "$t")"
    cp "$src" "$t"
    echo "synced -> $t"
  else
    echo "skip (no repo): $t"
  fi
done
