# Tokempic

<p align="center">
  <img src="tokempic.png" alt="Tokempic — once-daily CLI for prompt obesity" width="320">
</p>

**Once-daily CLI for prompt obesity. Clinically proven token loss.**

Tokempic pulls one patient's record from a FHIR server and renders a compact,
token-lean Markdown summary you can drop into an LLM prompt. A full
`$everything` bundle is mostly empty calories; tokempic trims it to the
clinically relevant facts and nothing else.

- **What** goes in the summary is defined by standard SQL-on-FHIR ViewDefinitions.
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
| `--no-cache` | Don't read or write the cache at all. |
| `--cache-dir <dir>` | Store cache files somewhere other than `~/.cache/tokempic/`. |

The resource types to fetch are derived automatically from the `resource` field
of the ViewDefinitions and passed to `Patient/$everything?_type=…`. Pass
`--views ./my-views` to swap in your own.

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
