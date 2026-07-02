import type { ViewDefinition, SelectClause, Column, Row } from './types';

/** Lowercased column names that are treated as PII by default. */
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

function isPii(col: Column): boolean {
  if (col.pii === true) return true;
  if (col.pii === false) return false;
  return PII_NAMES.has(col.name.toLowerCase());
}

function actionFor(col: Column): Action {
  if (isBirthDate(col.name)) return 'year';
  if (isPii(col)) return 'redact';
  return 'keep';
}

/** Walk select + nested forEach select, recording an action per column name. */
function collectActions(select: SelectClause[], into: Map<string, Action>): void {
  for (const clause of select) {
    if (clause.column) for (const col of clause.column) into.set(col.name, actionFor(col));
    if (clause.select) collectActions(clause.select, into);
  }
}

/** Keep only the leading 4-digit year of a date-like string; pass anything else through. */
function toYear(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const m = value.match(/^(\d{4})/);
  return m ? m[1] : value;
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
    for (const [name, action] of actions) {
      if (!(name in next)) continue;
      if (action === 'year') next[name] = toYear(next[name]);
      else if (action === 'redact') next[name] = isDemographics ? 'Patient' : null;
    }
    return next;
  });
}
