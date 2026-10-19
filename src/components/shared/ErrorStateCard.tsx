import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ErrorSpec } from '@/lib/errorCatalog';

interface ErrorStateCardProps {
  /** The catalogue entry to render — `errorSpecOf(error)` from `src/lib/errorCatalog.ts`. */
  spec: Pick<ErrorSpec, 'title' | 'message' | 'action'>;
  onAction?: () => void;
  className?: string;
}

/**
 * A read that FAILED, standing in for the table it could not load.
 *
 * Distinct from `EmptyStateCard`, and the difference is load-bearing: an empty list is an answer,
 * a failed read is the absence of one. React Query keeps the rows from the last good fetch while a
 * refetch is failing, and a KPI table showing last week's actuals as though they were current is
 * exactly the wrong number on a scorecard — so the screen must be able to say "we could not ask"
 * instead of "there is nothing".
 *
 * Hence the three parts an empty state does not have: a titled failure, the reason under it, and a
 * way to try again. All three come from the catalogue (CLAUDE.md, rule 6) — callers pass the spec,
 * never their own wording.
 */
export function ErrorStateCard({ spec, onAction, className }: ErrorStateCardProps) {
  return (
    <Card className={className}>
      <CardContent className="p-8 text-center">
        <div className="text-sm font-medium">{spec.title}</div>
        {spec.message && <p className="mt-1 text-sm text-muted-foreground">{spec.message}</p>}
        {spec.action && (
          <Button variant="link" className="mt-2 h-auto p-0" onClick={onAction}>
            {spec.action}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
