# Agent Runner output contracts

The request's `expectedJsonSchema` is authoritative. These names mirror
Joblit's strict current Agent parser and help maintainers detect drift.

## Resume

- `cvSummary`: non-empty string.
- `latestExperience.addedBullets`: zero to three non-empty strings containing additions only. Existing experience bullets remain owned by the Master Resume Profile.
- No skills field is accepted. Skills remain owned by the Master Resume Profile.

## Cover

- `cover`: single object.
- `cover.paragraphOne`, `cover.paragraphTwo`, `cover.paragraphThree`: required non-empty strings.
- The `cover` object contains only those three paragraph fields.

Return no wrapper, Markdown fence, prose preface, or keys forbidden by the supplied schema.
