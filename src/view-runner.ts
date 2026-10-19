import fhirpath, { type UserInvocationTable } from 'fhirpath';
import r4 from 'fhirpath/fhir-context/r4';
import type { ViewDefinition, SelectClause, Column, Constant, Row } from './types';

// A SQL-on-FHIR v2 ViewDefinition evaluator over fhirpath.js. The R4 model is
// loaded so choice elements resolve the spec way (`value.ofType(Quantity)`),
// and iteration keeps fhirpath.js's typed nodes so that also works inside
// `forEach` (e.g. `component.value.ofType(Quantity)`).

type Env = Record<string, unknown>;

interface Reference {
  reference?: string;
}

const userInvocationTable: UserInvocationTable = {
  getResourceKey: {
    fn: (nodes: { id?: string }[]) => nodes.map((n) => n.id),
    arity: { 0: [] },
  },
  getReferenceKey: {
    fn: (nodes: Reference[], type?: { name?: string }) =>
      nodes.flatMap((n) => {
        const parts = (n.reference ?? '').split('/_history')[0].split('/');
        const [refType, key] = parts.slice(-2);
        if (!key || (type?.name && type.name !== refType)) return [];
        return [key];
      }),
    arity: { 0: [], 1: ['TypeSpecifier'] },
  },
};

function evaluate(node: unknown, path: string, env: Env, typed = false): unknown[] {
  return fhirpath.evaluate(node, path, env, r4, {
    resolveInternalTypes: !typed,
    userInvocationTable,
  }) as unknown[];
}

/** A FHIRPath date/time literal's typed value, so a constant compares as a date rather than a string. */
function temporal(literal: string): unknown {
  return (fhirpath.evaluate(null, literal, {}, r4, { resolveInternalTypes: false }) as unknown[])[0];
}

/** `%name` values for the view's constants. */
function constantEnv(constants: Constant[] = []): Env {
  const env: Env = {};
  for (const c of constants) {
    const key = Object.keys(c).find((k) => k.startsWith('value'));
    if (!key) throw new Error(`constant ${c.name} has no value`);
    const v = c[key];
    if (key === 'valueDate' || key === 'valueDateTime' || key === 'valueInstant') env[c.name] = temporal(`@${v}`);
    else if (key === 'valueTime') env[c.name] = temporal(`@T${v}`);
    else env[c.name] = v;
  }
  return env;
}

/** Output column names of a clause, in output order: column, select, then unionAll. */
export function columnNames(clause: SelectClause): string[] {
  const names = (clause.column ?? []).map((c) => c.name);
  for (const s of clause.select ?? []) names.push(...columnNames(s));
  if (clause.unionAll?.length) {
    const branches = clause.unionAll.map(columnNames);
    const first = JSON.stringify(branches[0]);
    if (branches.some((b) => JSON.stringify(b) !== first)) {
      throw new Error(`unionAll branches have different columns: ${branches.map((b) => b.join(',')).join(' / ')}`);
    }
    names.push(...branches[0]);
  }
  return names;
}

function validate(view: ViewDefinition): void {
  if (!view.resource) throw new Error(`view ${view.name ?? ''} has no resource`);
  const check = (clause: SelectClause) => {
    const iterations = [clause.forEach, clause.forEachOrNull, clause.repeat].filter((x) => x !== undefined);
    if (iterations.length > 1) throw new Error('a select may use only one of forEach, forEachOrNull and repeat');
    for (const c of clause.column ?? []) {
      if (!c.name || !c.path) throw new Error('every column needs a name and a path');
    }
    for (const s of [...(clause.select ?? []), ...(clause.unionAll ?? [])]) check(s);
  };
  for (const s of view.select) check(s);
  const names = view.select.flatMap(columnNames);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`column ${dup} is defined more than once`);
}

/** Cartesian product of row sets, merging each combination into one row. */
function product(parts: Row[][]): Row[] {
  return parts.reduce<Row[]>((rows, part) => rows.flatMap((r) => part.map((p) => ({ ...r, ...p }))), [{}]);
}

class Evaluator {
  constructor(
    private view: ViewDefinition,
    private constants: Env,
    private resource: { resourceType?: string; id?: string },
  ) {}

  private column(col: Column, node: unknown, env: Env): unknown {
    const values = evaluate(node, col.path, env);
    if (col.collection) return values;
    if (values.length > 1) {
      const { resourceType, id } = this.resource;
      throw new Error(
        `view ${this.view.name}, column ${col.name}: \`${col.path}\` returned ${values.length} values ` +
          `for ${resourceType}/${id}; narrow it (e.g. first()) or mark the column collection`,
      );
    }
    return values.length ? values[0] : null;
  }

  /** Rows for one clause on one node: its own columns, nested selects and unionAll, combined. */
  private project(clause: SelectClause, node: unknown, env: Env): Row[] {
    const parts: Row[][] = [];
    if (clause.column) {
      parts.push([Object.fromEntries(clause.column.map((c) => [c.name, this.column(c, node, env)]))]);
    }
    for (const s of clause.select ?? []) parts.push(this.select(s, node, env));
    if (clause.unionAll) parts.push(clause.unionAll.flatMap((u) => this.select(u, node, env)));
    return product(parts);
  }

  /** Every node reached by repeatedly applying the paths, depth first, excluding the start. */
  private repeat(paths: string[], node: unknown, env: Env): unknown[] {
    const out: unknown[] = [];
    const walk = (n: unknown) => {
      for (const p of paths) {
        for (const child of evaluate(n, p, env, true)) {
          out.push(child);
          walk(child);
        }
      }
    };
    walk(node);
    return out;
  }

  select(clause: SelectClause, node: unknown, env: Env): Row[] {
    let nodes: unknown[];
    if (clause.forEach !== undefined) nodes = evaluate(node, clause.forEach, env, true);
    else if (clause.forEachOrNull !== undefined) nodes = evaluate(node, clause.forEachOrNull, env, true);
    else if (clause.repeat !== undefined) nodes = this.repeat(clause.repeat, node, env);
    else return this.project(clause, node, env);

    // forEachOrNull over nothing still emits one row, its columns null.
    if (nodes.length === 0 && clause.forEachOrNull !== undefined) nodes = [{}];
    return nodes.flatMap((n, i) => this.project(clause, n, { ...env, rowIndex: i }));
  }

  passesWhere(): boolean {
    return (this.view.where ?? []).every((w) => {
      const result = evaluate(this.resource, w.path, this.env());
      if (result.length > 1 || (result.length === 1 && typeof result[0] !== 'boolean')) {
        throw new Error(`view ${this.view.name}: where \`${w.path}\` must return a single boolean`);
      }
      return result[0] === true;
    });
  }

  env(): Env {
    return { ...this.constants, rowIndex: 0 };
  }
}

export function runView(view: ViewDefinition, resources: unknown[]): Row[] {
  validate(view);
  const constants = constantEnv(view.constant);
  const rows: Row[] = [];
  for (const r of resources as { resourceType?: string; id?: string }[]) {
    if (r.resourceType !== view.resource) continue;
    const ev = new Evaluator(view, constants, r);
    if (!ev.passesWhere()) continue;
    rows.push(...product(view.select.map((s) => ev.select(s, r, ev.env()))));
  }
  return rows;
}
