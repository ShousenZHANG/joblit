# Local AI output contracts

The request's `expectedJsonSchema` is authoritative. These names mirror Joblit's strict Local AI parser and help maintainers detect drift.

## Resume

- `cvSummary`: non-empty string.
- `latestExperience.bullets`: non-empty string array. Preserve required source bullets under prompt rules.
- `skillsFinal`: optional array of `{ "label": string, "items": string[] }` groups.
- `skillsAdditions`: optional array of `{ "category": string, "items": string[] }` groups.

## Cover

- `cover`: single object.
- `cover.paragraphOne`, `cover.paragraphTwo`, `cover.paragraphThree`: required non-empty strings.
- `cover.candidateTitle`, `cover.subject`, `cover.date`, `cover.salutation`, `cover.closing`, and `cover.signatureName`: optional strings governed by the request.

Return no wrapper, Markdown fence, prose preface, or keys forbidden by the supplied schema.
