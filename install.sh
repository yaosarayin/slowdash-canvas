#!/usr/bin/env bash
# install.sh — symlinks slowdash-canvas files into the slowdash site directory.
# Run once after cloning or pulling the submodule.
# Usage:  bash install.sh  (from the slowdash-canvas directory)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SLOWDASH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SITE_DIR="$SLOWDASH_DIR/app/site"

if [ ! -d "$SITE_DIR" ]; then
    echo "ERROR: Cannot find slowdash site directory at: $SITE_DIR"
    echo "Make sure you run this script from within the slowdash repo."
    exit 1
fi

echo "Installing slowdash-canvas into: $SITE_DIR"

# Link the entry-point HTML page
ln -sf "$SCRIPT_DIR/site/slowcanvas.html" "$SITE_DIR/slowcanvas.html"
echo "  Linked slowcanvas.html"

# Link the whole JS/CSS bundle directory
ln -sf "$SCRIPT_DIR/site/slowcanvas" "$SITE_DIR/slowcanvas"
echo "  Linked slowcanvas/ directory"

echo ""
echo "Done. Restart slowdash and navigate to /slowcanvas.html"
echo ""
echo "To expose slowcanvas layouts in the home-page catalog, add 'slowcanvas'"
echo "to the catalog_type list in your SlowdashProject.yaml or slowhome config."
