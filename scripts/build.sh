#!/bin/sh
# Packages extension/ into dist/luma-all-events-<version>.zip. The zip holds a
# single luma-all-events/ folder, which is what users pick in "Load unpacked".
set -e
cd "$(dirname "$0")/.."
version=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
rm -rf dist && mkdir -p dist/luma-all-events
cp -R extension/. dist/luma-all-events/
find dist/luma-all-events -name .DS_Store -delete
(cd dist && zip -qr "luma-all-events-$version.zip" luma-all-events)
rm -rf dist/luma-all-events
echo "dist/luma-all-events-$version.zip"
