import { test, expect } from 'bun:test';
import { join } from 'path';
import { loadViews, deriveTypes } from '../src/views';

test('loadViews loads the default view set', () => {
  const views = loadViews(join(import.meta.dir, '../views'));
  const names = views.map((v) => v.name).sort();
  expect(names).toContain('conditions');
  expect(names).toContain('labs');
  expect(names).toContain('demographics');
  expect(deriveTypes(views)).toContain('Observation');
});
