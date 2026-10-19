import type { UserAccount } from '@/data/types';

/** An id as a short code — the full id on hover and for screen readers. */
export function ShortId({ id }: { id: string }) {
  return (
    <span className="font-mono text-xs" title={id} aria-label={id}>
      {id.slice(0, 8)}…
    </span>
  );
}

/** "Trần Thu Hà", "Hệ thống" for a system action — the second line names who it was done for. */
export function AuditActor({
  userId,
  onBehalfOfUserId,
  accounts,
}: {
  userId: string | null;
  onBehalfOfUserId: string | null;
  accounts: ReadonlyMap<string, Pick<UserAccount, 'displayName'>>;
}) {
  const name = (id: string) => accounts.get(id)?.displayName ?? <ShortId id={id} />;
  return (
    <div className="space-y-0.5">
      <p>{userId === null ? <span className="text-muted-foreground">Hệ thống</span> : name(userId)}</p>
      {onBehalfOfUserId !== null && <p className="text-xs text-muted-foreground">thay cho {name(onBehalfOfUserId)}</p>}
    </div>
  );
}
