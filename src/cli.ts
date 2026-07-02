#!/usr/bin/env bun
import { parseArgs } from 'util';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadViews, deriveTypes } from './views';
import { runView } from './view-runner';
import { fetchEverything, type FetchLike } from './fhir-client';
import { hydrateRelatedPersons } from './related-person';
import { render, type RenderContext } from './render';
import { anonymize } from './anon';
import { defaultTemplate } from './default-template';
import { defaultViews } from './default-views';
import {
  cacheKey,
  viewsetHash,
  defaultCacheDir,
  loadCache,
  saveCache,
  isFresh,
  parseDuration,
  mergeResources,
  maxLastUpdated,
  CACHE_VERSION,
  type CacheEntry,
} from './cache';
import type { Row } from './types';

const options = {
  patient: { type: 'string' },
  server: { type: 'string' },
  token: { type: 'string' },
  views: { type: 'string' },
  template: { type: 'string' },
  out: { type: 'string', default: '-' },
  since: { type: 'string' },
  'cache-dir': { type: 'string' },
  'max-age': { type: 'string' },
  'no-cache': { type: 'boolean', default: false },
  refresh: { type: 'boolean', default: false },
  anon: { type: 'boolean', default: false },
} as const;

export interface RunResult {
  markdown: string;
  out: string;
  /** How the resources were obtained, for the CLI to report. */
  source: 'full' | 'incremental' | 'cache-fresh' | 'no-cache';
  /** Whether anything changed since the cached state (false = nothing to do). */
  changed: boolean;
}

export async function run(argv: string[], fetchImpl?: FetchLike): Promise<RunResult> {
  const { values } = parseArgs({ args: argv, options });
  if (!values.patient || !values.server) {
    throw new Error('Both --patient and --server are required');
  }

  const views = values.views ? loadViews(values.views) : defaultViews;
  const types = deriveTypes(views);
  const token = values.token ?? process.env.TOKEMPIC_TOKEN;
  const fetchOpts = { server: values.server!, patient: values.patient!, types, token };

  let resources: unknown[];
  let source: RunResult['source'];
  let changed = true;

  if (values['no-cache']) {
    resources = await fetchEverything({ ...fetchOpts, since: values.since }, fetchImpl);
    await hydrateRelatedPersons(resources, { server: fetchOpts.server, token }, fetchImpl);
    source = 'no-cache';
  } else {
    const dir = values['cache-dir'] ?? defaultCacheDir();
    const path = join(dir, cacheKey(values.server!, values.patient!, viewsetHash(views)) + '.json');
    const entry = values.refresh ? null : loadCache(path);
    const maxAgeMs = values['max-age'] ? parseDuration(values['max-age']) : null;

    if (entry && maxAgeMs !== null && isFresh(entry, maxAgeMs, Date.now())) {
      // Fresh enough — skip the network entirely.
      resources = entry.resources;
      source = 'cache-fresh';
      changed = false;
    } else if (entry) {
      // Incremental: fetch only resources updated since the high-water mark.
      const deltas = await fetchEverything(
        { ...fetchOpts, since: entry.highWater ?? values.since },
        fetchImpl,
      );
      changed = deltas.length > 0;
      resources = changed ? mergeResources(entry.resources, deltas) : entry.resources;
      if (changed) await hydrateRelatedPersons(resources, { server: fetchOpts.server, token }, fetchImpl);
      source = 'incremental';
      const highWater = maxLastUpdated(resources) ?? entry.highWater;
      saveCache(path, { version: CACHE_VERSION, resources, highWater, fetchedAt: new Date().toISOString() });
    } else {
      // Cold cache (or --refresh): full fetch.
      resources = await fetchEverything({ ...fetchOpts, since: values.since }, fetchImpl);
      await hydrateRelatedPersons(resources, { server: fetchOpts.server, token }, fetchImpl);
      source = 'full';
      const out: CacheEntry = {
        version: CACHE_VERSION,
        resources,
        highWater: maxLastUpdated(resources),
        fetchedAt: new Date().toISOString(),
      };
      saveCache(path, out);
    }
  }

  const byView: Record<string, Row[]> = {};
  for (const v of views) byView[v.name] = runView(v, resources);
  if (values.anon) for (const v of views) byView[v.name] = anonymize(v, byView[v.name]);

  const ctx: RenderContext = { patient: byView['demographics']?.[0] ?? {}, views: byView };
  const template = values.template ? readFileSync(values.template, 'utf8') : defaultTemplate;
  const markdown = render(template, ctx);
  return { markdown, out: values.out!, source, changed };
}

if (import.meta.main) {
  const { markdown, out, source, changed } = await run(Bun.argv.slice(2));
  if (out === '-') process.stdout.write(markdown + '\n');
  else writeFileSync(out, markdown);
  if (source === 'incremental' && !changed) {
    process.stderr.write('tokempic: no changes on server — reused cached data\n');
  } else if (source === 'cache-fresh') {
    process.stderr.write('tokempic: cache is fresh (--max-age) — skipped server\n');
  }
}
