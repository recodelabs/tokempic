import type { ViewDefinition } from './types';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export function deriveTypes(views: ViewDefinition[]): string[] {
  return [...new Set(views.map((v) => v.resource))];
}

export function loadViews(dir: string): ViewDefinition[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ViewDefinition);
}
