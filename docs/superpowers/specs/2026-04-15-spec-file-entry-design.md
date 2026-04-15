# Spec File Entry Design

## Overview

Add support for starting MAP from a local specification file instead of only a prompt or GitHub issue. The new entry mode is for one-shot spec execution: MAP should load a spec file as the initial spec artifact, skip spec generation, and continue through the existing spec review, QA, and execution flow.

## Motivation

MAP currently assumes the initial source of work is either:

- freeform prompt text
- a GitHub issue that is converted into prompt text

That leaves a gap for users who already have a written spec and want MAP to validate and execute it directly. Today they must either paste the spec into prompt text or let MAP regenerate a spec it does not need to author. Both paths are noisy and distort the pipeline's actual starting point.

This feature should support "one-shot specs" while preserving the downstream quality gates that make MAP useful.

## Goals

- Add a `--spec-file <path>` CLI option.
- Treat the file contents as the initial spec artifact, not as freeform prompt text.
- Skip spec generation only.
- Still run spec review, spec QA, and the existing execution path.
- Preserve the normal feedback/refinement loop with the loaded file as iteration 1.
- Make the resulting reports explicit that the run started from a spec file.

## Non-Goals

- Replacing prompt-based entry.
- Replacing GitHub issue entry.
- Adding support for multiple file formats beyond UTF-8 text and Markdown in the first pass.
- Changing v2 routing unless there is already a clean reviewed-spec entry path.
- Treating a spec file as already approved and skipping review/QA.

## User Experience

### CLI shape

Add:

```bash
map --spec-file docs/spec.md
map --headless --spec-file docs/spec.md
```

Expected behavior:

- MAP reads the file as UTF-8 text.
- The loaded text becomes the initial spec draft.
- The classic pipeline skips spec generation and enters review.
- Review feedback or QA loops refine the loaded draft as iteration 1.

### Input validation

`--spec-file` should be mutually exclusive with:

- raw prompt text
- `--github-issue`

This avoids ambiguous primary sources.

`--spec-file` should fail clearly when:

- the path is missing
- the file does not exist
- the file cannot be read
- the file is empty after trimming

### v2 behavior

For the initial rollout, `--spec-file` should be classic-mode-only unless the v2 execution path already supports a clean "review existing spec" entry. If that path does not already exist, then:

- `map --v2 --spec-file ...`
- `map --headless --v2 --spec-file ...`

should fail with a clear message rather than pretending to support the feature.

## Proposed Design

### 1. Add `initialSpec` as a distinct runtime input

Do not overload `prompt` with spec file contents. Prompt text and pre-authored specs are different inputs with different semantics.

Add a new runtime option such as:

```ts
initialSpec?: string;
specFilePath?: string;
```

Recommended behavior:

- `prompt` remains the source for spec generation
- `initialSpec` means the pipeline starts with a pre-authored spec
- `specFilePath` is retained only for reporting, diagnostics, and user-facing summaries

### 2. Branch the classic pipeline start state

Classic mode should support two entry paths:

1. Prompt path
   - `prompt` is provided
   - pipeline starts with spec generation

2. Spec-file path
   - `initialSpec` is provided
   - pipeline skips spec generation
   - review uses the loaded spec as the current draft

This should be modeled as a real alternate start path, not as fake generated output.

### 3. Preserve review and QA loops

The first review cycle must treat the loaded spec as iteration 1. That means:

- review reads the loaded file contents directly
- spec QA evaluates the reviewed version as usual
- if the user gives feedback or the headless loop triggers refinement, refinement starts from the loaded draft instead of pretending MAP generated the first version

This preserves the integrity of the downstream workflow while avoiding a redundant authoring stage.

### 4. Reporting and result shape

Headless and final reports should state that the run started from a spec file.

Recommended additions:

- include the resolved `specFilePath` in the result when provided
- mention the spec file source in the final markdown report
- ensure any "spec generated" wording is updated so it does not misrepresent the run

## File Changes

Likely files:

- `src/cli-runner.ts`
- `src/cli-args.ts`
- `src/headless/runner.ts`
- classic pipeline startup/runtime files under `src/pipeline/` or `src/tui/` that currently assume `START` always carries prompt text
- `src/types/headless.ts`
- `src/types/pipeline.ts`
- `src/utils/prompt-validation.ts`
- `README.md`
- CLI/help tests and headless runner tests

Possible additional files:

- TUI welcome or pipeline runner files if interactive mode also needs spec-file support from startup args

## Validation Rules

`--spec-file` support should enforce:

- exactly one primary input source:
  - prompt text
  - GitHub issue
  - spec file
- `--spec-file` cannot be combined with prompt text
- `--spec-file` cannot be combined with `--github-issue`
- `--spec-file` cannot be combined with `--v2` in the first rollout unless v2 support is intentionally implemented

## Testing Plan

### CLI argument tests

Add tests that:

- parse `--spec-file <path>`
- reject `--spec-file` mixed with prompt text
- reject `--spec-file` mixed with `--github-issue`
- reject `--spec-file --v2` if classic-only rollout is chosen

### Headless runner tests

Add tests that:

- load a spec file and skip spec generation
- enter review with the file contents as the current spec
- preserve later QA/execution stages
- report the spec-file source in the result

### Interactive/TUI tests

If startup args are wired through the TUI path, add tests that:

- pass `initialSpec` into the runtime
- start from review rather than spec generation

### Documentation tests

Update help snapshots and README examples so the new entry path is visible and accurate.

## Risks and Tradeoffs

### Risk: spec-file mode becomes a fake prompt path

Mitigation: keep `initialSpec` separate from `prompt` in the runtime model.

### Risk: reporting becomes misleading

Mitigation: explicitly record that the run started from a spec file and remove wording that implies MAP authored the initial draft.

### Risk: v2 support is bolted on incorrectly

Mitigation: keep the first rollout classic-only unless the v2 path can support a proper reviewed-spec entry.

### Risk: refinement logic assumes a generated first spec

Mitigation: update the pipeline start state so the loaded spec is treated as iteration 1 instead of a fake generation result.

## Recommendation

Implement `--spec-file <path>` as a classic-mode entry path that introduces a distinct `initialSpec` runtime field, skips only spec generation, and preserves review/QA/execution as-is. This gives MAP a clean one-shot spec workflow without collapsing prompt input and spec input into the same concept.
