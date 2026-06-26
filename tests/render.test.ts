import { test, expect } from 'bun:test';
import { render } from '../src/render';

test('render fills sections from the view context', () => {
  const template =
    '# <%= it.patient.name %>\n<% it.views.conditions.forEach(function (c) { %>- <%= c.display %>\n<% }) %>';
  const out = render(template, {
    patient: { name: 'Jane Smith' },
    views: { conditions: [{ display: 'Hypertension' }, { display: 'Diabetes' }] },
  });
  expect(out).toContain('# Jane Smith');
  expect(out).toContain('- Hypertension');
  expect(out).toContain('- Diabetes');
});
