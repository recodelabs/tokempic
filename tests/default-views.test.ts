import { test, expect } from 'bun:test';
import { join } from 'path';
import { readFileSync } from 'fs';
import { defaultViews } from '../src/default-views';
import { deriveTypes } from '../src/views';
import { run } from '../src/cli';
import type { FetchLike } from '../src/fhir-client';

test('defaultViews is the embedded 10-section set', () => {
  expect(defaultViews.length).toBe(10);
  const names = defaultViews.map((v) => v.name);
  expect(names).toContain('conditions');
  expect(names).toContain('labs');
  expect(names).toContain('relatedpersons');
  expect(deriveTypes(defaultViews)).toContain('Observation');
  expect(deriveTypes(defaultViews)).toContain('RelatedPerson');
});

test('run() uses the embedded views when --views is omitted', async () => {
  const bundle = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/everything-bundle.json'), 'utf8'));
  const fake: FetchLike = async () => ({
    ok: true, status: 200, async text() { return ''; }, async json() { return bundle; },
  });

  const { markdown } = await run(['--patient', 'p1', '--server', 'http://example.org/fhir', '--no-cache'], fake);

  expect(markdown).toContain('## conditions');
  expect(markdown).toContain('Hypertension');
  expect(markdown).toContain('HbA1c');
});
