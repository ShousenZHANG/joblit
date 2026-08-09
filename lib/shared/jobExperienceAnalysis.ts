/**
 * Stable public seam for deterministic job-experience analysis.
 *
 * Parsing, ownership inference, relation grouping and compatibility details
 * stay private to `jobExperience/`; callers need only this versioned contract
 * and the pure `analyzeJobExperience` function.
 */
export * from "./jobExperience/analyzer";
export * from "./jobExperience/presentation";
