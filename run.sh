#!/usr/bin/env bash
# Convenience wrapper: loads BASE and SA from .env, fetches a fresh token, runs tokempic.
#
# Usage:
#   ./run.sh <patient-id> [out-file] [extra tokempic flags...]
#
# Defaults out-file to <patient-id>-summary.md. Any extra flags are forwarded to
# tokempic (e.g. --max-age 1h, --refresh, --no-cache). Requires a .env alongside
# this script defining SA (gcloud service account) and BASE (FHIR server URL).
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$dir/.env" ]]; then
  echo "error: $dir/.env not found (expected SA= and BASE=)" >&2
  exit 1
fi
set -a; source "$dir/.env"; set +a

patient="${1:-}"
if [[ -z "$patient" ]]; then
  echo "usage: ./run.sh <patient-id> [out-file] [extra tokempic flags...]" >&2
  exit 1
fi
shift

# Optional second positional is the output file, unless it looks like a flag.
out="${patient}-summary.md"
if [[ "${1:-}" != "" && "${1:-}" != -* ]]; then
  out="$1"
  shift
fi

exec "$dir/tokempic" \
  --patient "$patient" \
  --server "$BASE" \
  --token "$(gcloud auth print-access-token --account="$SA")" \
  --out "$out" \
  "$@"
