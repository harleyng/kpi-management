import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { errorSpecOf } from '@/lib/errorCatalog';
import { loadPhase, type QueryState } from '@/lib/queryState';
import { matchesSearch } from '@/lib/search';
import { cn } from '@/lib/utils';
import { ErrorState } from './ErrorStateCard';
import type { FieldControlProps } from './FormField';

export interface ComboboxOption {
  id: string;
  label: string;
  /** A second, muted line — a code, an email, a unit. Also searched. */
  description?: string;
  /** Extra text the search matches but the option does not show. */
  keywords?: readonly string[];
  /** Options with the same group are listed under one heading, in order of first appearance. */
  group?: string;
  /**
   * Cannot be newly picked (an archived KPI, a resigned person), but still DISPLAYS when it is the
   * current value — a value that was valid when chosen must not vanish from the trigger.
   */
  disabled?: boolean;
}

interface BaseProps extends Partial<FieldControlProps> {
  options: readonly ComboboxOption[] | undefined;
  /** The `useQuery` result(s) behind `options` — `combineQueries` for several. */
  query: QueryState;
  placeholder: string;
  searchPlaceholder: string;
  /** The list itself is empty (first use): "Chưa có nhân viên nào." */
  emptyText: string;
  /**
   * Last known labels by id, for selected values that are not (or not yet) in `options` — e.g. the
   * KPI name stored on a goal. Without one, a missing value says "Không còn trong danh sách".
   */
  fallbackLabels?: Readonly<Record<string, string>>;
  disabled?: boolean;
  className?: string;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Show a clear (×) button while a value is set. Default `true`. */
  clearable?: boolean;
}

interface MultipleProps extends BaseProps {
  multiple: true;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** The trigger's summary for 2+ selections — name WHAT was chosen ("An và 2 người khác"). */
  summarize: (labels: string[]) => string;
  clearable?: boolean;
}

export type EntityComboboxProps = SingleProps | MultipleProps;

const MISSING_LABEL = 'Không còn trong danh sách';
const MISSING_HINT = 'Giá trị đã chọn đã bị lưu trữ hoặc ngừng hoạt động. Chọn lại giá trị khác.';
const LOADING_LABEL = 'Đang tải…';
const UNLOADED_LABEL = 'Không tải được danh sách';

/**
 * A searchable picker over a list read through a query hook — the base of `KpiPicker` and
 * `EmployeePicker`. Popover + cmdk, with OUR filter (`matchesSearch`, diacritic-insensitive):
 * cmdk's own filter only lower-cases, so "nguyen" would not find "Nguyễn".
 *
 * The trigger never misreports the current value:
 * - list still loading → "Đang tải…", not "missing";
 * - list failed → the fallback label if known, else "Không tải được danh sách", with a warning;
 * - list loaded but the value is not in it → warning + "Không còn trong danh sách" (or the
 *   fallback label), and the clear button stays — the value is still what would be submitted.
 */
