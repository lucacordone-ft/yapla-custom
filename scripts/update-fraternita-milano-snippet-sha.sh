#!/bin/sh
set -eu

ROOT_DIR="$(git rev-parse --show-toplevel)"
SNIPPET_FILE="$ROOT_DIR/yapla/fraternita-milano-snippet.html"
COMMIT_SHA="$(git rev-parse HEAD)"

perl -0pi -e 's/var ASSET_COMMIT_SHA = "[0-9a-f]{40}";/var ASSET_COMMIT_SHA = "'"$COMMIT_SHA"'";/' "$SNIPPET_FILE"

printf 'Updated %s to commit %s\n' "$SNIPPET_FILE" "$COMMIT_SHA"
