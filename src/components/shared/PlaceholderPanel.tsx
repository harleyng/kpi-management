import { Construction } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface PlaceholderPanelProps {
  /** The WBS work package(s) and track that will fill this screen, e.g. "WP 4.3.2–4.3.5, Track T3". */
  spec: string;
  /** What will be built here, in product language (Vietnamese). */
  items: string[];
}

/**
 * Placeholder block for the Phase 0 scaffold.
 *
 * It deliberately names the work package and lists the work: a placeholder that says nothing
 * leaves nobody remembering what was meant to go there a few weeks later. Delete it from a page
 * once that page is actually implemented.
 */
export function PlaceholderPanel({ spec, items }: PlaceholderPanelProps) {
  return (
    <Card className="border-dashed bg-surface-alt">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Construction className="h-4 w-4 text-primary" aria-hidden />
          Chưa xây dựng
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Phần việc: {spec}</p>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-primary" aria-hidden>
                •
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
