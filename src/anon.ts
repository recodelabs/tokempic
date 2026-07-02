import type { ViewDefinition, SelectClause, Column, Row } from './types';

/** Lowercased column names treated as PII by default; intentionally non-exhaustive — the per-column `pii` flag is the escape hatch. */
const PII_NAMES = new Set([
  'name', 'given', 'family', 'prefix', 'suffix',
  'phone', 'mobile', 'telecom', 'email', 'contact',
  'address', 'line', 'city', 'postalcode',
  'ssn', 'mrn', 'identifier', 'nationalid', 'passport',
]);

type Action = 'redact' | 'year' | 'keep';

function isBirthDate(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('birth') || n === 'dob';
}

function actionFor(col: Column): Action {
  if (col.pii === true) return 'redact';   // explicit override always wins
  if (col.pii === false) return 'keep';
  if (isBirthDate(col.name)) return 'year';
  return PII_NAMES.has(col.name.toLowerCase()) ? 'redact' : 'keep';
}

/** Walk select + nested forEach select, recording an action per column name. */
function collectActions(select: SelectClause[], into: Map<string, Action>): void {
  for (const clause of select) {
    if (clause.column) for (const col of clause.column) into.set(col.name, actionFor(col));
    if (clause.select) collectActions(clause.select, into);
  }
}

/** Leading 4-digit year of a date-like string, or null if there isn't one. */
function yearOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})\b/);
  return m ? m[1] : null;
}

/**
 * De-identify a view's rows: PII columns become 'Patient' in the demographics
 * view (which feeds the header) or null elsewhere; birth-date columns are
 * reduced to their year. Returns new rows; the input is not mutated.
 */
export function anonymize(view: ViewDefinition, rows: Row[]): Row[] {
  const actions = new Map<string, Action>();
  collectActions(view.select, actions);
  const isDemographics = view.name === 'demographics';

  return rows.map((row) => {
    const next: Row = { ...row };
    const redacted = isDemographics ? 'Patient' : null;
    for (const [name, action] of actions) {
      if (!(name in next)) continue;
      if (action === 'keep') continue;
      if (action === 'year') next[name] = yearOf(next[name]) ?? redacted;
      else next[name] = redacted; // action === 'redact'
    }
    return next;
  });
}
