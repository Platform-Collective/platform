#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo/$1"
read -ra services <<< "$2"
cache_hit=$3
image_list=$(docker compose -f docker-compose.yaml config --images "${services[@]}")
test -n "$image_list"
mapfile -t images <<< "$image_list"
for image in "${images[@]}"; do
  # Mutable latest references must be refreshed even after restoring a cache.
  reference=${image##*/}
  if [[ "$reference" != *:* || "$reference" == *:latest ]] || ! docker image inspect "$image" >/dev/null 2>&1; then
    bash "$repo/common/scripts/ci-retry.sh" timeout 5m docker pull "$image"
  fi
done
if [ "$cache_hit" != true ]; then
  docker save --output "$RUNNER_TEMP/test-images.tar" "${images[@]}"
fi
# Prevent duplicate implicit pulls only after every selected image is available.
echo 'CI_TEST_PULL_POLICY=never' >> "$GITHUB_ENV"
