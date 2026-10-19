import { toast } from 'sonner';
import { errorSpecOf } from '@/lib/errorCatalog';

/**
 * Write feedback in one place. A failed write toasts the CATALOGUE copy (CLAUDE.md rule 6) — never a
 * retyped string; a success names the action that just happened ("Đã lưu chỉ tiêu").
 */
export function toastError(error: unknown): void {
  const spec = errorSpecOf(error);
  toast.error(spec.title, spec.message ? { description: spec.message } : undefined);
}

export function toastSuccess(title: string): void {
  toast.success(title);
}
