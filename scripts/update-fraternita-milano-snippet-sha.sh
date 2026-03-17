#!/bin/sh
set -eu

ROOT_DIR="$(git rev-parse --show-toplevel)"

exec "$ROOT_DIR/scripts/update-fraternita-milano-version.sh"
