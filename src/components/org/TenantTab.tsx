import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import { TENANT_STATUS_LABEL, type Tenant } from '@/data/types';
import { issuesOf, useSaveTenant } from '@/hooks/queries/org';
import { readGatewayNow } from '@/hooks/queries/session';
import { fieldIssues, otherIssues } from '@/lib/orgIssueCopy';
import { tenantIssues } from '@/lib/orgAdminRules';
import { zoneOffsetLabel } from '@/lib/isoDate';

/** The zones offered; the tenant's own zone is always in the list. */
const ZONES = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'UTC'];

/**
 * "Công ty" — the current tenant's record (WBS 4.1.1). Only the company you are in can be edited;
 * creating a company and "Tạm ngưng" are not available in the prototype (BR-KPI-73).
 */
export function TenantTab() {
  const { tenant } = useSession();
  return <TenantForm key={`${tenant.id}-${tenant.name}-${tenant.code}-${tenant.timezone}`} tenant={tenant} />;
}

function TenantForm({ tenant }: { tenant: Tenant }) {
  // The offset shown is today's (summer time differs), read from the gateway clock.
  const [now] = useState(readGatewayNow);
  const save = useSaveTenant();
  const [draft, setDraft] = useState({ name: tenant.name, code: tenant.code, timezone: tenant.timezone });
  const [shownIssues, setShownIssues] = useState<ReturnType<typeof issuesOf>>([]);
  const dirty = draft.name !== tenant.name || draft.code !== tenant.code || draft.timezone !== tenant.timezone;
  const zones = ZONES.includes(tenant.timezone) ? ZONES : [tenant.timezone, ...ZONES];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = { ...tenant, ...draft };
    const issues = tenantIssues(next, tenant, tenant.id);
    setShownIssues(issues);
    if (issues.length > 0) return;
    const { createdAt: _created, ...input } = next;
    save.mutate(input, { onError: (error) => setShownIssues(issuesOf(error)) });
  };
  const errors = fieldIssues(shownIssues);
  const problems = otherIssues(shownIssues, ['name', 'code', 'timezone']);

  return (
    <Card className="max-w-xl">
      <CardContent className="p-5">
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="text-sm text-muted-foreground">Chỉ chỉnh được công ty hiện tại.</p>
          <RequiredLegend />
          <FormField label="Tên công ty" required error={errors.name}>
            {(c) => <Input {...c} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />}
          </FormField>
          <FormField label="Mã công ty" required error={errors.code}>
            {(c) => <Input {...c} value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))} className="font-mono" />}
          </FormField>
          <FormField label="Múi giờ" required error={errors.timezone} hint="Hạn chót và “hôm nay” của mọi quy trình tính theo múi giờ này.">
            {(c) => (
              <Select value={draft.timezone} onValueChange={(v) => setDraft((d) => ({ ...d, timezone: v }))}>
                <SelectTrigger {...c}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z} ({zoneOffsetLabel(now, z)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Trạng thái</p>
            <StatusBadge tone={tenant.status === 'Active' ? 'positive' : 'muted'}>{TENANT_STATUS_LABEL[tenant.status]}</StatusBadge>
            <p className="text-xs text-muted-foreground">Tạm ngưng chưa bật được trong bản thử nghiệm.</p>
          </div>
          {problems.length > 0 && (
            <ul role="alert" className="space-y-1 text-sm text-support-negative">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || save.isPending} aria-busy={save.isPending || undefined}>
              {save.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
