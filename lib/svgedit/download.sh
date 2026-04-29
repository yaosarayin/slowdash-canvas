#!/usr/bin/env bash
# download.sh — fetches the SVG-Edit standalone release into this directory.
# Usage:  bash download.sh
set -e

VERSION="7.3.2"
URL="https://github.com/SVG-Edit/svgedit/releases/download/v${VERSION}/svgedit-${VERSION}.zip"
ZIP="svgedit-${VERSION}.zip"

echo "Downloading SVG-Edit ${VERSION}..."
curl -L -o "$ZIP" "$URL"

echo "Extracting..."
unzip -q "$ZIP"
mv "svgedit-${VERSION}" editor 2>/dev/null || true

rm -f "$ZIP"
echo "Done. SVG-Edit is at: lib/svgedit/editor/index.html"
