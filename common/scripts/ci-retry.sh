#!/usr/bin/env bash
# Retry downloads only. Keep the final failure status so CI remains fail-closed.
set -uo pipefail
[ "$#" -gt 0 ] || { echo "usage: ci-retry.sh COMMAND [ARG...]" >&2; exit 64; }
for attempt in 1 2 3; do
  if "$@"; then
    exit 0
  else
    status=$?
  fi
  if [ "$attempt" -eq 3 ]; then
    exit "$status"
  fi
  delay=$((attempt * 10))
  echo "Download attempt $attempt failed (exit $status); retrying in ${delay}s" >&2
  sleep "$delay"
done
