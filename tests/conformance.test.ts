import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { runView, columnNames } from '../src/view-runner';
import type { ViewDefinition } from '../src/types';

// The official SQL-on-FHIR v2 content tests (tests/spec, see SOURCE.md).

interface Case {
  title: string;
  view: ViewDefinition;
  expect?: Record<string, unknown>[];
  expectColumns?: string[];
  expectError?: boolean;
}

const dir = join(import.meta.dir, 'spec');

// Cases fhirpath.js gets wrong, not the evaluator. A JSON decimal like 1.0
// reaches JavaScript as 1, losing the precision lowBoundary()/highBoundary()
// depend on, and fhirpath.js leaves a dateTime with no offset without the
// +14:00/-12:00 the spec gives its boundaries. bun reports these if they start
// passing.
const KNOWN_FAILURES = new Set([
  'fn_boundary.json > decimal lowBoundary',
  'fn_boundary.json > decimal highBoundary',
  'fn_boundary.json > datetime lowBoundary',
  'fn_boundary.json > datetime highBoundary',
]);

/** Rows as a sorted list of canonical strings: the spec does not fix row order. */
function unordered(rows: Record<string, unknown>[]): string[] {
  const canon = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : Array.isArray(v) ? v.map(canon) : v;
  return rows.map((r) => JSON.stringify(canon(r))).sort();
}

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const suite = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { resources: unknown[]; tests: Case[] };
  describe(file, () => {
    for (const c of suite.tests) {
      const run = KNOWN_FAILURES.has(`${file} > ${c.title}`) ? test.failing : test;
      run(c.title, () => {
        if (c.expectError) {
          expect(() => runView(c.view, suite.resources)).toThrow();
          return;
        }
        const rows = runView(c.view, suite.resources);
        if (c.expect) expect(unordered(rows)).toEqual(unordered(c.expect));
        if (c.expectColumns) expect(c.view.select.flatMap(columnNames)).toEqual(c.expectColumns);
      });
    }
  });
}
