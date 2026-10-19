import { test, expect } from 'bun:test';
import { defaultViews } from '../src/default-views';
import { runView } from '../src/view-runner';
import type { ViewDefinition } from '../src/types';

// What the built-in views pull out of record shapes common in real data:
// choice types other than the one-off test fixture's, panels, and statuses.

const view = (name: string): ViewDefinition => defaultViews.find((v) => v.name === name)!;

test('every built-in view is a ViewDefinition', () => {
  for (const v of defaultViews) {
    expect(v.resourceType).toBe('ViewDefinition');
    expect(v.status).toBe('active');
  }
});

test('vitals: a blood pressure panel gives one row per component', () => {
  const bp = {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ code: 'vital-signs' }] }],
    code: { coding: [{ code: '85354-9', display: 'Blood pressure panel' }] },
    effectiveDateTime: '2026-05-01',
    component: [
      { code: { coding: [{ code: '8480-6', display: 'Systolic blood pressure' }] }, valueQuantity: { value: 128, unit: 'mmHg' } },
      { code: { coding: [{ code: '8462-4', display: 'Diastolic blood pressure' }] }, valueQuantity: { value: 82, unit: 'mmHg' } },
    ],
  };
  expect(runView(view('vitals'), [bp])).toEqual([
    { date: '2026-05-01', code: '8480-6', display: 'Systolic blood pressure', value: 128, unit: 'mmHg' },
    { date: '2026-05-01', code: '8462-4', display: 'Diastolic blood pressure', value: 82, unit: 'mmHg' },
  ]);
});

test('labs: coded results, period dates and flags are kept; entered-in-error is dropped', () => {
  const coded = {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ code: 'laboratory' }] }],
    code: { text: 'HIV 1+2 Ab' },
    effectivePeriod: { start: '2026-04-02T09:00:00Z' },
    valueCodeableConcept: { coding: [{ code: '260385009', display: 'Negative' }] },
  };
  const flagged = {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ code: 'laboratory' }] }],
    code: { coding: [{ code: '4548-4', display: 'HbA1c' }] },
    effectiveDateTime: '2026-04-02',
    valueQuantity: { value: 8.1, code: '%' },
    interpretation: [{ coding: [{ code: 'H' }] }],
  };
  const error = { ...flagged, status: 'entered-in-error', valueQuantity: { value: 81, unit: '%' } };
  expect(runView(view('labs'), [coded, flagged, error])).toEqual([
    { date: '2026-04-02T09:00:00Z', code: null, display: 'HIV 1+2 Ab', value: 'Negative', unit: null, flag: null },
    { date: '2026-04-02', code: '4548-4', display: 'HbA1c', value: 8.1, unit: '%', flag: 'H' },
  ]);
});

test('conditions: onsetPeriod gives the onset; refuted and entered-in-error are dropped', () => {
  const condition = (verification: string) => ({
    resourceType: 'Condition',
    code: { coding: [{ code: '38341003' }], text: 'High blood pressure' },
    clinicalStatus: { coding: [{ code: 'active' }] },
    verificationStatus: { coding: [{ code: verification }] },
    onsetPeriod: { start: '2024-04-12' },
  });
  expect(runView(view('conditions'), ['confirmed', 'refuted', 'entered-in-error'].map(condition))).toEqual([
    { code: '38341003', display: 'High blood pressure', clinicalStatus: 'active', verificationStatus: 'confirmed', onset: '2024-04-12' },
  ]);
});

test('procedures: performedPeriod gives the date', () => {
  const procedure = {
    resourceType: 'Procedure', status: 'completed',
    code: { coding: [{ code: '40701008', display: 'Echocardiography' }] },
    performedPeriod: { start: '2005-10-28T16:17:05+00:00', end: '2005-10-28T17:00:00+00:00' },
  };
  expect(runView(view('procedures'), [procedure])).toEqual([
    { code: '40701008', display: 'Echocardiography', status: 'completed', performed: '2005-10-28T16:17:05+00:00' },
  ]);
});

test('medications: a medicationReference uses its display; cancelled is dropped', () => {
  const byReference = {
    resourceType: 'MedicationRequest', status: 'active',
    medicationReference: { reference: 'Medication/m1', display: 'Metformin 500 MG' },
    dosageInstruction: [{ text: 'twice daily' }],
    authoredOn: '2026-01-10',
  };
  const cancelled = { ...byReference, status: 'cancelled', medicationReference: { display: 'Aspirin' } };
  expect(runView(view('medications'), [byReference, cancelled])).toEqual([
    { medication: 'Metformin 500 MG', dose: 'twice daily', status: 'active', authoredOn: '2026-01-10' },
  ]);
});

test('demographics: the official name is preferred', () => {
  const patient = {
    resourceType: 'Patient', gender: 'male', birthDate: '1990-02-03',
    name: [{ use: 'nickname', given: ['Bob'] }, { use: 'official', given: ['Robert', 'James'], family: 'Smith' }],
  };
  expect(runView(view('demographics'), [patient])).toEqual([
    { name: 'Robert Smith', birthDate: '1990-02-03', gender: 'male' },
  ]);
});
