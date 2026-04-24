# Local source snapshots

Drop manually downloaded source files here. Large/restricted files in this tree are gitignored.

- HMDB: place HMDB XML/SDF/JSON/ZIP files under `hmdb/`.
- Then run: `uv run chemlake sources verify-live --from ../slurm/sources.tsv`.
