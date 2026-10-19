import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useResetSeed } from '@/hooks/queries/session';
import { PendingButton } from './PendingButton';
import { toastError } from '@/components/shared/toastError';

/** Back to the seed for every company — behind a confirmation, since every entry is lost. */
export function DevResetSection() {
  const resetSeed = useResetSeed();
  const [confirming, setConfirming] = useState(false);

  return (
    <section>
      <PendingButton pending={resetSeed.isPending} onClick={() => setConfirming(true)}>
        Đặt lại dữ liệu mẫu
      </PendingButton>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive
        title="Đặt lại dữ liệu mẫu?"
        body="Mọi thay đổi bạn đã nhập sẽ mất và dữ liệu quay về bản seed ban đầu, cho mọi công ty."
        confirmLabel="Đặt lại"
        cancelLabel="Hủy"
        onConfirm={() => {
          // `mutateAsync`, not `mutate`'s callbacks: clearing the cache reloads the session, which
          // unmounts this toolbar before a per-call callback could run.
          resetSeed.mutateAsync().then(() => toast.success('Đã đặt lại dữ liệu mẫu.'), toastError);
        }}
      />
    </section>
  );
}
