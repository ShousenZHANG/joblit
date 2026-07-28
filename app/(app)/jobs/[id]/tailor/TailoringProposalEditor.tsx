import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { BulletsSection } from "./BulletsSection";
import { CoverParagraphsSection } from "./CoverParagraphsSection";
import { SummarySection } from "./SummarySection";
import type { TailorTarget } from "./tailorActions";

type TailoringProposalEditorProps = {
  target: TailorTarget;
  content: AiContent;
  onUpdate: (updater: (current: AiContent) => AiContent) => void;
};

export function TailoringProposalEditor({
  target,
  content,
  onUpdate,
}: TailoringProposalEditorProps) {
  if (target === "cover") {
    return (
      <CoverParagraphsSection
        cover={content.cover}
        onChange={(cover) => {
          onUpdate((current) => ({ ...current, cover }));
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SummarySection
        summary={content.cv.summary}
        onChange={(summary) => {
          onUpdate((current) => ({
            ...current,
            cv: { ...current.cv, summary },
          }));
        }}
      />
      <BulletsSection
        latestExperience={content.cv.latestExperience}
        onChange={(latestExperience) => {
          onUpdate((current) => ({
            ...current,
            cv: { ...current.cv, latestExperience },
          }));
        }}
      />
    </div>
  );
}
