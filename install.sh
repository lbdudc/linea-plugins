#!/usr/bin/env bash
# Makes the plugins of this folder runnable from a checkout, next to a checkout of lbdudc/linea. Run it once after cloning (and again if
# `linea/node_modules` moves).
#
# Plugin code has no node_modules of its own: the server resolves what the server side of a plugin imports from the `linea` checkout
# (`npm install` at its root), and the client build resolves what its client side imports from `linea/apps/client` (plugin-deps.mjs).
set -euo pipefail
cd "$(dirname "$0")"
[ -d ../linea ] || { echo "error: expected a checkout of https://github.com/lbdudc/linea next to this one (../linea)" >&2; exit 1; }
ln -sfn ../linea/node_modules node_modules
echo "linea-plugins/node_modules -> ../linea/node_modules"
[ -d ../linea/node_modules ] || echo "warning: ../linea has no node_modules yet (cd ../linea && npm install)" >&2
