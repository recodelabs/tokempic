import { test, expect } from 'bun:test';
import { runView } from '../src/view-runner';
import type { ViewDefinition } from '../src/types';

test('runView unnests arrays with forEach', () => {
  const view: ViewDefinition = {
    name: 'names',
    resource: 'Patient',
    select: [{ forEach: 'name', select: [{ column: [{ name: 'family', path: 'family' }] }] }],
  };
  const resources = [
    { resourceType: 'Patient', name: [{ family: 'Smith' }, { family: 'Jones' }] },
  ];
  expect(runView(view, resources)).toEqual([{ family: 'Smith' }, { family: 'Jones' }]);
});
