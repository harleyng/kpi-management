import { useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ERROR_CATALOG } from '@/lib/errorCatalog';

interface LoadMoreFooterProps {
  /** Rows on screen now. */
  shown: number;
  /** What a row is, plural ("thông báo", "dòng"). */
  noun: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** The last "Tải thêm" failed: said in place, the rows already loaded stay. */
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<{ hasNextPage: boolean }>;
}

/**
 * The foot of a KEYSET-paged list (`Page<T>` has no total, so there are no page numbers): how many
 * rows are shown, and "Tải thêm" while the gateway has more. The count is a polite live region, so a
 * screen reader hears it grow; when the last page arrives the button goes away and focus moves to
 * the count instead of being lost.
 */
export function LoadMoreFooter({ shown, noun, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage }: LoadMoreFooterProps) {
  const statusRef = useRef<HTMLParagraphElement>(null);

  const loadMore = async () => {
    const result = await fetchNextPage();
    if (!result.hasNextPage) statusRef.current?.focus();
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs text-muted-foreground">
      <p ref={statusRef} tabIndex={-1} role="status" className="tabular outline-none">
        {hasNextPage ? `Đang hiển thị ${shown} ${noun} mới nhất` : `Đang hiển thị ${shown} ${noun}`}
      </p>
      {isFetchNextPageError && <p className="text-support-negative">{ERROR_CATALOG['ERR-KPI-01'].title}</p>}
      {hasNextPage && (
        <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={isFetchingNextPage} aria-busy={isFetchingNextPage}>
          {isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
          {isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </Button>
      )}
    </div>
  );
}
