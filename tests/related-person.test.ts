import { test, expect } from 'bun:test';
import { hydrateRelatedPersons, RELATED_PERSON_PATIENT_SYSTEM } from '../src/related-person';
import type { FetchLike } from '../src/fhir-client';

function linkedRelatedPerson(id: string) {
  return {
    resourceType: 'RelatedPerson',
    identifier: [{ system: RELATED_PERSON_PATIENT_SYSTEM, value: id }],
    relationship: [{ coding: [{ display: 'Parent of' }] }],
  };
}

test('hydrates a name-less RelatedPerson from its linked Patient', async () => {
  const resources: unknown[] = [linkedRelatedPerson('micah-id')];
  const calls: string[] = [];
  const fake: FetchLike = async (url) => {
    calls.push(url);
    return {
      ok: true, status: 200, async text() { return ''; },
      async json() {
        return { resourceType: 'Patient', id: 'micah-id', name: [{ given: ['Micah'], family: 'Berg' }], gender: 'male', birthDate: '2025-04-01' };
      },
    };
  };

  await hydrateRelatedPersons(resources, { server: 'http://x/fhir' }, fake);

  const rp = resources[0] as { name?: unknown; gender?: unknown; birthDate?: unknown };
  expect(rp.name).toEqual([{ given: ['Micah'], family: 'Berg' }]);
  expect(rp.gender).toBe('male');
  expect(rp.birthDate).toBe('2025-04-01');
  // Direct GET by id, not a search.
  expect(calls).toEqual(['http://x/fhir/Patient/micah-id']);
});

test('does not add the linked Patient to the resource pool', async () => {
  const resources: unknown[] = [linkedRelatedPerson('micah-id')];
  const fake: FetchLike = async () => ({
    ok: true, status: 200, async text() { return ''; },
    async json() { return { resourceType: 'Patient', id: 'micah-id', name: [{ given: ['Micah'], family: 'Berg' }] }; },
  });

  await hydrateRelatedPersons(resources, { server: 'http://x/fhir' }, fake);

  expect(resources.length).toBe(1);
  expect((resources[0] as { resourceType: string }).resourceType).toBe('RelatedPerson');
});

test('skips the network when nothing needs resolving', async () => {
  const named = { resourceType: 'RelatedPerson', name: [{ given: ['Jane'], family: 'Doe' }] };
  const resources: unknown[] = [named];
  let called = false;
  const fake: FetchLike = async () => { called = true; throw new Error('should not fetch'); };

  await hydrateRelatedPersons(resources, { server: 'http://x/fhir' }, fake);

  expect(called).toBe(false);
});

test('de-dupes Patient fetches when two RelatedPersons share a link', async () => {
  const resources: unknown[] = [linkedRelatedPerson('shared'), linkedRelatedPerson('shared')];
  let fetches = 0;
  const fake: FetchLike = async () => {
    fetches++;
    return {
      ok: true, status: 200, async text() { return ''; },
      async json() { return { resourceType: 'Patient', id: 'shared', name: [{ given: ['Sam'], family: 'Berg' }] }; },
    };
  };

  await hydrateRelatedPersons(resources, { server: 'http://x/fhir' }, fake);

  expect(fetches).toBe(1);
});
