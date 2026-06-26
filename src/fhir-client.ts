export interface FetchOptions {
  server: string;
  patient: string;
  types: string[];
  token?: string;
  since?: string;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

interface FhirBundle {
  entry?: { resource?: unknown }[];
  link?: { relation: string; url: string }[];
}

export async function fetchEverything(
  opts: FetchOptions,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<unknown[]> {
  const params = new URLSearchParams();
  if (opts.types.length) params.set('_type', opts.types.join(','));
  if (opts.since) params.set('_since', opts.since);

  const base = opts.server.replace(/\/$/, '');
  let url: string | null = `${base}/Patient/${opts.patient}/$everything?${params.toString()}`;

  const headers: Record<string, string> = { Accept: 'application/fhir+json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const resources: unknown[] = [];
  while (url) {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      throw new Error(`FHIR request failed: ${res.status} ${await res.text()}`);
    }
    const bundle = (await res.json()) as FhirBundle;
    for (const e of bundle.entry ?? []) {
      if (e.resource) resources.push(e.resource);
    }
    const next = (bundle.link ?? []).find((l) => l.relation === 'next');
    url = next ? next.url : null;
  }
  return resources;
}
