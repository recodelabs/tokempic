import { createHash } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { ViewDefinition } from './types';

export const CACHE_VERSION = 1;

export interface CacheEntry {
  version: number;
  /** Raw FHIR resources from the patient compartment, deduped by resourceType/id. */
  resources: unknown[];
  /** Highest meta.lastUpdated seen so far; used as the next `_since` floor. */
  highWater: string | null;
  /** Wall-clock time of the last server fetch (ISO 8601), for --max-age. */
  fetchedAt: string;
}

/** `ResourceType/id` for a resource, or null if either field is missing. */
export function resourceRef(r: unknown): string | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (typeof o.resourceType === 'string' && typeof o.id === 'string') {
    return `${o.resourceType}/${o.id}`;
  }
  return null;
}

function lastUpdatedOf(r: unknown): string | null {
  if (!r || typeof r !== 'object') return null;
  const meta = (r as Record<string, unknown>).meta;
  if (meta && typeof meta === 'object') {
    const lu = (meta as Record<string, unknown>).lastUpdated;
    if (typeof lu === 'string') return lu;
  }
  return null;
}

/** Latest meta.lastUpdated across resources (compared as instants), or null. */
export function maxLastUpdated(resources: unknown[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const r of resources) {
    const lu = lastUpdatedOf(r);
    if (!lu) continue;
    const ms = Date.parse(lu);
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      best = lu;
    }
  }
  return best;
}

/**
 * Upsert `deltas` into `cached` keyed by resourceRef. Existing refs are replaced
 * in place (insertion order preserved); new refs are appended. Resources without
 * a ref are retained as-is. Note: this never removes resources, so deletions on
 * the server are not reflected until a full --refresh.
 */
export function mergeResources(cached: unknown[], deltas: unknown[]): unknown[] {
  const map = new Map<string, unknown>();
  const unreferenced: unknown[] = [];
  for (const r of cached) {
    const ref = resourceRef(r);
    if (ref) map.set(ref, r);
    else unreferenced.push(r);
  }
  for (const r of deltas) {
    const ref = resourceRef(r);
    if (ref) map.set(ref, r);
    else unreferenced.push(r);
  }
  return [...map.values(), ...unreferenced];
}

/** Parse a duration like `30`, `30s`, `10m`, `2h`, `1d` into milliseconds. */
export function parseDuration(s: string): number {
  const m = /^(\d+)(s|m|h|d)?$/.exec(s.trim());
  if (!m) throw new Error(`Invalid duration: ${s} (use e.g. 30s, 10m, 2h, 1d)`);
  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  const mult = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return n * mult;
}

/** True if the cache was fetched within maxAgeMs of `nowMs`. */
export function isFresh(entry: CacheEntry, maxAgeMs: number, nowMs: number): boolean {
  const fetched = Date.parse(entry.fetchedAt);
  if (Number.isNaN(fetched)) return false;
  return fetched + maxAgeMs > nowMs;
}

/** Stable hash of a viewset so a changed --views invalidates the cache. */
export function viewsetHash(views: ViewDefinition[]): string {
  return createHash('sha256').update(JSON.stringify(views)).digest('hex').slice(0, 16);
}

/** Cache filename stem for a (server, patient, viewset) triple. */
export function cacheKey(server: string, patient: string, viewsetHash: string): string {
  return createHash('sha256')
    .update(`${server}\n${patient}\n${viewsetHash}`)
    .digest('hex')
    .slice(0, 32);
}

export function defaultCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg ? join(xdg, 'tokempic') : join(homedir(), '.cache', 'tokempic');
}

export function loadCache(path: string): CacheEntry | null {
  if (!existsSync(path)) return null;
  try {
    const entry = JSON.parse(readFileSync(path, 'utf8')) as CacheEntry;
    if (entry.version !== CACHE_VERSION) return null;
    return entry;
  } catch {
    return null;
  }
}

export function saveCache(path: string, entry: CacheEntry): void {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(entry));
}
