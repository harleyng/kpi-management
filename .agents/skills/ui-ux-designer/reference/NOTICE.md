# Attribution

The files in this folder adapt guidance from two Apache-2.0 licensed projects. They are condensed and
rewritten for Syntra KPI (an Operate-mode business app with Vietnamese UI copy); they are not verbatim
copies, and the tooling of the originals (scripts, detectors, binaries) is not included.

| Source | Version read | Used in |
|---|---|---|
| **impeccable** by Paul Bakaus — https://github.com/pbakaus/impeccable (`.agents/skills/impeccable/`: `SKILL.md`, `reference/operate.md`, `mode-operate.md`, `craft-floor.md`, `critique.md`, `audit.md`, `polish.md`, `clarify.md`, `harden.md`) | commit `0665bd8`, skill v4.6.0 | `operate-craft.md`, `critique.md`, `audit.md`, `copy.md` |
| **frontend-design** by Anthropic — https://github.com/anthropics/skills (`skills/frontend-design/SKILL.md`) | commit `dbd4588` | `operate-craft.md` (restraint, generated-UI defaults, plan-then-review), `copy.md` (writing) |

Changes made: scoped to Operate surfaces; examples, personas and rules replaced with Syntra KPI ones
(Goal Plans, evaluation forms, imports, the BSC dashboard); impeccable's commands, PRODUCT.md /
DESIGN.md files and detector steps replaced by this repository's `design-system.md`, `/design-review`
skill and Phase 4 gate. Both licenses: Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0.

To install the full impeccable skill (with its detector and live mode) instead of these notes, see its
repository; that is a separate decision because it downloads a binary on first run.
