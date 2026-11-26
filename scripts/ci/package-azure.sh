#!/usr/bin/env bash
#   bash scripts/ci/package-azure.sh            -> .data/deploy/educenter-app.zip
#   bash scripts/ci/package-azure.sh out.zip    -> out.zip
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ZIP="${1:-$ROOT/.data/deploy/educenter-app.zip}"
case "$ZIP" in /*) ;; *) ZIP="$PWD/$ZIP" ;; esac
STAGE="$ROOT/.data/deploy/azure"

cd "$ROOT"
echo "==> Build shared, web, api"
pnpm --filter @educenter/shared build
pnpm --filter web build
pnpm --filter api build

echo "==> Bộ cài production của API (node_modules phẳng, không symlink)"
rm -rf "$STAGE"
mkdir -p "$STAGE/apps/web"
pnpm --filter api deploy --legacy --prod --config.node-linker=hoisted "$STAGE/apps/api"
rm -rf "$STAGE/apps/api/dist" "$STAGE/apps/api/prisma"
cp -r apps/api/dist "$STAGE/apps/api/dist"
cp -r apps/api/prisma "$STAGE/apps/api/prisma"
cp -r apps/web/dist "$STAGE/apps/web/dist"
rm -rf "$STAGE/apps/api/src" "$STAGE/apps/api/test"

echo "==> Nén zip"
mkdir -p "$(dirname "$ZIP")"
rm -f "$ZIP"
(cd "$STAGE" && zip -qr "$ZIP" .)
echo "OK: $ZIP ($(du -h "$ZIP" | cut -f1))"
