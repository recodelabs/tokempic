import { Eta } from 'eta';
import type { Row } from './types';

export interface RenderContext {
  patient: Row;
  views: Record<string, Row[]>;
}

export function render(template: string, ctx: RenderContext): string {
  const eta = new Eta({ autoEscape: false, autoTrim: false });
  return eta.renderString(template, ctx);
}
