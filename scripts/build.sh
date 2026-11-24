#!/bin/sh
# Builds the release artifacts from extension/:
#   dist/luma-all-events-<version>.zip  extension zip holding one luma-all-events/
#                                       folder, which is what users pick in "Load unpacked"
#   luma-all-events.user.js             the same content script as a userscript
set -e
cd "$(dirname "$0")/.."
version=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")

rm -rf dist && mkdir -p dist/luma-all-events
cp -R extension/. dist/luma-all-events/
find dist/luma-all-events -name .DS_Store -delete
(cd dist && zip -qr "luma-all-events-$version.zip" luma-all-events)
rm -rf dist/luma-all-events

{
  cat <<HEADER
// ==UserScript==
// @name         Luma: All Events
// @namespace    luma-all-events
// @version      $version
// @description  Browse every public Luma event in an area, not just the curated city list.
// @match        https://luma.com/*
// @match        https://lu.ma/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
// Generated from extension/content.js by scripts/build.sh.

HEADER
  cat extension/content.js
} > luma-all-events.user.js

echo "dist/luma-all-events-$version.zip"
echo "luma-all-events.user.js"
