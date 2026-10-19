import { test, expect } from 'bun:test';
import { runView } from '../src/view-runner';
import type { ViewDefinition } from '../src/types';

test('runView projects matching resources into rows', () => {
  const view: ViewDefinition = {
    name: 'conditions',
    resource: 'Condition',
    select: [{ column: [
      { name: 'code', path: 'code.coding.first().code' },
      { name: 'display', path: 'code.coding.first().display' },
    ] }],
  };
  const resources = [
    { resourceType: 'Condition', code: { coding: [{ code: 'I10', display: 'Hypertension' }] } },
    { resourceType: 'Observation', code: { coding: [{ code: 'x' }] } },
  ];
  expect(runView(view, resources)).toEqual([{ code: 'I10', display: 'Hypertension' }]);
});

test('runView refuses a column that returns several values, naming the resource', () => {
  const view: ViewDefinition = {
    name: 'names', resource: 'Patient',
    select: [{ column: [{ name: 'given', path: 'name.given' }] }],
  };
  const resources = [{ resourceType: 'Patient', id: 'p1', name: [{ given: ['Ann', 'Marie'] }] }];
  expect(() => runView(view, resources)).toThrow('view names, column given: `name.given` returned 2 values for Patient/p1');
});

test('runView returns every value of a collection column', () => {
  const view: ViewDefinition = {
    name: 'names', resource: 'Patient',
    select: [{ column: [{ name: 'given', path: 'name.given', collection: true }] }],
  };
  const resources = [{ resourceType: 'Patient', id: 'p1', name: [{ given: ['Ann', 'Marie'] }] }];
  expect(runView(view, resources)).toEqual([{ given: ['Ann', 'Marie'] }]);
});

test('runView applies where filters', () => {
  const view: ViewDefinition = {
    name: 'labs',
    resource: 'Observation',
    where: [{ path: "category.coding.where(code='laboratory').exists()" }],
    select: [{ column: [{ name: 'code', path: 'code.coding.first().code' }] }],
  };
  const resources = [
    { resourceType: 'Observation', category: [{ coding: [{ code: 'laboratory' }] }], code: { coding: [{ code: '4548-4' }] } },
    { resourceType: 'Observation', category: [{ coding: [{ code: 'vital-signs' }] }], code: { coding: [{ code: '8867-4' }] } },
  ];
  expect(runView(view, resources)).toEqual([{ code: '4548-4' }]);
});
