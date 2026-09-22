#!/usr/bin/env bash

# Default version if not set
VERSION=${VERSION:-"latest"}

docker push platformcollective/base:${VERSION}
docker push platformcollective/base-slim:${VERSION}
docker push platformcollective/rekoni-base:${VERSION}
docker push platformcollective/print-base:${VERSION}
docker push platformcollective/front-base:${VERSION}
docker push platformcollective/preview-base:${VERSION}
