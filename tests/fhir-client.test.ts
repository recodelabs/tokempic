import { test, expect } from 'bun:test';
import { fetchEverything, type FetchLike } from '../src/fhir-client';

test('fetchEverything builds the URL, sends auth, and follows pagination', async () => {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const pages: Record<string, unknown> = {
    'http://h/fhir/Patient/p1/$everything?_type=Condition%2CObservation': {
      entry: [{ resource: { resourceType: 'Condition', id: 'c1' } }],
      link: [{ relation: 'next', url: 'http://h/fhir/page2' }],
    },
    'http://h/fhir/page2': {
      entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }],
      link: [],
    },
  };
  const fake: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    return { ok: true, status: 200, async text() { return ''; }, async json() { return pages[url]; } };
  };

  const resources = await fetchEverything(
    { server: 'http://h/fhir', patient: 'p1', types: ['Condition', 'Observation'], token: 'abc' },
    fake,
  );

  expect(resources).toEqual([
    { resourceType: 'Condition', id: 'c1' },
    { resourceType: 'Observation', id: 'o1' },
  ]);
  expect(calls[0].url).toContain('_type=Condition%2CObservation');
  expect(calls[0].headers?.Authorization).toBe('Bearer abc');
  expect(calls.length).toBe(2);
});

test('fetchEverything throws on a non-OK response', async () => {
  const fake: FetchLike = async () => ({
    ok: false, status: 404, async text() { return 'not found'; }, async json() { return {}; },
  });
  await expect(
    fetchEverything({ server: 'http://h/fhir', patient: 'p1', types: [] }, fake),
  ).rejects.toThrow('404');
});
