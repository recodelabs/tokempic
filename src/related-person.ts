import type { FetchLike } from './fhir-client';

/**
 * Some FHIR stores keep a RelatedPerson as a thin link: it carries the
 * relationship but no demographics, pointing at a separate Patient record via an
 * identifier instead of inlining a name. This is the identifier system used by
 * the Turn HealthPass store; the value is the linked Patient's logical id.
 */
export const RELATED_PERSON_PATIENT_SYSTEM =
  'http://example.org/fhir/related-person-patient';

interface Identifier {
  system?: string;
  value?: string;
}
interface RelatedPerson {
  resourceType?: string;
  identifier?: Identifier[];
  name?: unknown[];
  gender?: unknown;
  birthDate?: unknown;
}
interface LinkedPatient {
  resourceType?: string;
  name?: unknown[];
  gender?: unknown;
  birthDate?: unknown;
}

/** The linked Patient id a thin RelatedPerson points at, or undefined. */
function linkedPatientId(rp: RelatedPerson): string | undefined {
  return rp.identifier?.find((i) => i.system === RELATED_PERSON_PATIENT_SYSTEM)?.value;
}

/**
 * Hydrate name-less RelatedPerson resources in place by fetching the Patient
 * each one links to (a direct `GET Patient/{id}` per link — faster than a
 * search) and copying over name / gender / birthDate.
 *
 * Mutates `resources`. The linked Patients are deliberately NOT added to the
 * pool: a view over `Patient` (e.g. demographics) must not pick them up.
 */
export async function hydrateRelatedPersons(
  resources: unknown[],
  opts: { server: string; token?: string },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<void> {
  const pending = resources
    .filter((r): r is RelatedPerson => (r as RelatedPerson).resourceType === 'RelatedPerson')
    .filter((rp) => !(rp.name && rp.name.length) && linkedPatientId(rp))
    .map((rp) => ({ rp, id: linkedPatientId(rp)! }));
  if (!pending.length) return;

  const base = opts.server.replace(/\/$/, '');
  const headers: Record<string, string> = { Accept: 'application/fhir+json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  // De-dupe so two RelatedPersons pointing at the same Patient fetch once.
  const cache = new Map<string, LinkedPatient | null>();
  for (const id of new Set(pending.map((p) => p.id))) {
    const res = await fetchImpl(`${base}/Patient/${id}`, { headers });
    cache.set(id, res.ok ? ((await res.json()) as LinkedPatient) : null);
  }

  for (const { rp, id } of pending) {
    const patient = cache.get(id);
    if (!patient || patient.resourceType !== 'Patient') continue;
    if (patient.name) rp.name = patient.name;
    if (rp.gender == null) rp.gender = patient.gender;
    if (rp.birthDate == null) rp.birthDate = patient.birthDate;
  }
}
