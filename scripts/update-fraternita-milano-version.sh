#!/bin/sh
set -eu

ROOT_DIR="$(git rev-parse --show-toplevel)"
VERSION_FILE="$ROOT_DIR/yapla/fraternita-milano.version.json"
COMMIT_SHA="$(git rev-parse HEAD)"

cat > "$VERSION_FILE" <<EOF
{
  "assetCommitSha": "$COMMIT_SHA"
}
EOF

printf 'Updated %s to asset commit %s\n' "$VERSION_FILE" "$COMMIT_SHA"
