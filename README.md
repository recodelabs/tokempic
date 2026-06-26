# Tokempic

Fetch one patient's record from a FHIR server and render a compact, token-lean
Markdown summary for an LLM. What is included is defined by standard SQL-on-FHIR
ViewDefinitions; how it is laid out is defined by an `eta` template.

## Install

Tokempic runs as a `tokempic` command. Pick one:

**Standalone binary** (no runtime needed afterwards):

```bash
bun run build      # produces ./tokempic — a self-contained executable
```

The binary embeds the default ViewDefinitions and template, so it works from any
directory with no extra files. Move it onto your `PATH` (e.g. `mv tokempic /usr/local/bin/`)
to call `tokempic` from anywhere.

**Global command via Bun** (for development):

```bash
bun link           # makes `tokempic` available on your PATH, backed by Bun
```

Either way you then invoke `tokempic` directly instead of `bun run src/cli.ts`.

## Usage

```bash
tokempic \
  --patient <id> \
  --server https://fhir.example.org/fhir \
  --token "$(gcloud auth print-access-token)" \
  --out summary.md
```

Flags: `--patient` (required), `--server` (required), `--token` (or `TOKEMPIC_TOKEN`),
`--views` (a directory of ViewDefinition JSON files; defaults to the built-in set),
`--template` (defaults to the built-in layout), `--out` (default stdout), `--since`.

The fetched resource types are derived automatically from the `resource` field of the
ViewDefinitions and passed to `Patient/$everything?_type=…`. Supply `--views ./my-views`
to override the built-in set with your own.

## Google Cloud Healthcare API

```bash
PROJECT=my-project
LOCATION=us-central1
DATASET=my-dataset
STORE=my-store
BASE="https://healthcare.googleapis.com/v1/projects/$PROJECT/locations/$LOCATION/datasets/$DATASET/fhirStores/$STORE/fhir"

tokempic \
  --patient <patient-id> \
  --server "$BASE" \
  --token "$(gcloud auth print-access-token)" \
  --out summary.md
```

The bearer token from `gcloud auth print-access-token` is short-lived; re-run for a fresh one.
Requires `roles/healthcare.fhirResourceReader` on the dataset or store.

## Develop

```bash
bun install
bun test
bun run src/cli.ts --patient <id> --server <url>   # run from source without installing
```
