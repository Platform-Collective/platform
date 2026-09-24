#!/bin/bash

# LiveKit development server startup script
# This script starts LiveKit with the development configuration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/livekit-dev-config.yaml"

echo "[LiveKit] Starting LiveKit server in development mode..."
echo "[LiveKit] Config file: $CONFIG_FILE"
echo "[LiveKit] Webhook URL: http://127.0.0.1:8098/webhook"
echo "[LiveKit] Server port: 7880"
echo "[LiveKit] RTC UDP port: 7882"
echo "[LiveKit] RTC TCP port: 7881"
echo "[LiveKit] API keys: devkey, devkey2"
echo ""

if [ ! -f "$CONFIG_FILE" ]; then
    echo "[LiveKit] ERROR: Config file not found: $CONFIG_FILE"
    exit 1
fi

# Check if livekit-server is installed
if ! command -v livekit-server &> /dev/null; then
    echo "[LiveKit] ERROR: livekit-server command not found"
    echo "[LiveKit] Please install LiveKit server: https://docs.livekit.io/home/self-hosting/local/"
    exit 1
fi

# Check if ports are already in use
if lsof -Pi :7880 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[LiveKit] WARNING: Port 7880 is already in use"
    echo "[LiveKit] Attempting to start anyway..."
fi

echo "[LiveKit] Starting server..."
livekit-server --config "$CONFIG_FILE"
