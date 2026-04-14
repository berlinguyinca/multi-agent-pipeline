#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run build
chmod +x dist/cli.js

echo "Built MAP CLI: $ROOT_DIR/dist/cli.js"
echo "Try: ./dist/cli.js --help"
