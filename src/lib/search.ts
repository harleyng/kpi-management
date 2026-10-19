import { foldDiacritics } from './utils';

/**
 * Free-text matching for pickers and table filters — diacritic-insensitive on BOTH sides
 * (common-pitfalls.md: "nguyen" must find "Nguyễn", "doanh thu" must find "Doanh thu").
 *
 * Every word of the query must appear somewhere in the fields (AND across words, any field per
 * word), so "kd hn" finds "Phòng Kinh doanh — Hà Nội" only if both fragments occur. A blank query
 * matches everything: an empty search box filters nothing.
 */
export function matchesSearch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const words = foldDiacritics(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => typeof field === 'string' && field.length > 0)
    .map(foldDiacritics)
    .join('\n');
  return words.every((word) => haystack.includes(word));
}
