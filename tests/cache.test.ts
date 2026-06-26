import { test, expect } from 'bun:test';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  resourceRef,
  maxLastUpdated,
  mergeResources,
  parseDuration,
  isFresh,
  cacheKey,
  loadCache,
  saveCache,
  type CacheEntry,
} from '../src/cache';
import { run } from '../src/cli';
import type { FetchLike } from '../src/fhir-client';

test('resourceRef builds type/id, null when incomplete', () => {
  expect(resourceRef({ resourceType: 'Condition', id: 'c1' })).toBe('Condition/c1');
  expect(resourceRef({ resourceType: 'Condition' })).toBeNull();
  expect(resourceRef('nope')).toBeNull();
});

test('maxLastUpdated returns the latest meta.lastUpdated regardless of order', () => {
  const rs = [
    { meta: { lastUpdated: '2024-01-01T00:00:00Z' } },
    { meta: { lastUpdated: '2026-06-26T10:00:00Z' } },
    { meta: { lastUpdated: '2025-03-03T00:00:00Z' } },
    { id: 'no-meta' },
  ];
  expect(maxLastUpdated(rs)).toBe('2026-06-26T10:00:00Z');
  expect(maxLastUpdated([{ id: 'x' }])).toBeNull();
});

test('mergeResources upserts by ref, preserves position, keeps unreferenced', () => {
  const cached = [
    { resourceType: 'Patient', id: 'p1', name: 'old' },
    { resourceType: 'Condition', id: 'c1', v: 1 },
    { weird: true },
  ];
  const deltas = [
    { resourceType: 'Condition', id: 'c1', v: 2 },
    { resourceType: 'Observation', id: 'o1' },
  ];
  expect(mergeResources(cached, deltas)).toEqual([
    { resourceType: 'Patient', id: 'p1', name: 'old' },
    { resourceType: 'Condition', id: 'c1', v: 2 },
    { resourceType: 'Observation', id: 'o1' },
    { weird: true },
  ]);
});

test('parseDuration handles units and bare seconds', () => {
  expect(parseDuration('30')).toBe(30_000);
  expect(parseDuration('30s')).toBe(30_000);
  expect(parseDuration('10m')).toBe(600_000);
  expect(parseDuration('2h')).toBe(7_200_000);
  expect(parseDuration('1d')).toBe(86_400_000);
  expect(() => parseDuration('soon')).toThrow();
});

test('isFresh compares fetchedAt + maxAge against now', () => {
  const e: CacheEntry = { version: 1, resources: [], highWater: null, fetchedAt: '2026-06-26T10:00:00Z' };
  const now = Date.parse('2026-06-26T10:05:00Z');
  expect(isFresh(e, 10 * 60_000, now)).toBe(true);
  expect(isFresh(e, 2 * 60_000, now)).toBe(false);
});

test('saveCache/loadCache round-trips, loadCache returns null when missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-cache-'));
  const key = cacheKey('http://h/fhir', 'p1', 'vh');
  const path = join(dir, key + '.json');
  expect(loadCache(path)).toBeNull();
  const entry: CacheEntry = {
    version: 1,
    resources: [{ resourceType: 'Patient', id: 'p1' }],
    highWater: '2026-06-26T10:00:00Z',
    fetchedAt: '2026-06-26T10:00:00Z',
  };
  saveCache(path, entry);
  expect(loadCache(path)).toEqual(entry);
});

// --- integration through run() ---

function fakeServerFor(pages: Record<string, unknown>) {
  const calls: string[] = [];
  const fake: FetchLike = async (url) => {
    calls.push(url);
    const body = pages[url] ?? { entry: [], link: [] };
    return { ok: true, status: 200, async text() { return ''; }, async json() { return body; } };
  };
  return { fake, calls };
}

const PATIENT = {
  resourceType: 'Patient',
  id: 'p1',
  name: [{ given: ['Ann'], family: 'Lee' }],
  birthDate: '1990-01-01',
  gender: 'female',
  meta: { lastUpdated: '2026-06-01T00:00:00Z' },
};

test('first run does a full fetch and writes a cache file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-cache-'));
  const { fake, calls } = fakeServerFor({
    [`http://h/fhir/Patient/p1/$everything?_type=Patient`]: {
      entry: [{ resource: PATIENT }],
      link: [],
    },
  });
  const { markdown } = await run(
    ['--patient', 'p1', '--server', 'http://h/fhir', '--cache-dir', dir,
     '--views', 'tests/fixtures/views-patient-only'],
    fake,
  );
  expect(markdown).toContain('Ann');
  expect(calls.length).toBe(1);
  expect(calls[0]).not.toContain('_since');
});

test('second run sends _since=highWater and reuses cache on an empty delta', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-cache-'));
  const base = ['--patient', 'p1', '--server', 'http://h/fhir', '--cache-dir', dir,
    '--views', 'tests/fixtures/views-patient-only'];

  const first = fakeServerFor({
    [`http://h/fhir/Patient/p1/$everything?_type=Patient`]: { entry: [{ resource: PATIENT }], link: [] },
  });
  await run(base, first.fake);

  // delta query returns nothing changed
  const second = fakeServerFor({});
  const { markdown } = await run(base, second.fake);
  expect(second.calls.length).toBe(1);
  expect(second.calls[0]).toContain('_since=2026-06-01T00%3A00%3A00Z');
  expect(markdown).toContain('Ann'); // still rendered from cache
});

test('--max-age skips the network entirely when the cache is fresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-cache-'));
  const base = ['--patient', 'p1', '--server', 'http://h/fhir', '--cache-dir', dir,
    '--views', 'tests/fixtures/views-patient-only'];
  const first = fakeServerFor({
    [`http://h/fhir/Patient/p1/$everything?_type=Patient`]: { entry: [{ resource: PATIENT }], link: [] },
  });
  await run(base, first.fake);

  const second = fakeServerFor({});
  const { markdown } = await run([...base, '--max-age', '1h'], second.fake);
  expect(second.calls.length).toBe(0);
  expect(markdown).toContain('Ann');
});
