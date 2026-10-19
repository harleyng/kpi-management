import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name; defaults to the placeholder — a search field with no label is unusable. */
  label?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * The magnifier-inside-a-field pattern, in one place.
 *
 * `type="search"` rather than `text`: it gives the browser's own clear button for free, which is
 * the control a user reaches for after a query that matched nothing.
 *
 * Filtering is always the caller's job — this component holds no state, so the page keeps the
 * one thing paging depends on (resetting to page 1 when the term changes).
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
  disabled,
}: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        className="pl-8"
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
