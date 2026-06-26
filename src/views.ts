import type { ViewDefinition } from './types';

export function deriveTypes(views: ViewDefinition[]): string[] {
  return [...new Set(views.map((v) => v.resource))];
}
