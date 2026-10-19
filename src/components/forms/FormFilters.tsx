import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FORM_STATUSES, FORM_STATUS_LABEL, FORM_TYPES, FORM_TYPE_LABEL, type FormStatus, type FormType } from '@/data/types';

const ALL = 'all';

/** "Loại phiếu" filter — `null` = every type. */
export function FormTypeSelect({ value, onChange, types = FORM_TYPES }: { value: FormType | null; onChange: (v: FormType | null) => void; types?: readonly FormType[] }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : (v as FormType))}>
      <SelectTrigger className="h-8 w-44" aria-label="Loại phiếu">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Mọi loại phiếu</SelectItem>
        {types.map((t) => (
          <SelectItem key={t} value={t}>
            {FORM_TYPE_LABEL[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Trạng thái" filter — `null` = every status. */
export function FormStatusSelect({ value, onChange }: { value: FormStatus | null; onChange: (v: FormStatus | null) => void }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : (v as FormStatus))}>
      <SelectTrigger className="h-8 w-40" aria-label="Trạng thái phiếu">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Mọi trạng thái</SelectItem>
        {FORM_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {FORM_STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
