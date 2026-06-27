---
name: using-tokempic
description: >-
  Run the tokempic CLI to turn one patient's FHIR record into a compact,
  token-lean Markdown summary for an LLM. Use this whenever you need to fetch,
  summarize, or condense a patient's clinical record from a FHIR server
  (especially Google Cloud Healthcare API) — e.g. "summarize patient <id>",
  "pull this patient's chart", "make an LLM-ready summary of their conditions
  and meds", or any task that hands a FHIR patient id + server to an LLM. Prefer
  this over hand-writing curl calls to `$everything`, because tokempic already
  handles pagination, auth headers, caching, and the SQL-on-FHIR → Markdown
  rendering. Also use it when wiring patient context into a prompt or agent.
---

# Using tokempic

tokempic fetches a single patient's record via the FHIR `Patient/$everything`
operation and renders a small Markdown summary. The *content* is defined by
SQL-on-FHIR ViewDefinitions; the *layout* by an `eta` template. The win is size:
a full `$everything` bundle (~70 KB / ~18k tokens for a typical patient) collapses
to ~5 KB / ~1.3k tokens — roughly **14× smaller** — while keeping the clinically
relevant facts. Reach for it any time you'd otherwise paste a raw FHIR bundle
into a prompt.

## Prerequisites

1. **The `tokempic` command.** Either a built standalone binary or run from source:
   - Binary: from the repo, `bun run build` produces `./tokempic` (self-contained;
     move onto your `PATH` to call from anywhere). It embeds the default views and
     template, so it works from any directory.
   - From source (dev): `bun run src/cli.ts …` with the same flags.
2. **A FHIR server URL** (`--server`). For Google Cloud Healthcare it looks like
   `https://healthcare.googleapis.com/v1/projects/<proj>/locations/<loc>/datasets/<ds>/fhirStores/<store>/fhir`.
3. **A bearer token** (`--token` or the `TOKEMPIC_TOKEN` env var). For Google
   Healthcare, mint a short-lived one with
   `gcloud auth print-access-token [--account=<service-account>]`. It expires fast —
   generate a fresh one per run. The caller needs `roles/healthcare.fhirResourceReader`
   on the dataset or store.

## The canonical invocation

```bash
tokempic \
  --patient <patient-id> \
  --server "<fhir-base-url>" \
  --token "$(gcloud auth print-access-token)" \
  --out summary.md
```

`--patient` and `--server` are required. `--out` defaults to stdout (`-`), so omit
it to capture the markdown directly (e.g. to feed straight into a prompt).

## Convenience: `.env` + `run.sh` (in this repo)

tokempic itself does **not** read `.env` — `--server`/`--token` are flags, and
`$BASE`/`$SA` in examples are ordinary *shell* variables. The single most common
failure is running with an empty `$BASE` or `$SA` because the shell never had them
set. This repo ships two helpers:

- A git-ignored `.env` holding `SA=` (gcloud service account) and `BASE=` (FHIR URL).
  Load it with `set -a; source .env; set +a` before invoking the binary directly.
- `run.sh <patient-id> [out-file] [extra flags…]` — sources `.env`, fetches a fresh
  token for `$SA`, and runs tokempic. Extra flags are forwarded, e.g.
  `./run.sh <id> out.md --max-age 1h`.

If a run produces an empty/garbage result or a connection error, first check that
`$BASE` and `$SA` are actually populated (`echo "$BASE"`), then that the token is
fresh.

## Flags

| Flag | Purpose |
| --- | --- |
| `--patient <id>` | **Required.** FHIR Patient logical id. |
| `--server <url>` | **Required.** FHIR base URL (ends in `…/fhir`). |
| `--token <jwt>` | Bearer token. Falls back to `TOKEMPIC_TOKEN`. |
| `--out <file>` | Output path. Default `-` (stdout). |
| `--views <dir>` | Directory of ViewDefinition JSON files. Default: built-in set. |
| `--template <file>` | Custom `eta` template. Default: built-in layout. |
| `--since <ts>` | Only include resources updated after this instant (first fetch). |
| `--max-age <dur>` | Skip the network if the cache is younger than this (`30s`,`10m`,`2h`,`1d`). |
| `--refresh` | Ignore the cache; do a full fetch (also the way to reconcile deletions). |
| `--no-cache` | Bypass the cache entirely (read nothing, write nothing). |
| `--cache-dir <dir>` | Override cache location (default `~/.cache/tokempic/`). |

The fetched resource types are derived automatically from the `resource` field of
the active ViewDefinitions, so changing `--views` changes what is pulled.

## Caching (default behavior — important for repeated runs)

By default tokempic caches results under `~/.cache/tokempic/`, keyed by
`(server, patient, viewset)`, and runs **incrementally**: it remembers the highest
`meta.lastUpdated` it has seen and asks the server only for what changed since
(`$everything?_since=…`). If nothing changed, the delta is empty and the cached data
is reused — one tiny request instead of a full paginated pull.

Practical guidance:
- For a one-off, just run normally; the first run is a full fetch.
- For repeated/scripted runs where slightly-stale data is fine, add `--max-age`
  (e.g. `--max-age 10m`) to skip the network entirely while fresh.
- When you suspect a resource was **deleted** server-side, run `--refresh` — `_since`
  deltas don't carry deletion tombstones, so a deleted resource lingers in the cache
  until a full refresh.
- In tests or when you must not touch a shared cache dir, pass `--no-cache` (or a
  throwaway `--cache-dir`).

## Customizing the output

- To change *what* is included, point `--views` at a directory of your own
  ViewDefinition JSON files (one per section). Each defines a `name`, a `resource`
  type, and `select`/`where` clauses using FHIRPath. The built-in set covers
  demographics, conditions, medications, allergies, labs, vitals, procedures,
  immunizations, encounters, and relatedpersons.
- To change *how* it's laid out, pass `--template` an `eta` template. The render
  context exposes `it.patient` (the first demographics row) and `it.views` (a map of
  view name → array of rows).

## Quick troubleshooting

- **Empty output / "request failed"** → almost always an unset `$BASE`/`$SA` or an
  expired token. Verify the shell vars and regenerate the token.
- **`401`/`403`** → wrong account or missing `healthcare.fhirResourceReader`. Check
  `gcloud auth list` and that `--account` matches a credentialed service account.
- **`Both --patient and --server are required`** → a flag is missing or its value
  expanded to empty.
- **Stale data after a server-side delete** → re-run with `--refresh`.
