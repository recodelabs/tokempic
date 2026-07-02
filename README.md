# Tokempic

<p align="center">
  <img src="tokempic.png" alt="Tokempic — once-daily CLI for prompt obesity" width="320">
</p>

**Once-daily CLI for prompt obesity. Clinically proven token loss.**

Tokempic pulls one patient's record from a FHIR server and renders a compact,
token-lean Markdown summary you can drop into an LLM prompt. A full
`$everything` bundle is mostly empty calories; tokempic trims it to the
clinically relevant facts and nothing else.

- **What** goes in the summary is defined by standard
  [SQL-on-FHIR ViewDefinitions](#viewdefinitions--what-goes-in-the-summary) —
  plain JSON, fully configurable.
- **How** it's laid out is defined by an [`eta`](https://eta.js.org/) template.

No side effects. Do not feed after midnight. Results may vary.

## Install

Tokempic runs as a `tokempic` command. Pick your dosage:

**Standalone binary** — no runtime required afterwards:

```bash
bun run build      # produces ./tokempic, a self-contained executable
mv tokempic /usr/local/bin/   # optional: take it anywhere on your PATH
```

The binary embeds the default ViewDefinitions and template, so it works from any
directory with no extra files.

**Global command via Bun** — for development:

```bash
bun link           # puts `tokempic` on your PATH, backed by Bun
```

Either way, you call `tokempic` directly instead of `bun run src/cli.ts`.

## Usage

```bash
tokempic \
  --patient <id> \
  --server  https://fhir.example.org/fhir \
  --token   "$(gcloud auth print-access-token)" \
  --out     summary.md
```

Options:

| Option | Description |
| --- | --- |
| `--patient <id>` | Patient to summarize. **Required.** |
| `--server <url>` | FHIR base URL. **Required.** |
| `--token <jwt>` | Bearer token. Falls back to `$TOKEMPIC_TOKEN`. |
| `--out <file>` | Where to write the Markdown. Default: stdout. |
| `--views <dir>` | Directory of ViewDefinition JSON files. Default: built-in set. |
| `--template <file>` | `eta` layout template. Default: built-in layout. |
| `--since <date>` | Only fetch resources updated since this point. |
| `--max-age <dur>` | Skip the server if the cache is younger than this. |
| `--refresh` | Ignore the cache and do a full fetch. |
| `--anon` | De-identify the output: drop names/phone/address/IDs, label the patient "Patient", reduce birth dates to the year. |
| `--no-cache` | Don't read or write the cache at all. |
| `--cache-dir <dir>` | Store cache files somewhere other than `~/.cache/tokempic/`. |

The resource types to fetch are derived automatically from the `resource` field
of the ViewDefinitions and passed to `Patient/$everything?_type=…`. Pass
`--views ./my-views` to swap in your own.

## Example output

[`examples/george-jetson.md`](examples/george-jetson.md) is a sample summary
produced by the built-in views. It opens like this:

```markdown
# Patient Summary — George Jetson (1999-03-04)

## demographics
- George Jetson | 1999-03-04 | male

## conditions
- 38341003 | Essential hypertension | active | 2024-04-12
- 54150009 | Upper respiratory infection | active | 2026-04-02
...

## relatedpersons
- Elroy Jetson | Parent of | male | 2025-04-01
```

## ViewDefinitions — what goes in the summary

Tokempic doesn't hard-code which fields make the cut. Every section of the
summary is a [SQL-on-FHIR **ViewDefinition**](https://sql-on-fhir.org/ig/latest/) —
a small JSON file that says *which resource to read* and *which fields to pull
out of it*. The built-in set lives in [`views/`](views/), one file per section:

```
views/
├── demographics.json   immunizations.json
├── conditions.json     encounters.json
├── medications.json    relatedpersons.json
├── allergies.json      labs.json
├── procedures.json     vitals.json
```

### Anatomy of a ViewDefinition

Here's the labs view (`views/labs.json`) in full:

```json
{
  "name": "labs",
  "resource": "Observation",
  "where": [{ "path": "category.coding.where(code='laboratory').exists()" }],
  "select": [{ "column": [
    { "name": "date",    "path": "effectiveDateTime" },
    { "name": "code",    "path": "code.coding.first().code" },
    { "name": "display", "path": "code.coding.first().display" },
    { "name": "value",   "path": "valueQuantity.value" },
    { "name": "unit",    "path": "valueQuantity.unit" }
  ] }]
}
```

| Field | What it does |
| --- | --- |
| `name` | Section name. Becomes the `## <name>` heading in the output. |
| `resource` | The FHIR resource type to read (e.g. `Observation`, `Condition`). |
| `where` | Optional [FHIRPath](https://hl7.org/fhirpath/) filters — keep only resources that match. Here: only `laboratory` observations. |
| `select[].column[]` | The columns to extract. Each has a `name` and a FHIRPath `path`. |

Need one row per repeating element (e.g. each component of a blood-pressure
reading)? A `select` clause also supports `forEach`, which walks a FHIRPath
collection and emits a row per match:

```json
{ "forEach": "component", "select": [{ "column": [
  { "name": "code",  "path": "code.coding.first().display" },
  { "name": "value", "path": "valueQuantity.value" }
] }] }
```

### Adding a resource (or editing an existing one)

1. **Copy the built-in views you want to keep into a directory of your own.**
   `--views <dir>` *replaces* the built-in set — it doesn't merge with it — so
   start from the files in [`views/`](views/) rather than from scratch.

2. **Drop in a new `<section>.json`.** Say you want family history:

   ```json
   {
     "name": "family-history",
     "resource": "FamilyMemberHistory",
     "select": [{ "column": [
       { "name": "relation", "path": "relationship.coding.first().display" },
       { "name": "condition", "path": "condition.code.coding.first().display" }
     ] }]
   }
   ```

3. **Run with `--views`:**

   ```bash
   tokempic --patient <id> --server "$BASE" --token "$TOK" --views ./my-views --out summary.md
   ```

That's it — no other wiring. Tokempic reads the `resource` fields to decide what
to fetch (`FamilyMemberHistory` gets added to `Patient/$everything?_type=…`
automatically), and the default template renders a `## family-history` section
for any view it finds. New resource, new section, zero template edits.

> **Three things worth knowing:**
> - The view named **`demographics`** is special — its first row populates the
>   patient header (name / birth date). Keep one around if you want that line.
> - **`RelatedPerson`** resources are resolved: some FHIR stores keep a
>   RelatedPerson as a thin link (relationship only, no name) that points at a
>   separate `Patient` record via an identifier. Tokempic detects these,
>   fetches the linked Patient directly (`GET Patient/{id}`), and fills in the
>   related person's name / gender / birth date before the view runs. The linked
>   Patient is used only for this — it never leaks into the `demographics`
>   section. See [`src/related-person.ts`](src/related-person.ts) (the identifier
>   system is a constant there).
> - Want a different *layout* (not just different fields)? That's the template's
>   job, not the ViewDefinition's — pass `--template <file>`.

## Anonymization

Pass `--anon` to produce a de-identified summary — the structured identifiers in
the record (names, phone, address, IDs) are stripped before rendering:

- The patient's name becomes the label **`Patient`**.
- Relatives lose their name and phone; their relationship, gender, and birth year remain.
- Phone, email, address, and identifiers (SSN, MRN, national IDs…) are dropped.
- Birth dates are reduced to the **year** (`1999-03-04` → `1999`).

It scrubs *structured* fields only — free text inside clinical descriptions or
notes is passed through untouched, so review those if your views include them.

```markdown
# Patient Summary — Patient (1999)

## demographics
- Patient | 1999 | male

## relatedpersons
- Parent of | male | 2025
```

Tokempic decides which columns are PII by their **name** — `name`, `given`,
`family`, `phone`, `telecom`, `email`, `address`, `ssn`, `mrn`, `identifier`,
and similar. In a custom ViewDefinition you can override this per column:

```json
{ "name": "nickname", "path": "…", "pii": true }   // force-redact
{ "name": "orgName",  "path": "…", "pii": false }  // force-keep
```

### How each column is decided

For every column, in this order — the first rule that matches wins:

1. **Explicit `pii` flag** — `pii: true` always redacts and `pii: false` always
   keeps the value, overriding every rule below (including the birth-date rule).
2. **Date of birth** — a column whose (lower-cased) name contains `birth` or is
   exactly `dob` is reduced to its leading 4-digit year: `1999-03-04` → `1999`,
   `1999` → `1999`. If the value isn't a real date (e.g. a `birthPlace` column
   holding `Boston`), it's redacted instead of passed through, so a mislabeled
   column can't leak.
3. **Name heuristic** — a column whose (lower-cased) name is in the PII list
   above is redacted.
4. **Otherwise** — the value is kept as-is.

Only **dates of birth** are reduced. Every other date — condition onset, lab and
encounter dates, etc. — keeps its full precision, because it's clinically useful
and, on its own, far less identifying than a DOB. The DOB rule keys off the
*column name*, not the value, so tokempic never has to guess whether an arbitrary
date is a birthday.

*Redact* means: in the special `demographics` view (which feeds the patient
header) the value becomes the label `Patient`; in every other view the value is
dropped from the row entirely — which is why a relative is left with just their
relationship, gender, and birth year.

> **Caveat — the cache still holds PHI.** `--anon` scrubs *output* only. The
> local cache under `~/.cache/tokempic/` still stores the raw record with real
> identifiers. To keep PHI off disk, combine `--anon` with `--no-cache` (or
> `--refresh`).

## Why — size and speed

The whole point: turn a sprawling FHIR `$everything` bundle into something small
enough to fit in a prompt. For one example patient with the built-in views:

| | Full `$everything` bundle | tokempic markdown |
| --- | ---: | ---: |
| Size | 72.5 KB | 5.0 KB |
| ~Tokens (chars ÷ 4) | ~18,100 | ~1,260 |

That's **~14× smaller — a ~93% reduction** in bytes and tokens, while keeping the
facts that matter. (One patient, approximate; your mileage varies with record
size and views. As they say on the label: individual results not guaranteed.)

Caching then cuts the wall-clock cost of repeat runs:

| Run | What happens | Time |
| --- | --- | ---: |
| Cold | full fetch + render | ~1.7 s |
| Incremental, no changes | `_since` probe comes back empty, cache reused | ~0.8 s |
| `--max-age` fresh | network skipped entirely | ~0.06 s |

## Caching

To avoid re-pulling a patient's whole record on every run, tokempic caches the
fetched resources under `~/.cache/tokempic/` (override with `XDG_CACHE_HOME` or
`--cache-dir`), keyed by `(server, patient, viewset)`.

By default, runs are **incremental**: tokempic remembers the highest
`meta.lastUpdated` it has seen and asks the server for only what changed since
(`Patient/$everything?_since=…`). If nothing changed, the delta comes back empty
and the cached data is reused — one tiny request instead of a full paginated
pull. New and updated resources are merged into the cache.

```bash
tokempic --patient <id> --server "$BASE" --token "$TOK" --out s.md              # incremental
tokempic --patient <id> --server "$BASE" --token "$TOK" --max-age 1h --out s.md # skip server if cache < 1h old
tokempic --patient <id> --server "$BASE" --token "$TOK" --refresh --out s.md    # force full refresh
```

`--max-age` accepts `30s`, `10m`, `2h`, `1d`, or bare seconds.

> **Caveat — deletions:** incremental fetches detect new and updated resources
> but not *deletions* (a removed resource just stops appearing in `_since`
> results, with no tombstone). A resource deleted on the server lingers in the
> cache until you run `--refresh`.

## Google Cloud Healthcare API

```bash
PROJECT=my-project
LOCATION=us-central1
DATASET=my-dataset
STORE=my-store
BASE="https://healthcare.googleapis.com/v1/projects/$PROJECT/locations/$LOCATION/datasets/$DATASET/fhirStores/$STORE/fhir"

tokempic \
  --patient <patient-id> \
  --server  "$BASE" \
  --token   "$(gcloud auth print-access-token)" \
  --out     summary.md
```

The token from `gcloud auth print-access-token` is short-lived, so re-run for a
fresh one. Requires `roles/healthcare.fhirResourceReader` on the dataset or store.

### Convenience wrapper (`.env` + `run.sh`)

Tired of retyping the server URL and service account? Keep them in a `.env` next
to the binary (git-ignored — it holds your FHIR store coordinates):

```bash
# .env
SA=my-sa@my-project.iam.gserviceaccount.com
BASE=https://healthcare.googleapis.com/v1/projects/my-project/locations/us-central1/datasets/my-dataset/fhirStores/my-store/fhir
```

`tokempic` itself doesn't read `.env`, so either source it before calling the
binary directly:

```bash
set -a; source .env; set +a
tokempic --patient <id> --server "$BASE" --token "$(gcloud auth print-access-token --account=$SA)" --out summary.md
```

…or use the bundled `run.sh`, which sources `.env`, fetches a fresh token, and
runs `tokempic` in one step:

```bash
./run.sh <patient-id>                 # writes <patient-id>-summary.md
./run.sh <patient-id> summary.md      # or name the output explicitly
```

## Claude Code plugin

This repo doubles as a [Claude Code](https://docs.claude.com/en/docs/claude-code)
plugin marketplace, so an agent can learn to drive tokempic for you:

```text
/plugin marketplace add recodelabs/tokempic
/plugin install tokempic@tokempic
```

That adds the `using-tokempic` skill, which teaches Claude when and how to run
the CLI (auth, flags, caching, troubleshooting). The skill lives in
`skills/using-tokempic/`; the marketplace and plugin manifests are in
`.claude-plugin/`.

## Develop

```bash
bun install
bun test
bun run src/cli.ts --patient <id> --server <url>   # run from source without installing
```
</content>
</invoke>
