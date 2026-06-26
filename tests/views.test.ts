import { test, expect } from 'bun:test';
import { deriveTypes } from '../src/views';
import type { ViewDefinition } from '../src/types';

test('deriveTypes returns unique resource types preserving first-seen order', () => {
  const views: ViewDefinition[] = [
    { name: 'a', resource: 'Observation', select: [] },
    { name: 'b', resource: 'Condition', select: [] },
    { name: 'c', resource: 'Observation', select: [] },
  ];
  expect(deriveTypes(views)).toEqual(['Observation', 'Condition']);
});
