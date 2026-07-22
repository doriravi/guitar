#!/usr/bin/env bash
# PreToolUse(Bash) guard: if a `git commit` stages a JPA entity change but no
# DDL/SQL migration script, ask before committing so schema changes always ship
# a non-destructive migration (existing data must never be harmed).
# Emits an "ask" permission decision (with the offending files) or nothing.
# No jq dependency — JSON is built with shell string escaping.
set -euo pipefail

staged="$(git diff --cached --name-only 2>/dev/null || true)"

entities="$(printf '%s\n' "$staged" | grep -E 'api/entity/.*\.java$' || true)"
sql="$(printf '%s\n' "$staged" | grep -E '\.sql$' || true)"

if [ -n "$entities" ] && [ -z "$sql" ]; then
  # Escape backslashes and quotes, then fold real newlines into literal \n.
  esc="$(printf '%s' "$entities" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | sed ':a;N;$!ba;s/\n/\\n/g')"

  reason="JPA entity change staged with no DDL/SQL migration script:\\n${esc}\\n\\nIf this alters the schema, add a non-destructive migration (ADD COLUMN / CREATE TABLE / backfill — not DROP/recreate) under server/src/main/resources/db/migration/ and stage it, so existing data is never harmed. If the change does not touch the schema, approve to continue."

  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$reason"
fi
