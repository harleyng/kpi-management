#!/bin/bash
# inject-workflow-context.sh
# UserPromptSubmit hook for Syntra KPI.
#  - Injects the four-phase workflow reminder ONLY for coding prompts. Questions, discussions
#    and reviews get nothing — the rule already lives in CLAUDE.md, so re-injecting it every
#    turn would be pure context noise.
#  - Nudges the right skill (/new-page, /add-entity, /add-calc-method, /add-workflow,
#    /add-import-template, /update-flow, /log-decision) when the scenario matches.
#  - Emits JSON only when something matched; silent on pure questions.

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

CONTEXT=""

# ── Intent detection: does this look like a coding request? ──
CODING_INTENT=false
if echo "$PROMPT" | grep -qiE '\b(add|create|implement|build|fix|bug|refactor|change|update|modify|rename|delet(e|ing)|remov(e|ing)|writ(e|ing)|edit|generat(e|ing)|scaffold|wire|integrat(e|ion)|revert|patch|rewrite|install)\b'; then
  CODING_INTENT=true
fi
# Domain nouns that strongly imply implementation work in this project
if echo "$PROMPT" | grep -qiE '\b(component|page|route|screen|sidebar|nav|store|hook|gateway|adapter|fixture|seed|kpi|goal|cascade|align|weight|target|actual|evaluation|form|workflow|approve|cycle|period|tenant|import|rating|payout|dashboard)\b'; then
  CODING_INTENT=true
fi
# Explicit file references
if echo "$PROMPT" | grep -qiE '\.(tsx?|mts|mjs|css|json)\b'; then
  CODING_INTENT=true
fi

# ── Coding prompts: inject the four-phase reminder ──
if [ "$CODING_INTENT" = true ]; then
  CONTEXT="[FOUR-PHASE WORKFLOW — MANDATORY] Before writing ANY code, follow the workflow in CLAUDE.md:
  Phase 1 — ANALYSIS: use cases (main / alternative / edge / error), impact analysis, open questions (plan §9, Q1–Q10). Wait for confirmation.
  Phase 2 — DESIGN: approach, component design, DataGateway contract (tenantId on every method), where the rule lives (src/lib/*Rules.ts), test cases. Wait for approval.
  Phase 3 — IMPLEMENTATION: only after phase 2 is approved; write tests alongside the code.
  Phase 4 — VERIFICATION: npm run typecheck && npm run test && npm run build && npm run lint must ALL pass. Tests ARE a gate on this repo.
  Touching src/lib/*Rules.ts, a calculation method, scoring, rating or payout? That is the KPI Rules lane — hr-performance-expert + qa in phase 2. Touching the form state machine, steps, SLA/overdue, proxy, delegation or launches? That is the Workflow lane — workflow-expert + system-architect. Changing a rule or a process step is Flow/Spec and REQUIRES a documentation update (see /update-flow). Changing fixtures or the gateway contract after Gate 1 is Large. Default to Medium when unsure.
  You MUST NOT Write/Edit source files until phase 1 is confirmed AND phase 2 approved (Medium and above). Ignore this if it is not a coding task. "
fi

# ── Skill nudges ──
SKILL_NUDGE=""
if echo "$PROMPT" | grep -qiE '\b(new page|add (a )?page|screen|view|new route|sidebar|menu|nav( entry)?)\b'; then
  SKILL_NUDGE="${SKILL_NUDGE}/new-page (page under src/pages, lazy <Route> in App.tsx under AppShell, item in the right role group of navConfig.ts, route table in architecture.md, useNavigate not asChild); "
fi
if echo "$PROMPT" | grep -qiE '\b(entity|new table|add (a )?field|column|fixture|seed|gateway|contract|query hook|react query|tenant)\b'; then
  SKILL_NUDGE="${SKILL_NUDGE}/add-entity (type + state set in src/data/types.ts → DataGateway method WITH tenantId → mockGateway → fixture → query hooks with *Key + invalidate → tenant-isolation test); "
fi
if echo "$PROMPT" | grep -qiE '\b(calc(ulation)?|method|ratio|tier(ed)?|binary|formula|levels?|cap|floor|achievement|weight(ed)?|score|roll-?up|rating|payout|percent)\b'; then
  SKILL_NUDGE="${SKILL_NUDGE}/add-calc-method (pure function in src/lib/calcRules.ts or the matching *Rules.ts, edge-case table: actual 0, target 0, cap, floor, level boundaries, null actual; business-rules.md §3; hr-performance-expert reviews); "
fi
if echo "$PROMPT" | grep -qiE '\b(workflow|form type|approv(e|al)|return|step|sla|overdue|deadline|proxy|delegat(e|ion)|launch|lock|unlock)\b'; then
  SKILL_NUDGE="${SKILL_NUDGE}/add-workflow (steps, actor rule, allowed actions, SLA + overdue behaviour, notification events, ONE transition function in src/lib/workflowRules.ts with tests; workflow-expert reviews); "
fi
if echo "$PROMPT" | grep -qiE '\b(import|excel|xlsx|exceljs|template|bulk|batch|upload)\b'; then
  SKILL_NUDGE="${SKILL_NUDGE}/add-import-template (shared 4.4.3 framework: exceljs template → parse → per-row validation in src/lib → preview → confirm by batch, per-row errors); "
fi
if echo "$PROMPT" | grep -qiE '\b(flow|process|journey|business rule|BR-KPI|state set|status)\b'; then
  SKILL_NUDGE="${SKILL_NUDGE}/update-flow (proposal in docs/flows/new-flow.md first, then sweep routes + rules + state sets + fixtures + error copy, then update business-rules.md and log the decision); "
fi
if echo "$PROMPT" | grep -qiE '\b(decid(e|ed)|decision|rationale|from now on|going forward|changed the rule|assumption)\b'; then
  SKILL_NUDGE="${SKILL_NUDGE}/log-decision (terse dated entry in decisions-log.md PLUS an update to the affected current-truth rule file); "
fi
if [ -n "$SKILL_NUDGE" ]; then
  CONTEXT="${CONTEXT}[SKILLS — invoke proactively via the Skill tool; do not wait for the user to type a slash command] This scenario matches: ${SKILL_NUDGE}"
fi

# ── Emit only when there is something to inject ──
if [ -n "$CONTEXT" ]; then
  jq -n --arg ctx "$CONTEXT" '{
    "hookSpecificOutput": {
      "hookEventName": "UserPromptSubmit",
      "additionalContext": $ctx
    }
  }'
fi
exit 0
