import { useId, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** What `FormField` hands its control — spread it onto the input, select trigger or picker. */
export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  /** A standing hint under the field ("Tổng các chỉ tiêu phải bằng 100%."). Stays when an error shows. */
  hint?: ReactNode;
  /** The field's current error, if any (from react-hook-form/zod). */
  error?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label + control + hint + error, wired for assistive tech — every form on every track uses it,
 * so a field reads the same way everywhere.
 *
 * A render prop rather than `cloneElement`: the control receives its ids explicitly, which works
 * the same for `<Input>`, a Radix `<SelectTrigger>` and the pickers.
 *
 * ```tsx
 * <FormField label="Trọng số (%)" required error={errors.weight?.message}>
 *   {(control) => <Input {...control} {...register('weight')} inputMode="decimal" />}
 * </FormField>
 * ```
 *
 * - The error sits directly beneath the control (design-system "Message placement") and is read
 *   FIRST in `aria-describedby`, before the hint. `role="alert"` announces it when it appears on
 *   submit; `aria-invalid` is set only while there is an error.
 * - Required: a visible `*` (hidden from screen readers, which hear "bắt buộc" and `aria-required`
 *   instead). Long forms state "* Bắt buộc" once at the top — see `RequiredLegend`.
 */
export function FormField({ label, required = false, hint, error, className, children }: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <>
            <span aria-hidden className="ml-0.5 text-support-negative">
              *
            </span>
            <span className="sr-only"> (bắt buộc)</span>
          </>
        )}
      </Label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-support-negative">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** "* Bắt buộc", once at the top of a long form, so the asterisk is explained where it is first seen. */
export function RequiredLegend({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      <span aria-hidden className="text-support-negative">
        *
      </span>{' '}
      Bắt buộc
    </p>
  );
}
