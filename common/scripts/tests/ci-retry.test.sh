#!/usr/bin/env bash
# Run without network or real delays; exercise retries and final failure propagation.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd)
retry=${RETRY_SCRIPT:-$repo/common/scripts/ci-retry.sh}
fixture=$(mktemp -d "${TMPDIR:-.}/ci-retry-test.XXXXXX")
trap 'python3 -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "$fixture"' EXIT
export RETRY_FIXTURE="$fixture"
mkdir "$fixture/bin"
cat > "$fixture/bin/sleep" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$1" >> "$RETRY_FIXTURE/delays"
SH
cat > "$fixture/bin/download" <<'SH'
#!/usr/bin/env bash
count=0
if [ -f "$RETRY_FIXTURE/count" ]; then read -r count < "$RETRY_FIXTURE/count"; fi
count=$((count + 1))
printf '%s\n' "$count" > "$RETRY_FIXTURE/count"
[ "$1" = 'argument with spaces' ] || exit 90
[ "$count" -gt "$FAILURES" ] || exit "$FAILURE_CODE"
SH
chmod +x "$fixture/bin/sleep" "$fixture/bin/download"
export PATH="$fixture/bin:$PATH"
for scenario in success transient exhausted timeout; do
  printf '0\n' > "$fixture/count"
  : > "$fixture/delays"
  case "$scenario" in
    success) export FAILURES=0 FAILURE_CODE=42; expected=0; calls=1; delays='' ;;
    transient) export FAILURES=2 FAILURE_CODE=42; expected=0; calls=3; delays=$'10\n20' ;;
    exhausted) export FAILURES=3 FAILURE_CODE=42; expected=42; calls=3; delays=$'10\n20' ;;
    timeout) export FAILURES=3 FAILURE_CODE=124; expected=124; calls=3; delays=$'10\n20' ;;
  esac
  actual=0
  bash "$retry" download 'argument with spaces' || actual=$?
  [ "$actual" -eq "$expected" ]
  [ "$(cat "$fixture/count")" -eq "$calls" ]
  [ "$(cat "$fixture/delays")" = "$delays" ]
  echo "PASS $scenario: exit=$actual attempts=$calls"
done
