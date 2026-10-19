import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PAGE_SIZE_OPTIONS, type PageSlice } from '@/lib/pagination';

interface PaginationProps {
  /** The slice being rendered — take it straight from `paginate()`. */
  slice: Pick<PageSlice<unknown>, 'page' | 'pageCount' | 'from' | 'to' | 'total'>;
  onPageChange: (page: number) => void;
  /**
   * Rows per page. Optional TOGETHER with `onPageSizeChange`: omit both and no selector is
   * rendered, which is how a table that offers no size choice keeps a plain footer.
   */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

/**
 * The footer bar under a paged table.
 *
 * It always states the range ("11–20 trên 25") because a table that silently shows a subset is a
 * table the user will misread as the whole list. The step buttons only appear when there is more
 * than one page — two permanently disabled arrows are noise, not information.
 *
 * Paging is a display concern here: the caller already holds every row (see `paginate`), so this
 * component never fetches anything.
 */
export function Pagination({
  slice,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions,
  className,
}: PaginationProps) {
  const { page, pageCount, from, to, total } = slice;

  return (
    <nav
      aria-label="Phân trang"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-xs text-muted-foreground',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {/* Already polite, so changing the page size announces the new range for free. */}
        <span aria-live="polite" className="tabular">
          {from}–{to} trên {total}
        </span>

        {pageSize != null && onPageSizeChange && (
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger
              aria-label="Số dòng mỗi trang"
              className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-xs shadow-none focus:ring-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="min-w-0">
              {(pageSizeOptions ?? PAGE_SIZE_OPTIONS).map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size}/trang
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Trang trước"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular px-1">
            Trang {page}/{pageCount}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Trang sau"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </nav>
  );
}
