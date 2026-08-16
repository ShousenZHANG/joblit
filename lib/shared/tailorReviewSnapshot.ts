import { z } from "zod";
import {
  applicationReviewSnapshotSchema,
  type ApplicationReviewSnapshot,
} from "@/lib/shared/schemas/applicationReviewSnapshot";

/**
 * The review-snapshot payload plus the candidate's own skill bank.
 *
 * `aiContent.cv.skillsSelection` stores nothing but index references into
 * `ResumeProfile.skills` — that is what stops a generation introducing a skill
 * the candidate never wrote. The consequence is that the browser cannot render
 * the selection at all without the bank those indexes address, so it travels
 * with the snapshot rather than through a second request the review panel would
 * have to wait on.
 *
 * Kept beside the base schema rather than inside it: the base is the shared
 * editor bootstrap contract, and only the tailoring dialog needs the bank.
 */
export const masterSkillGroupSchema = z
  .object({
    category: z.string(),
    items: z.array(z.string()),
  })
  .strict();

export const tailorReviewSnapshotSchema = applicationReviewSnapshotSchema.extend(
  {
    masterSkills: z.array(masterSkillGroupSchema),
  },
);

export type MasterSkillGroup = z.infer<typeof masterSkillGroupSchema>;

/** Stated as the base contract plus the bank, so the two cannot drift apart. */
export type TailorReviewSnapshot = ApplicationReviewSnapshot & {
  masterSkills: MasterSkillGroup[];
};
