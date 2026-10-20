import { useId, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { useAskInsight, useInsightSummary } from '@/hooks/queries/insight';
import { MAX_QUESTION_LENGTH, SUGGESTED_QUESTIONS, type Insight } from '@/integrations/insight/types';
import type { DashboardSnapshot } from '@/lib/dashboardRules';
import { errorSpecOf } from '@/lib/errorCatalog';

/**
 * "Trợ lý KPI · Giả lập" (WBS 4.7.4, BR-KPI-89) — last in the right-hand panel column, collapsed to its summary.
 * It answers only from the snapshot of the numbers on screen, so it never says more than the viewer
 * may see, and it is labelled a simulation everywhere it speaks.
 */
export function InsightCard({ snapshot }: { snapshot: DashboardSnapshot | null }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const bodyId = useId();
  const inputId = useId();
  const summary = useInsightSummary(open ? snapshot : null);
  const ask = useAskInsight();

  const submit = (text: string) => {
    if (!snapshot || text.trim().length === 0) return;
    setQuestion(text);
    ask.mutate({ snapshot, question: text });
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(question);
  };

  return (
    <section aria-labelledby={`${bodyId}-title`} className="rounded-md border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id={`${bodyId}-title`} className="flex items-center gap-2 text-sm font-semibold">
            Trợ lý KPI
            <Badge variant="muted">Giả lập</Badge>
          </h3>
          <p className="text-xs text-muted-foreground">Trả lời từ số liệu bạn đang xem. Không phải đánh giá chính thức.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)} disabled={!snapshot}>
          {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          {open ? 'Thu gọn' : 'Tóm tắt'}
        </Button>
      </div>

      {open && snapshot && (
        <div id={bodyId} className="mt-3 space-y-3">
          <div aria-live="polite">
            {summary.error ? (
              <ErrorState spec={errorSpecOf(summary.error)} onAction={() => void summary.refetch()} />
            ) : summary.data ? (
              <InsightText insight={summary.data} />
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
                Đang soạn câu trả lời…
              </p>
            )}
          </div>

          <form onSubmit={onSubmit} className="space-y-2" noValidate>
            <Label htmlFor={inputId} className="text-xs">
              Hỏi về số liệu đang xem
            </Label>
            <div className="flex gap-2">
              <Input id={inputId} value={question} maxLength={MAX_QUESTION_LENGTH} onChange={(e) => setQuestion(e.target.value)} placeholder="Ví dụ: Chỉ tiêu nào cần chú ý?" />
              <Button type="submit" size="sm" disabled={ask.isPending || question.trim().length === 0}>
                Gửi câu hỏi
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <Button key={q} type="button" variant="secondary" size="sm" className="h-auto whitespace-normal rounded-full px-2.5 py-1 text-left text-xs font-normal" onClick={() => submit(q)}>
                  {q}
                </Button>
              ))}
            </div>
          </form>

          <div aria-live="polite">
            {ask.isPending && <p className="text-sm text-muted-foreground">Đang soạn câu trả lời…</p>}
            {ask.error && <ErrorState spec={errorSpecOf(ask.error)} onAction={() => submit(question)} />}
            {ask.data && !ask.isPending && (
              <div className="rounded-md bg-neutral-05 px-3 py-2">
                <InsightText insight={ask.data} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function InsightText({ insight }: { insight: Insight }) {
  return (
    <div className="space-y-1 text-sm">
      {insight.sentences.map((s, i) => (
        <p key={i}>{s.text}</p>
      ))}
    </div>
  );
}
