import { Check } from 'lucide-react';
import type { FormInstance, WorkflowStep } from '@/data/types';
import { cn } from '@/lib/utils';

type StepState = 'done' | 'current' | 'upcoming';
const STATE_TEXT: Record<StepState, string> = { done: 'đã qua', current: 'đang xử lý', upcoming: 'chưa đến' };

/**
 * The form's steps as the real sequence they are (numbered; operate-craft allows numbers here),
 * each with its state in words — never a tick or a dot alone. A cancelled form marks no step current.
 */
export function FormStepStrip({ form, steps }: { form: FormInstance; steps: readonly WorkflowStep[] }) {
  const current = steps.find((s) => s.id === form.currentStepId) ?? null;
  const stateOf = (step: WorkflowStep): StepState => {
    if (form.status === 'Completed') return 'done';
    if (current === null) return 'upcoming';
    return step.stepNo < current.stepNo ? 'done' : step.stepNo === current.stepNo ? 'current' : 'upcoming';
  };

  return (
    <ol aria-label="Các bước của phiếu" className="flex flex-wrap items-stretch gap-2">
      {steps.map((step) => {
        const state = stateOf(step);
        return (
          <li
            key={step.id}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
              state === 'current' && 'border-primary bg-primary-subtle',
              state !== 'current' && 'bg-background',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'tabular flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                state === 'done' && 'bg-support-positive-subtle text-support-positive',
                state === 'current' && 'bg-primary text-primary-foreground',
                state === 'upcoming' && 'bg-neutral-10 text-muted-foreground',
              )}
            >
              {state === 'done' ? <Check className="h-3 w-3" /> : step.stepNo}
            </span>
            <span className={cn('truncate', state === 'current' ? 'font-medium' : 'text-muted-foreground')}>{step.name}</span>
            <span className="sr-only">
              (bước {step.stepNo}, {STATE_TEXT[state]})
            </span>
          </li>
        );
      })}
    </ol>
  );
}