export function EntityCombobox(props: EntityComboboxProps) {
  const {
    options,
    query,
    placeholder,
    searchPlaceholder,
    emptyText,
    fallbackLabels,
    disabled,
    className,
    clearable = true,
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    'aria-required': required,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const phase = loadPhase(query, options !== undefined);
  const selectedIds: readonly string[] = props.multiple ? props.value : props.value ? [props.value] : [];
  const byId = useMemo(() => new Map((options ?? []).map((o) => [o.id, o])), [options]);

  const resolved = selectedIds.map((sid) => ({
    id: sid,
    option: byId.get(sid),
    label: byId.get(sid)?.label ?? fallbackLabels?.[sid],
  }));
  const anyMissing = phase === 'ready' && resolved.some((r) => !r.option);

  const trigger = triggerContent();

  function triggerContent(): { text: string; tone: 'placeholder' | 'value' | 'muted' | 'warning'; title?: string } {
    if (selectedIds.length === 0) return { text: placeholder, tone: 'placeholder' };
    if (phase === 'loading' || phase === 'idle') {
      const known = resolved.every((r) => r.label);
      if (!known) return { text: LOADING_LABEL, tone: 'muted' };
    }
    if (phase === 'error' && resolved.some((r) => !r.label)) return { text: UNLOADED_LABEL, tone: 'warning' };

    const labels = resolved.map((r) => r.label ?? MISSING_LABEL);
    const text = props.multiple && labels.length > 1 ? props.summarize(labels) : labels[0];
    const title = anyMissing ? `${labels.join(', ')}\n${MISSING_HINT}` : labels.join(', ');
    return { text, tone: anyMissing || phase === 'error' ? 'warning' : 'value', title };
  }

  const select = (optionId: string) => {
    if (props.multiple) {
      const next = props.value.includes(optionId)
        ? props.value.filter((v) => v !== optionId)
        : [...props.value, optionId];
      props.onChange(next);
    } else {
      // Re-picking the current value clears it only where clearing is allowed (a required field
      // must not be emptied by a stray click).
      if (optionId !== props.value) props.onChange(optionId);
      else if (clearable) props.onChange(null);
      setOpen(false);
    }
  };

  const clear = () => {
    if (props.multiple) props.onChange([]);
    else props.onChange(null);
  };

  const filtered = useMemo(
    () =>
      (options ?? []).filter((o) => matchesSearch(search, [o.label, o.description, ...(o.keywords ?? [])])),
    [options, search],
  );
  const groups = useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const option of filtered) {
      const key = option.group ?? '';
      const list = map.get(key);
      if (list) list.push(option);
      else map.set(key, [option]);
    }
    return [...map.entries()];
  }, [filtered]);

  const showClear = clearable && selectedIds.length > 0 && !disabled;

  let listBody: ReactNode;
  if (phase === 'error') {
    listBody = <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} className="px-3" />;
  } else if (phase === 'loading') {
    listBody = (
      <div className="space-y-2 p-3" aria-busy>
        <span className="sr-only">{LOADING_LABEL}</span>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  } else if (phase === 'idle') {
    // A disabled query: nothing was asked, so the list is neither empty nor failed.
    listBody = null;
  } else if ((options ?? []).length === 0) {
    listBody = <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  } else if (filtered.length === 0) {
    listBody = (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        Không có kết quả cho “{search.trim()}”. Thử từ khóa khác.
      </p>
    );
  } else {
    listBody = groups.map(([group, items]) => (
      <CommandGroup key={group || '_'} heading={group || undefined}>
        {items.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <CommandItem
              key={option.id}
              value={option.id}
              disabled={option.disabled && !selected}
              onSelect={() => select(option.id)}
              className="items-start gap-2"
            >
              <Check
                className={cn('mt-0.5 h-4 w-4 shrink-0 text-primary', selected ? 'opacity-100' : 'opacity-0')}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words">{option.label}</span>
                {option.description && (
                  <span className="block break-words text-xs text-muted-foreground">{option.description}</span>
                )}
              </span>
            </CommandItem>
          );
        })}
      </CommandGroup>
    ));
  }

  return (
    <div className={cn('relative', className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-required={required}
            disabled={disabled}
            title={trigger.title}
            className={cn(
              'w-full justify-between gap-2 px-3 font-normal',
              showClear && 'pr-14',
              invalid && 'border-support-negative',
            )}
          >
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5',
                trigger.tone === 'placeholder' || trigger.tone === 'muted' ? 'text-muted-foreground' : '',
                trigger.tone === 'warning' && 'text-support-warning',
              )}
            >
              {trigger.tone === 'warning' && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              <span className="truncate">{trigger.text}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
          <Command shouldFilter={false}>
            <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
            <CommandList className="max-h-72">{listBody}</CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* A sibling, not inside the trigger: a button inside a button is invalid HTML. */}
      {showClear && (
        <button
          type="button"
          aria-label="Bỏ chọn"
          onClick={clear}
          className="absolute right-8 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}

      {anyMissing && <span className="sr-only">{MISSING_HINT}</span>}
    </div>
  );
}
