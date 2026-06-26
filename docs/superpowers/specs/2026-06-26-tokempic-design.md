# Tokempic — Design

**Date:** 2026-06-26
**Status:** Approved design, pre-implementation

## Summary

Tokempic is a command-line tool that fetches a **single patient's** record from a FHIR
server and renders it as a **compact, token-lean Markdown document** suitable for passing to
an LLM. It replaces verbose FHIR JSON with a curated, flattened summary.

Two concerns are kept strictly separate:

- **What data is included** — defined by standard **SQL-on-FHIR ViewDefinitions** (no bespoke
  selection language).
- **How it is laid out** — defined by a swappable **Markdown template**.

(The name is a play on "token" + "Ozempic" — it slims your context.)

## Goals

- One patient → one Markdown file.
- Token-efficient: drop FHIR structural verbosity; roughly one terse line per clinical fact.
- Field/row selection defined entirely by standard ViewDefinitions — the only place that
  decides *what* is included.
- Output layout defined by a template the user controls.
- Efficient fetch: a single `Patient/$everything` call scoped by `_type`, where the `_type`
  list is **derived from the ViewDefinition set** (single source of truth).
- Portable across FHIR servers — uses only standard operations supported by both HAPI FHIR
  and Google Cloud Healthcare API.

## Non-goals (v1)

- Not population / bulk analytics — that is FlatQuack's domain. Tokempic is single-patient.
- No OAuth login flows — Tokempic accepts a pre-obtained bearer token.
- No DuckDB / SQL generation — ViewDefinitions are evaluated directly via FHIRPath.
- No server-side field/filter pushdown (`_elements`, mapping `where` → search params). This is
  a deferred Tier 2/3 optimization; v1 fetches the chosen resource types in full and trims
  locally.
- No "smart" volume trimming (most-recent-N, abnormal-only) beyond what a VD `where` clause and
  the `--since` flag express.

## Architecture

```
CLI args
  → FHIR client:   GET Patient/{id}/$everything?_type=<types from VDs>   (paginate, bearer auth)
  → resources (collected from Bundle entries)
  → VD runner:     SQL-on-FHIR view runner (on `fhirpath`) per ViewDefinition  → rows per view
  → renderer:      template engine fills the Markdown layout                    → summary.md
```

Each component is small and single-purpose, communicating through plain data (FHIR resource
arrays, row arrays, a render context object).

## Components

### 1. CLI
Native `parseArgs` (same approach as FlatQuack — no arg-parsing dependency).

| flag | description | default |
| --- | --- | --- |
| `--patient` | Patient resource id | (required) |
| `--server` | FHIR server base URL | (required) |
| `--token` | Bearer token; may also come from `TOKEMPIC_TOKEN` env var | none |
| `--views` | Directory of ViewDefinition JSON files | `./views` |
| `--template` | Path to a Markdown layout template | built-in default |
| `--out` | Output file path; `-` for stdout | stdout |
| `--since` | Pass-through to `$everything?_since=` | none |

### 2. FHIR client
- Uses native `fetch`.
- Issues `GET {server}/Patient/{id}/$everything?_type={derived}` plus optional `_since`.
- Sends `Authorization: Bearer {token}` when a token is present.
- Follows Bundle pagination via `link[rel=next]` until exhausted.
- Flattens `entry[].resource` into a single in-memory array of resources.

### 3. ViewDefinition loader + runner
- Loads every `*.json` (ViewDefinition) from `--views`.
- Collects each VD's `resource` field → the deduped `_type` list handed to the FHIR client.
- Runs the **reused SQL-on-FHIR JavaScript view runner** (~400 LOC, built on `fhirpath`,
  from the HL7 `sql-on-fhir` reference implementation) to project the matching resources for
  each VD into rows of named columns.
- Only the subset of the SQL-on-FHIR spec provided by that runner is supported
  (`column`, `where`, `forEach`/`unionAll`). We do not implement the full spec ourselves.

### 4. Renderer
- Template engine: **`eta`** (lightweight, dependency-free, supports JS expressions).
- Render context: `{ patient, views }` where `views` maps each ViewDefinition name to its
  array of rows.
- Ships a **default generic template** (loops over every view → a titled section with a simple
  table/line list) so the tool works with zero template authoring.
- A user-supplied `--template` overrides the default for full control of section order,
  headings, wording, and per-row formatting.
- The renderer is **semantics-free** — it has no clinical knowledge. All decisions about *what*
  appears live in the ViewDefinitions; all decisions about *layout* live in the template.

### 5. Output
- Writes the rendered Markdown to `--out` (file) or stdout.

