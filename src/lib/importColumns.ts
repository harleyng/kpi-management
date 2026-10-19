/**
 * The column definition every Excel import template shares (WBS 4.4.3 — T4 owns the framework that
 * parses an uploaded file with it; T1 defined it first for the OrgData template, 4.1.7). One list
 * drives both the downloadable template and the parser, so a header can never drift between them.
 */

export type ImportCellKind = 'text' | 'date' | 'number';

export interface ImportColumn<Row> {
  /** The parsed row's field. */
  key: keyof Row & string;
  /** The header as written in the template (Vietnamese) — also `ImportRowError.column`. */
  header: string;
  /** Required on every row. A column required only sometimes says so in `hint`. */
  required: boolean;
  kind: ImportCellKind;
  /** One line under the header explaining the cell. */
  hint: string;
  /** The sample row's value. */
  example: string;
  /** Column width in characters. */
  width: number;
}

/** The header of `key`, for an `ImportRowError.column`. */
export function headerOf<Row>(columns: readonly ImportColumn<Row>[], key: keyof Row & string): string {
  const column = columns.find((c) => c.key === key);
  if (!column) throw new Error(`no import column for ${key}`);
  return column.header;
}
