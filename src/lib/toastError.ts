import { toast } from 'sonner';
import { errorSpecOf } from './errorCatalog';

/** A failed call, in the catalogue's words (CLAUDE.md rule 6) — never a retyped string. */
export function toastError(error: unknown): void {
  const spec = errorSpecOf(error);
  toast.error(spec.title, spec.message ? { description: spec.message } : undefined);
}
