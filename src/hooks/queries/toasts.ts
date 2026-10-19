import { toast } from 'sonner';
import { errorSpecOf } from '@/lib/errorCatalog';

/**
 * The toasts every write shares (README "Writes"). A failed write is ALWAYS a toast in the catalogue's
 * words (CLAUDE.md rule 6) — whatever the screen also shows inline. `persistent` keeps it on screen
 * until dismissed (a partial write the user must act on).
 */
export function toastWriteError(error: unknown, options: { persistent?: boolean; description?: string } = {}): void {
  const spec = errorSpecOf(error);
  toast.error(spec.title, {
    description: options.description ?? spec.message ?? undefined,
    duration: options.persistent ? Infinity : undefined,
  });
}

export function toastSaved(title: string, description?: string): void {
  toast.success(title, description ? { description } : undefined);
}
