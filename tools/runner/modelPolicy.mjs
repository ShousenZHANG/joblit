/**
 * Product-owned Codex policy for unattended Joblit generation.
 *
 * Keep this explicit: the Runner deliberately ignores the user's Codex
 * config, so relying on a CLI default would make CV/CL quality change when a
 * local catalog or managed default changes. `max` is the highest official
 * single-model reasoning effort for GPT-5.6. Codex's `ultra` mode adds
 * automatic task delegation, which is outside this one-prompt/one-result
 * text-generator boundary.
 */
export const JOBLIT_CODEX_MODEL = "gpt-5.6-sol";
export const JOBLIT_CODEX_REASONING_EFFORT = "max";
