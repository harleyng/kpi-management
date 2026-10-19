import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  value: string;
  /** Accessible name — include WHAT is being copied, since the icon alone says nothing. */
  label: string;
  className?: string;
}

/** How long the tick stays before the button returns to its copy icon. */
const CONFIRM_MS = 1500;

/**
 * Copy a value (a KPI code, an evidence link) to the clipboard.
 *
 * The button is hover-revealed rather than always visible, so a table of them does not read as a
 * column of controls. That is only safe because `focus-visible:opacity-100` and the `aria-label`
 * keep it reachable: drop either and this becomes an invisible control.
 *
 * `navigator.clipboard` is undefined on an insecure origin — the ordinary case when the prototype
 * is demoed from a LAN address over plain http — so the failure is reported rather than swallowed.
 */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
    } catch {
      toast.error('Không sao chép được. Hãy chọn và sao chép thủ công.');
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        className={cn(
          'h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [&_svg]:size-3',
          className,
        )}
        onClick={copy}
      >
        {copied ? <Check className="text-support-positive" /> : <Copy />}
      </Button>
      {/* Mounted from the first render: a live region added at the moment its content changes is
          not announced. */}
      <span role="status" className="sr-only">
        {copied ? 'Đã sao chép' : ''}
      </span>
    </>
  );
}
