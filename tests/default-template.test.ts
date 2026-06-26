import { test, expect } from 'bun:test';
import { defaultTemplate } from '../src/default-template';
import { render } from '../src/render';

test('default template is embedded and renders', () => {
  expect(defaultTemplate).toContain('Patient Summary');
  const out = render(defaultTemplate, { patient: { name: 'Jane Smith' }, views: { conditions: [{ display: 'Hypertension' }] } });
  expect(out).toContain('Jane Smith');
  expect(out).toContain('Hypertension');
});
