# Tokempic

Fetch one patient's record from a FHIR server and render a compact, token-lean
Markdown summary for an LLM. What is included is defined by standard SQL-on-FHIR
ViewDefinitions (in `views/`); how it is laid out is defined by an `eta` template.

## Usage

```bash
bun run src/cli.ts \
  --patient <id> \
  --server https://fhir.example.org/fhir \
  --token "$(gcloud auth print-access-token)" \
  --views ./views \
  --out summary.md
```

Flags: `--patient` (required), `--server` (required), `--token` (or `TOKEMPIC_TOKEN`),
`--views` (default `./views`), `--template` (default built-in), `--out` (default stdout),
`--since`.

The fetched resource types are derived automatically from the `resource` field of the
loaded ViewDefinitions and passed to `Patient/$everything?_type=…`.

## Build a standalone binary

```bash
bun run build   # produces ./tokempic
```

## Test

```bash
bun test
```
