---
name: add-workflow
description: Add a form type or a workflow template to Syntra KPI — its steps, actor rules, allowed actions, SLA and overdue behaviour, notification events, and state-machine tests in src/lib/workflowRules.ts. Workflow lane — workflow-expert + system-architect review. Trigger phrases: "new form type", "new approval process", "add a step", "change who approves", "SLA", "quá hạn", "ủy quyền", "khởi chạy phiếu".
---

# /add-workflow — add a form type or a process template

This is the **Workflow** lane: `workflow-expert` + `system-architect` review the design in Phase 2. If
the change also alters a screen, promote it to Medium/Large and keep `workflow-expert`.

## 1. Specify it first (write it down before coding)

For the form type (`GOAL_SETTING`, `GOAL_CHANGE`, `KPI_EVAL`, or a new one), a table:

| Step | Actor rule | Allowed actions | SLA (days) | On overdue | Notification |
|---|---|---|---|---|---|
| 1 | `DIRECT_MANAGER` | `EDIT`, `SUBMIT` | 5 | `REMIND` | step started, 2 days before due |
| … | … | … | … | `AUTO_FORWARD` / lock | … |

Actor rules: `SELF` / `DIRECT_MANAGER` / `MANAGER_L2` / `HR` / `CNB` / `ROLE`. Actions: `SUBMIT` /
`APPROVE` / `EDIT` / `RETURN` (+ `AUTO_FORWARD` written by the system). Cite the source
(SF4C PMGM.xx, HR guide page, email template) for each row.

Put the table in `docs/flows/new-flow.md` and get it agreed before step 2 if it is not mechanical.

## 2. Declare it — `src/data/types.ts`

New form type, actions or overdue behaviours go into their state sets with Vietnamese labels.

## 3. Implement it — `src/lib/workflowRules.ts`

- The template as data (steps array), not as `if` chains.
- ONE transition function: `(form, step, action, actor, now) → next state | refused`. The mock gateway
  calls it; it never re-implements it.
- Actor resolution through the reporting line **at the time of the action**.
- Proxy and delegation: the result records `actorUserId` AND `onBehalfOfUserId`; a delegation outside
  `validFrom..validTo` grants nothing.
- Overdue: a pure `overdueActions(forms, now)` that returns what the scheduler should do, so it is testable.
- Launch (D5): `formsForLaunch(launch, employees)` — who receives a form, its due date (e.g. launch + 7 days).

## 4. Test it — `src/lib/workflowRules.test.ts`

Happy path through every step, plus: an action invalid in the current state (refused), return at the
last step, overdue auto-forward, delegation expiring mid-form, proxy recording both people, a manager
change mid-form, a scheduled launch on day 1 of each month.

## 5. Wire the side effects

The gateway emits an event on each transition (T7 turns it into an in-app notification and an audit-log
entry). Add the notification template text in Vietnamese, based on the email template.

## 6. Document and verify

`business-rules.md` §2 and §5, `docs/flows/new-flow.md`, `/log-decision`. Then
`npm run typecheck && npm run test && npm run build && npm run lint`.
