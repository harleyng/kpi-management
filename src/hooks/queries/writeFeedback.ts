import { toast } from 'sonner';
import { errorSpecOf, issueText, KpiError } from '@/lib/errorCatalog';

/**
 * A failed write, in the catalogue's words (CLAUDE.md rule 6): the code's title, and as the
 * description the rule's own reason when the error carries one ("Kỳ đã khóa số liệu."), else the
 * code's message. `step` names which part of a two-step write failed ("Tải tệp lên").
 */
export function toastWriteError(error: unknown, step?: string): void {
  const spec = errorSpecOf(error);
  const firstIssue = error instanceof KpiError ? error.issues.find((i) => i.detail !== null) : undefined;
  const reason = firstIssue ? issueText(firstIssue.detail, firstIssue.code) : spec.message;
  toast.error(step ? `${step}: ${spec.title}` : spec.title, reason ? { description: reason } : undefined);
}
