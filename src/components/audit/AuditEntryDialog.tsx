import { useNavigate } from 'react-router-dom';
import { MissingValue } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AUDIT_ACTION_LABEL, ENTITY_NAME_LABEL, type AuditLog, type UserAccount } from '@/data/types';
import { auditChanges, auditSubjectName } from '@/lib/auditRules';
import { formatDateTime } from '@/lib/utils';
import { AuditActor, ShortId } from './AuditActor';
import { fieldLabel, formatAuditValue } from './auditFormat';

/**
 * One audit entry in full (WBS 4.8.4): who, when, what, why — and the fields that changed, before and
 * after. A creation shows only "Sau", a deletion only "Trước". A snapshot that cannot be read says
 * so instead of looking like "nothing changed".
 */
export function AuditEntryDialog({
  entry,
  accounts,
  employeeName,
  onClose,
}: {
  entry: AuditLog;
  accounts: ReadonlyMap<string, Pick<UserAccount, 'displayName'>>;
  employeeName: (employeeId: string) => string | undefined;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const changes = auditChanges(entry);
  const name = auditSubjectName(entry, employeeName);
  const showBefore = entry.beforeData !== null;
  const showAfter = entry.afterData !== null;

  const historyOfRow = () => {
    navigate(`/system/audit-log?entityName=${encodeURIComponent(entry.entityName)}&entityId=${encodeURIComponent(entry.entityId)}`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Chi tiết thay đổi</DialogTitle>
          <DialogDescription>
            {AUDIT_ACTION_LABEL[entry.action]} {ENTITY_NAME_LABEL[entry.entityName]}
            {name ? `: ${name}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Thời gian</dt>
            <dd className="tabular">{formatDateTime(entry.createdAt)}</dd>
            <dt className="text-muted-foreground">Người thực hiện</dt>
            <dd>
              <AuditActor userId={entry.userId} onBehalfOfUserId={entry.onBehalfOfUserId} accounts={accounts} />
            </dd>
            <dt className="text-muted-foreground">Hành động</dt>
            <dd>{AUDIT_ACTION_LABEL[entry.action]}</dd>
            <dt className="text-muted-foreground">Đối tượng</dt>
            <dd className="space-x-2">
              <span>{ENTITY_NAME_LABEL[entry.entityName]}</span>
              {name && <span>· {name}</span>}
              <ShortId id={entry.entityId} />
            </dd>
            <dt className="text-muted-foreground">Lý do</dt>
            <dd className="whitespace-pre-line">{entry.reason ?? <MissingValue />}</dd>
          </dl>

          {changes === null ? (
            <p className="text-sm text-muted-foreground">Không đọc được nội dung thay đổi.</p>
          ) : changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bản ghi không ghi nhận trường nào thay đổi.</p>
          ) : (
            <div className="rounded-lg border">
              <Table aria-label="Các trường thay đổi">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-medium">Trường</TableHead>
                    {showBefore && <TableHead className="text-xs font-medium">Trước</TableHead>}
                    {showAfter && <TableHead className="text-xs font-medium">Sau</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map((c) => (
                    <TableRow key={c.field}>
                      <TableCell className="align-top">{fieldLabel(c.field)}</TableCell>
                      {showBefore && (
                        <TableCell className="align-top text-muted-foreground">{formatAuditValue(entry.entityName, c.field, c.before)}</TableCell>
                      )}
                      {showAfter && <TableCell className="align-top">{formatAuditValue(entry.entityName, c.field, c.after)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={historyOfRow}>
            Xem lịch sử của bản ghi này
          </Button>
          <Button onClick={onClose}>Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
