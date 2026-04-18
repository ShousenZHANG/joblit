import type { ExternalPromptMeta } from "../types";

const SKILL_PACK_META_STORAGE_KEY = "joblit.skill-pack-meta.v1";

function isValidPromptMeta(value: unknown): value is ExternalPromptMeta {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ruleSetId === "string" &&
    record.ruleSetId.length > 0 &&
    typeof record.resumeSnapshotUpdatedAt === "string" &&
    record.resumeSnapshotUpdatedAt.length > 0 &&
    (record.promptTemplateVersion === undefined ||
      typeof record.promptTemplateVersion === "string") &&
    (record.schemaVersion === undefined || typeof record.schemaVersion === "string") &&
    (record.skillPackVersion === undefined || typeof record.skillPackVersion === "string") &&
    (record.promptHash === undefined || typeof record.promptHash === "string")
  );
}

function readSavedSkillPackMeta(): ExternalPromptMeta | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SKILL_PACK_META_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isValidPromptMeta(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSavedSkillPackMeta(meta: ExternalPromptMeta) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SKILL_PACK_META_STORAGE_KEY, JSON.stringify(meta));
}

export function isSkillPackFresh(required: ExternalPromptMeta | null): boolean {
  if (!required) return false;
  const saved = readSavedSkillPackMeta();
  if (!saved) return false;
  if (required.skillPackVersion && saved.skillPackVersion) {
    return saved.skillPackVersion === required.skillPackVersion;
  }
  const baseMatches =
    saved.ruleSetId === required.ruleSetId &&
    saved.resumeSnapshotUpdatedAt === required.resumeSnapshotUpdatedAt;
  if (!baseMatches) return false;

  const templateMatches =
    !required.promptTemplateVersion || saved.promptTemplateVersion === required.promptTemplateVersion;
  const schemaMatches = !required.schemaVersion || saved.schemaVersion === required.schemaVersion;
  return templateMatches && schemaMatches;
}
