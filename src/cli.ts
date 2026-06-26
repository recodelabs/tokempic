#!/usr/bin/env bun
import { parseArgs } from 'util';
import { readFileSync, writeFileSync } from 'fs';
import { loadViews, deriveTypes } from './views';
import { runView } from './view-runner';
import { fetchEverything, type FetchLike } from './fhir-client';
import { render, type RenderContext } from './render';
import { defaultTemplate } from './default-template';
import type { Row } from './types';

const options = {
  patient: { type: 'string' },
  server: { type: 'string' },
  token: { type: 'string' },
  views: { type: 'string', default: './views' },
  template: { type: 'string' },
  out: { type: 'string', default: '-' },
  since: { type: 'string' },
} as const;

export async function run(argv: string[], fetchImpl?: FetchLike): Promise<{ markdown: string; out: string }> {
  const { values } = parseArgs({ args: argv, options });
  if (!values.patient || !values.server) {
    throw new Error('Both --patient and --server are required');
  }

  const views = loadViews(values.views!);
  const types = deriveTypes(views);
  const resources = await fetchEverything(
    {
      server: values.server!,
      patient: values.patient!,
      types,
      token: values.token ?? process.env.TOKEMPIC_TOKEN,
      since: values.since,
    },
    fetchImpl,
  );

  const byView: Record<string, Row[]> = {};
  for (const v of views) byView[v.name] = runView(v, resources);

  const ctx: RenderContext = { patient: byView['demographics']?.[0] ?? {}, views: byView };
  const template = values.template ? readFileSync(values.template, 'utf8') : defaultTemplate;
  const markdown = render(template, ctx);
  return { markdown, out: values.out! };
}

if (import.meta.main) {
  const { markdown, out } = await run(Bun.argv.slice(2));
  if (out === '-') process.stdout.write(markdown + '\n');
  else writeFileSync(out, markdown);
}
