import { MissingValue } from '@/components/shared/DataTable';
import type { Goal, GoalTargetLevel, MeasureUnit } from '@/data/types';
import { formatPercent } from '@/lib/utils';
import { formatInUnit } from './formCopy';

/**
 * A goal's target as set — numeric or text (BR-KPI-10) — and, when it has levels (D1, BR-KPI-09), each
 * level with the score it earns, shown as set (interpolation between them is `ASSUMPTION Q1`, in the
 * rules, not here).
 */
export function GoalTarget({ goal, levels, unit }: { goal: Goal; levels: readonly GoalTargetLevel[]; unit: MeasureUnit | undefined }) {
  const own = levels.filter((l) => l.goalId === goal.id).sort((a, b) => a.levelCode.localeCompare(b.levelCode));
  const target = goal.targetType === 'TEXT' ? goal.targetText : formatInUnit(goal.targetValue, unit);
  return (
    <div className="space-y-0.5">
      <div className="tabular">{target ?? <MissingValue />}</div>
      {own.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Định mức">
          {own.map((l) => (
            <li key={l.id} className="tabular">
              {l.levelCode}: {goal.targetType === 'TEXT' ? l.targetText : formatInUnit(l.targetValue, unit)} (đạt {formatPercent(l.scorePct)})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
