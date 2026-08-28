#!/usr/bin/env bash
# Builds a Chrome Web Store upload zip containing only runtime files.
# Everything else in this repo (tests, fixtures, docs, demo, git) stays out.
set -euo pipefail

OUT="playsense-$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])").zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Runtime files only. Add here if the manifest ever references something new.
cp manifest.json background.js content.js popup.html popup.js styles.css privacy.html "$STAGE/"
mkdir -p "$STAGE/assets" "$STAGE/src"
cp assets/icon16.png assets/icon48.png assets/icon128.png "$STAGE/assets/"
cp -R src/. "$STAGE/src/"

# Guard: nothing that only exists for development may ship.
for bad in test docs demo .git .superpowers package.json test-scraping.html README.md; do
  if [ -e "$STAGE/$bad" ]; then echo "ERROR: $bad leaked into the package" >&2; exit 1; fi
done

rm -f "$OUT"
( cd "$STAGE" && zip -qr - . ) > "$OUT"
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
unzip -Z1 "$OUT" | sed "s|^|  |"
