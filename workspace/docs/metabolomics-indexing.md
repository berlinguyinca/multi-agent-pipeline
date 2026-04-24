# Metabolomics evidence indexing

Chemlake's metabolomics layer downloads processed result tables and metadata, normalizes them into governed JSONL lake files, and builds a DuckDB/Parquet index for biological cross-reference queries.

## Source governance

Each row records:

- `source_name`
- `source_accession`
- `source_url`
- `source_record_type`
- `retrieved_at`
- `content_hash`
- `parser_version`
- `license_terms_note`

This makes every biological query result traceable to its source repository and retrieval snapshot.

## Supported v1 sources

| CLI source | Role |
| --- | --- |
| `mw` | Metabolomics Workbench/NMDR study summaries, factors, and datatable/result records |
| `metabolights` | MetaboLights public study metadata |
| `gnps` | GNPS/MassIVE dataset metadata and spectral identifiers when present |
| `metabolomexchange` | Discovery/metadata aggregation records pointing to authoritative repositories |
| `hub` | MetabolomicsHub discovery records |
| `pubmed` | PubMed publication metadata for PMID/DOI linking |

## Full local mirror

Use `metabolomics mirror` when the goal is a local repository mirror, not only normalized query tables:

```bash
chemlake --data-dir ./lake metabolomics mirror --source mw --all
chemlake --data-dir ./lake metabolomics mirror --source metabolights --all
chemlake --data-dir ./lake metabolomics mirror --source all --all --limit 100
```

The mirror stores downloaded source objects under `metabolomics/mirror/files/<source>/<accession>/` and appends `metabolomics/mirror/mirror_manifest.jsonl`. Each manifest row records source URL, local path, byte size, hash, retrieved timestamp, parser version, and source terms note. By default the mirror includes raw archive URLs exposed by source metadata; pass `--processed-only` to mirror metadata/processed endpoints without raw archives.

## Data products

The harvester writes JSONL records under `metabolomics/`:

- `studies.jsonl`
- `samples.jsonl`
- `factors.jsonl`
- `results.jsonl`
- `publications.jsonl`
- `compound_links.jsonl`
- `provenance.jsonl`

The indexer writes:

- `index.duckdb`
- one Parquet file per normalized table
- a `biological_results` DuckDB view joining compound results, sample/study context, and publication metadata.

## Query examples

```bash
chemlake --data-dir ./lake metabolomics harvest --source mw --accession ST000001
chemlake --data-dir ./lake metabolomics harvest --source pubmed --pmid 12345678
chemlake --data-dir ./lake metabolomics index
chemlake --data-dir ./lake metabolomics query --compound aspirin --species mouse --organ liver
```

`chemlake resolve --to all` also surfaces metabolomics result summaries for compounds linked by PubChem CID, InChIKey, or observed metabolite name.
