import { useId, useState } from 'react';
import { Bug, Loader2, TriangleAlert } from 'lucide-react';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSetFailureMode } from '@/hooks/queries/dev';
import { useDevStore } from '@/lib/devStore';
import { toastError } from '@/components/shared/toastError';

/** Radix Select refuses an empty value, so "every call" is a sentinel that maps to no pattern. */
const ALL = 'all';

const SCOPES: { value: string; label: string }[] = [
  { value: ALL, label: 'Mọi thao tác' },
  { value: 'org.*', label: 'Chỉ nhóm Tổ chức' },
  { value: 'library.*', label: 'Chỉ nhóm Thư viện' },
  { value: 'goals.*', label: 'Chỉ nhóm Mục tiêu' },
  { value: 'actuals.*', label: 'Chỉ nhóm Số liệu' },
  { value: 'forms.*', label: 'Chỉ nhóm Biểu mẫu' },
  { value: 'results.*', label: 'Chỉ nhóm Kết quả' },
];

const patternOf = (scope: string) => (scope === ALL ? null : scope);

/** Make gateway calls fail — all of them, or one group's — to see the error screens. */
export function DevFailureSection() {
  const failure = useDevStore((s) => s.failure);
  const setFailureMode = useSetFailureMode();
  // The scope picked while the failure is off is this panel's own choice until it is switched on.
  const [scope, setScope] = useState(failure.methodPattern ?? ALL);
  const scopeId = useId();
  const switchId = useId();
  const hintId = useId();

  const apply = (enabled: boolean, nextScope: string) => {
    setFailureMode.mutateAsync({ enabled, methodPattern: enabled ? patternOf(nextScope) : null }).catch(toastError);
  };

  return (
    <section className="space-y-2">
      <SectionTitle icon={Bug} title="Giả lập lỗi">
        <span id={hintId}>Mọi lệnh gọi khớp sẽ báo lỗi để xem màn hình lỗi.</span>
      </SectionTitle>

      <div className="space-y-1">
        <Label htmlFor={scopeId}>Áp dụng cho</Label>
        <Select
          value={scope}
          disabled={setFailureMode.isPending}
          onValueChange={(next) => {
            setScope(next);
            // Already failing: move the failure to the new scope at once.
            if (failure.enabled) apply(true, next);
          }}
        >
          <SelectTrigger id={scopeId} className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={failure.enabled}
          disabled={setFailureMode.isPending}
          aria-busy={setFailureMode.isPending || undefined}
          aria-describedby={hintId}
          onCheckedChange={(checked) => apply(checked, scope)}
        />
        <Label htmlFor={switchId} className="text-sm font-normal text-foreground">
          Bật giả lập lỗi
        </Label>
        {setFailureMode.isPending && <Loader2 className="h-4 w-4 text-muted-foreground motion-safe:animate-spin" aria-hidden />}
      </div>

      {failure.enabled && (
        <p role="status" className="flex items-center gap-1.5 text-xs font-medium">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-support-warning" aria-hidden />
          <span>
            Đang giả lập lỗi: {failure.methodPattern ? <code className="font-mono">{failure.methodPattern}</code> : 'mọi thao tác'}
          </span>
        </p>
      )}
    </section>
  );
}