## Key design decisions

- **ViewDefinition set is the single source of truth.** It drives both the fetch scope
  (`_type`) and the projection (columns/filters). There is no second artifact defining "what."
- **Layout is separate from data.** VDs choose fields; the template arranges them. Two clean,
  independently swappable knobs.
- **Reuse over build.** The two hard, correctness-critical pieces — FHIRPath evaluation and the
  ViewDefinition runner — are existing, spec-tested JavaScript. Tokempic is mostly fetch glue
  plus templating.
- **Standard operations only.** `$everything` + `_type` works identically on HAPI and GCP
  Healthcare API, keeping Tokempic server-agnostic.

## Dependencies

- **Runtime:** Bun (Node 18+ also viable). `fetch` and `parseArgs` are native.
- **`fhirpath`** (npm) — FHIRPath evaluation. Gold-standard JS implementation.
- **SQL-on-FHIR view runner** — vendored from the HL7 `sql-on-fhir` reference implementation
  (~400 LOC) and pinned, or consumed from npm if a maintained package is available.
- **`eta`** — Markdown templating.
- **Distribution:** `bun build --compile` produces a standalone binary, so end users need no
  JS runtime installed.

## Default sections (starter ViewDefinition set)

| Section | FHIR resource | Notable columns |
| --- | --- | --- |
| Demographics | Patient | name, birthDate, gender |
| Problems | Condition | code, display, clinicalStatus, onset |
| Medications | MedicationRequest | medication display, dose, status |
| Allergies | AllergyIntolerance | substance, criticality, reaction |
| Labs | Observation (category=laboratory) | date, code, display, value, unit |
| Vitals | Observation (category=vital-signs) | date, code, display, value, unit |
| Procedures | Procedure | code, display, performed date |
| Immunizations | Immunization | vaccine, date, status |
| Encounters | Encounter | type, period, reason |

Each section is one ViewDefinition file. Adding/removing a section = adding/removing a VD (and
referencing it in a custom template, if not using the generic default).

## Output example

Generic-template output (illustrative):

```markdown
# Patient Summary — Jane Smith (1980-04-12, female)

## Problems
- Hypertension (I10) — active, onset 2019-03
- Type 2 diabetes (E11.9) — active, onset 2021-07

## Labs
2026-06-01 | HbA1c (4548-4) | 7.2 %
2026-06-01 | LDL (13457-7) | 110 mg/dL
```

Custom template (`eta`) excerpt showing the "place the parts of the page" model:

```eta
# Patient Summary — <%= it.patient.name %> (<%= it.patient.birthDate %>)

## Problems
<% it.views.conditions.forEach(c => { %>- <%= c.display %> (<%= c.code %>) — <%= c.clinicalStatus %>
<% }) %>
## Labs
<% it.views.labs.forEach(o => { %><%= o.date %> | <%= o.display %> | <%= o.value %> <%= o.unit %>
<% }) %>
```

## Authentication

v1 accepts a **bearer token** via `--token` or the `TOKEMPIC_TOKEN` env var, sent as
`Authorization: Bearer …`. This works for a GCP Healthcare API short-lived access token
(`gcloud auth print-access-token`) and for HAPI servers that accept a token (or none). Building
OAuth/SMART login flows is out of scope for v1.

## Error handling

- **Fetch failures / non-2xx:** report status + server `OperationOutcome` message, exit non-zero.
- **Pagination:** follow `next` links to completion; guard against missing links.
- **Empty sections:** a view with zero rows renders as an empty (or omitted) section, never an
  error.
- **Missing fields:** a null/absent column value renders blank; it does not abort the row.
- **Unknown resource types in VDs:** still added to `_type`; if the server returns none, the
  section is simply empty.

## Testing

- **Unit:** `_type` derivation from a VD set; the view runner against canned sample resources;
  template rendering against fixed row data.
- **Spec reuse:** run the view runner against the SQL-on-FHIR reference test fixtures (the same
  family FlatQuack vendors under `tests/spec-tests/`) to confirm projection behavior.
- **End-to-end:** a canned `$everything` Bundle fixture → full pipeline → asserted Markdown
  snapshot. (Optionally a live smoke test against a public HAPI test server, not in CI.)

## Future / deferred

- Tier 2/3 fetch efficiency: derive `_elements` from VD column/where fields; push mappable
  `where` predicates to per-type search parameters.
- Volume trimming: most-recent-N, abnormal-only, date windows as first-class options.
- Alternate output format: compact JSON renderer alongside Markdown.
- Terminology display: choosing a preferred coding system per CodeableConcept.
