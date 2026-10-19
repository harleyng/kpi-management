import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The "Đang dùng" counts come from a separate read of every goal. When it fails the counts show `—`,
 * and this line says why — locks still hold (the gateway refuses), the screen just cannot say how many.
 */
export function UsageUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      <AlertTriangle className="h-4 w-4 text-support-warning" aria-hidden />
      Không tải được số mục tiêu đang dùng. Các khóa vẫn được áp dụng khi lưu.
      <Button variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>
        Thử lại
      </Button>
    </p>
  );
}
