#!/bin/bash
# check-kpi-safety.sh
# PostToolUse hook for Write|Edit. When the data layer (src/integrations/data/), a React Query
# hook (src/hooks/queries/), a rules file or a store (src/lib/*Rules.ts, src/lib/*Store.ts) is
# written, inject a self-review checklist as advisory context.
#
# Why PostToolUse: only PostToolUse supports a non-blocking
# `hookSpecificOutput.additionalContext` that reaches the model. The write has already
# happened; this prompts a self-check rather than blocking it.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip test files.
case "$FILE_PATH" in
  *.test.*) exit 0 ;;
esac

# Fire for the data layer, the query hooks, rules and stores.
if ! echo "$FILE_PATH" | grep -qE 'src/integrations/data/|src/hooks/queries/|src/lib/.*(Rules|Store)\.ts$'; then
  exit 0
fi

# Pipe the literal checklist into `jq -Rs` so jq handles the JSON encoding.
cat <<'ADVISORY' | jq -Rs '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:.}}'
[SYNTRA KPI SELF-REVIEW — data layer, query hooks, rules and stores]
1. TENANT: every DataGateway method takes `tenantId` and filters by it — no read or write may cross tenants. Every new read has a tenant-isolation test (tenant B sees nothing of tenant A). Query keys START with tenantId.
2. GATEWAY ONLY: data is reached through getDataGateway(), and only from src/hooks/queries/*. No component, page or hook imports mockGateway or supabaseGateway.
3. CALCULATIONS: achievement %, weighted score, roll-up, rating, payout %, "chưa giao", canSubmit — ONLY in src/lib/*Rules.ts as pure functions WITH a co-located test. Never in JSX, a hook or the mock (the mock reuses the rules, never copies them). A missing actual is null, never 0. Weights compare with a tolerance, never === 100. Open questions use the plan's default, flagged `ASSUMPTION Qn`.
4. STATES: statuses come from the fixed sets in src/data/types.ts. Never invent a label.
5. ERRORS: copy comes from src/lib/errorCatalog.ts (ERR-KPI-xx) — never retype a string. Throw KpiError, never resolve an empty list to hide a failure.
6. VISIBLE FAILURE: a failed read shows ErrorStateCard (not an empty table); a failed write shows a toast with the catalogue copy; mutations invalidateQueries on success.
7. FIXTURES: after Gate 1, src/data/fixtures/ and the DataGateway contract are the contract between tracks — changing them is a Large change (system-architect, tell the other tracks).
Then phase 4: `npm run typecheck && npm run test && npm run build && npm run lint` must ALL pass.
ADVISORY
exit 0
