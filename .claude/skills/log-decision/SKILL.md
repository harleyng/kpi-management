---
name: log-decision
description: Capture a design, business or technical decision in the Syntra KPI knowledge base — a terse entry in decisions-log.md PLUS an update to the rule file it affects. Use PROACTIVELY at the end of any task that introduces a pattern, fixes a non-obvious bug, or changes a rule. Trigger phrases: "we decided", "from now on", "going forward", "changed the rule".
---

# /log-decision — record a decision in two places

A decision recorded in only one place is half-recorded. Always do **both** steps.

## 1. The log entry — `.agents/knowledge/decisions-log.md`

Newest first, directly under the header. Keep it terse; four short sections:

```markdown
## YYYY-MM-DD — [The decision, stated as a sentence]

**Decision.** [What is now true, concretely enough to act on.]

**Why.** [The reasoning — especially what goes wrong under the alternative. This is the part nobody
remembers three weeks later, and the reason this file exists.]

**Consequence.** [Optional: what follows from it in practice.]

**Updated alongside.** [Which rule file and section you updated in step 2.]
```

Write the *why* as a concrete failure, not an abstraction. "A plan at 99.99% from rounding could never
be submitted" beats "for consistency".

## 2. The rule file — this is the authoritative one

The log is **history**; the rule file is **current truth**. Agents read the rule files, not the log, so
a rule that lives only in the log is effectively lost.

Pick the file the decision actually affects:

| The decision changed | Update |
|---|---|
| A business rule, a calculation, a state set, an error, an assumption (Qn) | `.agents/knowledge/business-rules.md` |
| Layering, the data layer, the contract, fixtures, the route table, an ERD deviation | `.agents/knowledge/architecture.md` |
| Colours, typography, status tones, table patterns | `.agents/knowledge/design-system.md` |
| A trap that bit someone | `.agents/knowledge/common-pitfalls.md` |
| A new reusable component or hook | `.agents/knowledge/component-registry.md` |

If the decision changed a **process**, also update `docs/flows/new-flow.md` — see the **`/update-flow`**
skill, which does the whole sweep.

## 3. Check

- Does the rule file now describe the new truth **without** needing the log entry to make sense?
- Is the log entry dated, and placed at the top?
- If `CLAUDE.md` changed too: `npm run guides:check`.
