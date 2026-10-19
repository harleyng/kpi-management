import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

/** "Bỏ thay đổi chưa lưu?" — before an editor with unsaved edits closes or switches row. */
export function DiscardChangesDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Bỏ thay đổi chưa lưu?"
      body="Các thay đổi bạn vừa nhập sẽ không được lưu."
      confirmLabel="Bỏ thay đổi"
      cancelLabel="Tiếp tục sửa"
      destructive
      onConfirm={onDiscard}
    />
  );
}
