#!/usr/bin/env bash
set -euo pipefail
if git diff --cached --name-only | grep -E '\.(js|ts|mjs|json|md|env)$' >/dev/null; then
  if git diff --cached --text | grep -E "GEMINI_API_KEY|AIza[0-9A-Za-z_-]{35}|sk_[A-Za-z0-9]{32,}"; then
    echo "Potential secret detected in staged changes. Aborting commit." >&2
    exit 1
  fi
fi
exit 0
