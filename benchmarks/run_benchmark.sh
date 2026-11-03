#!/bin/bash

# Benchmark script for front service: Node-only vs Nginx+Node
# Usage: ./run_benchmark.sh [--build] [--duration 15s] [--connections 100]
#
# --build        Rebuild Docker images before benchmark
# --duration     Test duration per scenario (default: 15s)
# --connections  Concurrent connections (default: 100)

set -e

BENCHMARK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONT_DIR="$BENCHMARK_DIR/../pods/front"
RESULTS_DIR="$BENCHMARK_DIR/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="$RESULTS_DIR/benchmark_${TIMESTAMP}.md"
BENCHMARK_BIN="$BENCHMARK_DIR/front-benchmark/front-benchmark"

BUILD=false
DURATION="15s"
CONNECTIONS=100

NODE_IMAGE="front-bench-node"
NGINX_IMAGE="front-bench-nginx"
NODE_CONTAINER="front-bench-node-run"
NGINX_CONTAINER="front-bench-nginx-run"
NODE_PORT=8091
NGINX_PORT=8092

# Common environment variables (from dev/docker-compose.yaml)
ENV_ARGS=(
  -e SERVER_SECRET=secret
  -e ACCOUNTS_URL=http://huly.local:3000
  -e UPLOAD_URL=/files
  -e "FILES_URL=http://huly.local:4030/blob/:workspace/:blobId/:filename"
  -e MODEL_VERSION=test
  -e REKONI_URL=http://huly.local:4004
  -e GMAIL_URL=http://huly.local:8093
  -e CALENDAR_URL=http://huly.local:8095
  -e TELEGRAM_URL=http://huly.local:8086
  -e "STORAGE_CONFIG=minio|localhost?accessKey=minioadmin&secretKey=minioadmin"
  -e BRANDING_URL=http://huly.local:8087/branding.json
  -e DATALAKE_URL=http://huly.local:4030
  -e LINK_PREVIEW_URL=http://huly.local:4042
)

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --build) BUILD=true; shift ;;
    --duration) DURATION="$2"; shift 2 ;;
    --connections) CONNECTIONS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$RESULTS_DIR"

echo "=== Front Service Benchmark ==="
echo "Timestamp:   $(date)"
echo "Duration:    $DURATION per scenario"
echo "Connections: $CONNECTIONS"
echo "Results:     $RESULTS_FILE"
echo ""

# Build Go benchmark tool (always rebuild to pick up code changes)
echo "Building benchmark tool..."
cd "$BENCHMARK_DIR/front-benchmark"
go build -o front-benchmark main.go

# Build Docker images if requested
if [ "$BUILD" = true ]; then
  echo "Building bundle..."
  cd "$FRONT_DIR"
  rushx bundle

  echo "Building Docker images..."
  docker build --build-arg BUILD_ID=bench-node -t "$NODE_IMAGE" -f Dockerfile . &
  docker build --build-arg BUILD_ID=bench-nginx -t "$NGINX_IMAGE" -f Dockerfile.nginx . &
  wait
  echo "Docker images built."
fi

# Cleanup old containers
docker rm -f "$NODE_CONTAINER" "$NGINX_CONTAINER" 2>/dev/null || true

# Start containers
echo "Starting Node-only container on port $NODE_PORT..."
docker run -d --name "$NODE_CONTAINER" -p "$NODE_PORT:8080" \
  -e SERVER_PORT=8080 "${ENV_ARGS[@]}" "$NODE_IMAGE" >/dev/null

echo "Starting Nginx+Node container on port $NGINX_PORT..."
docker run -d --name "$NGINX_CONTAINER" -p "$NGINX_PORT:8080" \
  -e SERVER_PORT=3000 "${ENV_ARGS[@]}" "$NGINX_IMAGE" >/dev/null

# Wait for containers to be ready
echo "Waiting for containers to start..."
for i in $(seq 1 30); do
  NODE_OK=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$NODE_PORT/config.json" 2>/dev/null || echo "000")
  NGINX_OK=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$NGINX_PORT/config.json" 2>/dev/null || echo "000")
  if [ "$NODE_OK" = "200" ] && [ "$NGINX_OK" = "200" ]; then
    echo "Both containers ready."
    break
  fi
  sleep 1
done

# Extract file list
echo "Extracting file list..."
docker exec "$NODE_CONTAINER" find /app/dist -type f | sed 's|/app/dist/||' > /tmp/bench_files.txt
FILE_COUNT=$(wc -l < /tmp/bench_files.txt | tr -d ' ')
echo "Found $FILE_COUNT files."

# Write results header
cat > "$RESULTS_FILE" << EOF
# Front Service Benchmark Results
**Date:** $(date)
**Duration:** $DURATION per scenario | **Connections:** $CONNECTIONS | **Files:** $FILE_COUNT

---

EOF

# Run a single benchmark scenario
run_scenario() {
  local label="$1"
  local url="$2"
  local container="$3"
  local extra_args="$4"

  echo ""
  echo ">>> $label"
  echo "## $label" >> "$RESULTS_FILE"
  echo '```' >> "$RESULTS_FILE"
  "$BENCHMARK_BIN" -url="$url" -c="$CONNECTIONS" -d="$DURATION" \
    -monitor-memory -container="$container" $extra_args 2>&1 | tee -a "$RESULTS_FILE"
  echo '```' >> "$RESULTS_FILE"
  echo "" >> "$RESULTS_FILE"

  # Cooldown
  sleep 2
}

echo ""
echo "=========================================="
echo " Running benchmarks"
echo "=========================================="

# --- Node-only ---
run_scenario "Node: config.json" \
  "http://localhost:$NODE_PORT/config.json" "$NODE_CONTAINER" "-exact"

run_scenario "Node: index.html (SPA)" \
  "http://localhost:$NODE_PORT/" "$NODE_CONTAINER" "-exact"

run_scenario "Node: random files" \
  "http://localhost:$NODE_PORT" "$NODE_CONTAINER" "-files=/tmp/bench_files.txt"

run_scenario "Node: mixed (files + config.json)" \
  "http://localhost:$NODE_PORT" "$NODE_CONTAINER" \
  "-files=/tmp/bench_files.txt -mixed=/config.json -mixed-conns=10"

# --- Nginx+Node ---
run_scenario "Nginx: config.json" \
  "http://localhost:$NGINX_PORT/config.json" "$NGINX_CONTAINER" "-exact"

run_scenario "Nginx: index.html (SPA)" \
  "http://localhost:$NGINX_PORT/" "$NGINX_CONTAINER" "-exact"

run_scenario "Nginx: random files" \
  "http://localhost:$NGINX_PORT" "$NGINX_CONTAINER" "-files=/tmp/bench_files.txt"

run_scenario "Nginx: mixed (files + config.json)" \
  "http://localhost:$NGINX_PORT" "$NGINX_CONTAINER" \
  "-files=/tmp/bench_files.txt -mixed=/config.json -mixed-conns=10"

# Print summary
echo ""
echo "=========================================="
echo " Benchmark complete!"
echo " Results: $RESULTS_FILE"
echo "=========================================="

# Cleanup containers
echo "Stopping containers..."
docker rm -f "$NODE_CONTAINER" "$NGINX_CONTAINER" 2>/dev/null || true
