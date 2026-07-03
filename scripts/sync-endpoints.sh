#!/usr/bin/env bash
# Sync the shared endpoint manifest from this repo (the canonical source) to the
# sibling CrispLib and citer repos. Edit src/modules/librarySearch/endpoints.json,
# then run this so an endpoint fix lands once for all three projects.
#
#   scripts/sync-endpoints.sh          # copy canonical -> siblings
#   scripts/sync-endpoints.sh --check  # verify all three are identical (CI/pre-commit)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
canonical="$here/src/modules/librarySearch/endpoints.json"
targets=("$here/../CrispLib/endpoints.json" "$here/../citer/endpoints.json")

if [[ "${1:-}" == "--check" ]]; then
  rc=0
  for t in "${targets[@]}"; do
    if [[ ! -f "$t" ]]; then echo "MISSING: $t"; rc=1; continue; fi
    if ! diff -q "$canonical" "$t" >/dev/null; then echo "DRIFT: $t differs from canonical"; rc=1; fi
  done
  [[ $rc -eq 0 ]] && echo "endpoints.json in sync across all repos."
  exit $rc
fi

for t in "${targets[@]}"; do
  if [[ -d "$(dirname "$t")" ]]; then cp "$canonical" "$t"; echo "synced -> $t"; else echo "skip (no repo): $t"; fi
done
