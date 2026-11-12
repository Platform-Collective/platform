#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd)
pull=${PULL_SCRIPT:-$repo/common/scripts/ci-pull-images.sh}
fixture=$(mktemp -d "${TMPDIR:-.}/ci-images-test.XXXXXX")
trap 'python3 -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "$fixture"' EXIT
export IMAGE_FIXTURE="$fixture" RUNNER_TEMP="$fixture" GITHUB_ENV="$fixture/env"
mkdir "$fixture/bin"
cat > "$fixture/bin/docker" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$IMAGE_FIXTURE/calls"
case "$1 $2" in
  'compose -f')
    [ "$SCENARIO" != config-failure ] || exit 17
    [ "$SCENARIO" != empty ] || exit 0
    printf 'postgres:18.1\npgsty/silo\nregistry.example/service:latest\n' ;;
  'image inspect') [ "$SCENARIO" = hit ] ;;
  'pull postgres:18.1') [ "$SCENARIO" != pull-failure ] || exit 42 ;;
  'save --output') [ "$SCENARIO" != save-failure ] || exit 43 ;;
esac
SH
cat > "$fixture/bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$fixture/bin/docker" "$fixture/bin/sleep"
export PATH="$fixture/bin:$PATH"
for scenario in miss hit config-failure empty pull-failure save-failure; do
  export SCENARIO=$scenario
  : > "$GITHUB_ENV"; : > "$fixture/calls"
  cache_hit=false
  [ "$scenario" != hit ] || cache_hit=true
  export SERVICES="postgres minio" CACHE_HIT=$cache_hit
  actual=0
  bash "$pull" tests 'postgres minio' "$cache_hit" || actual=$?
  case "$scenario" in
    miss|hit)
      [ "$actual" -eq 0 ]
      [ "$(cat "$GITHUB_ENV")" = CI_TEST_PULL_POLICY=never ]
      grep -qx 'pull pgsty/silo' "$fixture/calls"
      grep -qx 'pull registry.example/service:latest' "$fixture/calls"
      if [ "$scenario" = hit ]; then
        ! grep -q '^pull postgres:' "$fixture/calls"
        ! grep -q '^save ' "$fixture/calls"
      else
        grep -qx 'pull postgres:18.1' "$fixture/calls"
      fi ;;
    *) [ "$actual" -ne 0 ]; [ ! -s "$GITHUB_ENV" ] ;;
  esac
  echo "PASS images $scenario: exit=$actual"
done
