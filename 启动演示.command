#!/bin/zsh
cd "$(dirname "$0")" || exit 1
TASK_NODE_DIR="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if ! command -v node >/dev/null 2>&1 && [ -x "$TASK_NODE_DIR/node" ]; then
  export PATH="$TASK_NODE_DIR:$PATH"
fi
node --env-file=.env scripts/start-demo.mjs
