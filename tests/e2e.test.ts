import { test, expect } from 'bun:test';
import { join } from 'path';
import { readFileSync } from 'fs';
import { run } from '../src/cli';
import type { FetchLike } from '../src/fhir-client';

test('end-to-end renders markdown from an $everything bundle', async () => {
  const bundle = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/everything-bundle.json'), 'utf8'));
  const fake: FetchLike = async () => ({
    ok: true, status: 200, async text() { return ''; }, async json() { return bundle; },
  });

  const { markdown } = await run(
    ['--patient', 'p1', '--server', 'http://example.org/fhir', '--views', join(import.meta.dir, '../views')],
    fake,
  );

  expect(markdown).toContain('Jane Smith');
  expect(markdown).toContain('## conditions');
  expect(markdown).toContain('Hypertension');
  expect(markdown).toContain('## labs');
  expect(markdown).toContain('HbA1c');
});
