import fhirpath from 'fhirpath';
import type { ViewDefinition, SelectClause, WhereClause, Row } from './types';

function evalScalar(node: unknown, path: string): unknown {
  const result = fhirpath.evaluate(node, path);
  return result.length === 0 ? null : result[0];
}

function passesWhere(resource: unknown, where: WhereClause[] = []): boolean {
  return where.every((w) => fhirpath.evaluate(resource, w.path)[0] === true);
}

export function projectSelect(node: unknown, select: SelectClause[]): Row[] {
  let rows: Row[] = [{}];
  for (const clause of select) {
    if (clause.column) {
      rows = rows.map((row) => {
        const next: Row = { ...row };
        for (const col of clause.column!) next[col.name] = evalScalar(node, col.path);
        return next;
      });
    }
  }
  return rows;
}

export function runView(view: ViewDefinition, resources: unknown[]): Row[] {
  const matching = resources.filter(
    (r) => (r as { resourceType?: string }).resourceType === view.resource && passesWhere(r, view.where),
  );
  return matching.flatMap((r) => projectSelect(r, view.select));
}
