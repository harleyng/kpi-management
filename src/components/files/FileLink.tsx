import { Paperclip } from 'lucide-react';
import { MissingValue } from '@/components/shared/DataTable';
import { toastError } from '@/components/shared/toastError';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Id } from '@/data/types';
import { useFile, useOpenFile } from '@/hooks/queries/system';
import { formatFileSize } from '@/lib/utils';

/**
 * A stored attachment (WBS 4.8.3): its name and size, opening in a new tab. In the mock the content
 * of a file uploaded before a page reload is gone (only the row survives) — opening it then says so
 * in the catalogue's words instead of opening a blank tab.
 */
export function FileLink({ fileId }: { fileId: Id }) {
  const file = useFile(fileId);
  const openFile = useOpenFile();

  if (file.isPending) return <Skeleton className="h-5 w-40" />;
  if (!file.data) return <MissingValue />;

  const { fileName, sizeBytes } = file.data;
  return (
    <Button
      type="button"
      variant="link"
      className="h-auto max-w-full justify-start gap-1.5 p-0 font-normal"
      aria-label={`Mở ${fileName} trong thẻ mới`}
      onClick={() => openFile(fileId, fileName).catch(toastError)}
    >
      <Paperclip className="shrink-0" aria-hidden />
      <span className="truncate" title={fileName}>
        {fileName}
      </span>
      <span className="tabular shrink-0 text-xs text-muted-foreground">{formatFileSize(sizeBytes)}</span>
    </Button>
  );
}
