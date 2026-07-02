import { test, expect } from 'bun:test';
import { anonymize } from '../src/anon';
import type { ViewDefinition } from '../src/types';

const demographics: ViewDefinition = {
  name: 'demographics',
  resource: 'Patient',
  select: [{ column: [
    { name: 'name', path: 'x' },
    { name: 'birthDate', path: 'x' },
    { name: 'gender', path: 'x' },
  ] }],
};

const relatedpersons: ViewDefinition = {
  name: 'relatedpersons',
  resource: 'RelatedPerson',
  select: [{ column: [
    { name: 'name', path: 'x' },
    { name: 'relationship', path: 'x' },
    { name: 'gender', path: 'x' },
    { name: 'birthDate', path: 'x' },
    { name: 'phone', path: 'x' },
  ] }],
};

test('patient name in demographics becomes the label "Patient"', () => {
  const rows = [{ name: 'George Jetson', birthDate: '1999-03-04', gender: 'male' }];
  expect(anonymize(demographics, rows)).toEqual([
    { name: 'Patient', birthDate: '1999', gender: 'male' },
  ]);
});

test('relative name and phone are dropped (null); relationship kept', () => {
  const rows = [{ name: 'Elroy Jetson', relationship: 'Parent of', gender: 'male', birthDate: '2025-04-01', phone: '555-1234' }];
  expect(anonymize(relatedpersons, rows)).toEqual([
    { name: null, relationship: 'Parent of', gender: 'male', birthDate: '2025', phone: null },
  ]);
});

test('clinical date columns are left untouched', () => {
  const conditions: ViewDefinition = {
    name: 'conditions', resource: 'Condition',
    select: [{ column: [
      { name: 'display', path: 'x' },
      { name: 'onset', path: 'x' },
    ] }],
  };
  const rows = [{ display: 'Hypertension', onset: '2024-04-12' }];
  expect(anonymize(conditions, rows)).toEqual([{ display: 'Hypertension', onset: '2024-04-12' }]);
});

test('pii:true redacts a column the heuristic would keep', () => {
  const view: ViewDefinition = {
    name: 'notes', resource: 'Observation',
    select: [{ column: [{ name: 'nickname', path: 'x', pii: true }] }],
  };
  expect(anonymize(view, [{ nickname: 'Sparky' }])).toEqual([{ nickname: null }]);
});

test('pii:false keeps a column the heuristic would redact', () => {
  const view: ViewDefinition = {
    name: 'contacts', resource: 'Patient',
    select: [{ column: [{ name: 'name', path: 'x', pii: false }] }],
  };
  expect(anonymize(view, [{ name: 'Public Org' }])).toEqual([{ name: 'Public Org' }]);
});

test('forEach nested columns are anonymized', () => {
  const view: ViewDefinition = {
    name: 'related', resource: 'RelatedPerson',
    select: [{ forEach: 'contact', select: [{ column: [
      { name: 'name', path: 'x' },
      { name: 'relationship', path: 'x' },
    ] }] }],
  };
  expect(anonymize(view, [{ name: 'Judy Jetson', relationship: 'Child of' }])).toEqual([
    { name: null, relationship: 'Child of' },
  ]);
});

test('does not mutate the input rows', () => {
  const rows = [{ name: 'George Jetson', gender: 'male' }];
  anonymize(demographics, rows);
  expect(rows[0].name).toBe('George Jetson');
});
