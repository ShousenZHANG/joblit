import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

// SectionShell reads focus-mode state from the resume context; this test
// exercises the section in isolation, so stub the shell down to its children.
vi.mock("../SectionShell", () => ({
  SectionShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { SkillsSection } from "./SkillsSection";
import type { ResumeCertification, ResumeSkillGroup } from "../types";
import messages from "@/messages/en.json";

function renderSection(options: {
  certifications?: ResumeCertification[];
  onUpdateCertification?: (index: number, field: "name" | "url", value: string) => void;
  onAddCertification?: () => void;
  onRemoveCertification?: (index: number) => void;
} = {}) {
  const skills: ResumeSkillGroup[] = [
    { rowId: "skill-1", category: "Frontend", itemsText: "React" },
  ];
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SkillsSection
        skills={skills}
        updateSkillGroup={vi.fn()}
        addSkillGroup={vi.fn()}
        removeSkillGroup={vi.fn()}
        onMove={vi.fn()}
        expandedIds={new Set()}
        onToggleExpanded={vi.fn()}
        onCollapseAll={vi.fn()}
        certifications={options.certifications ?? []}
        onUpdateCertification={options.onUpdateCertification ?? vi.fn()}
        onAddCertification={options.onAddCertification ?? vi.fn()}
        onRemoveCertification={options.onRemoveCertification ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

const cert = (overrides: Partial<ResumeCertification> = {}): ResumeCertification => ({
  rowId: "cert-1",
  name: "Microsoft Certified: AI Agent Builder Associate",
  url: "https://learn.microsoft.com/verify",
  ...overrides,
});

describe("SkillsSection certifications", () => {
  it("starts with no rows and adds one from the ghost row", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const view = within(renderSection({ onAddCertification: onAdd }).container);

    expect(
      view.queryByPlaceholderText(messages.resumeForm.certificationNamePlaceholder),
    ).not.toBeInTheDocument();

    await user.click(
      view.getByRole("button", { name: messages.resumeForm.addCertification }),
    );
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("edits name and url through the row inputs", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const view = within(
      renderSection({
        certifications: [cert({ name: "", url: "" })],
        onUpdateCertification: onUpdate,
      }).container,
    );

    await user.type(
      view.getByPlaceholderText(messages.resumeForm.certificationNamePlaceholder),
      "A",
    );
    expect(onUpdate).toHaveBeenCalledWith(0, "name", "A");

    await user.type(
      view.getByPlaceholderText(messages.resumeForm.certificationUrlPlaceholder),
      "h",
    );
    expect(onUpdate).toHaveBeenCalledWith(0, "url", "h");
  });

  it("removes a row and hides the add row at the six-cert cap", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const six = Array.from({ length: 6 }, (_, i) =>
      cert({ rowId: `cert-${i}`, name: `Cert ${i}` }),
    );
    const view = within(
      renderSection({ certifications: six, onRemoveCertification: onRemove }).container,
    );

    expect(
      view.queryByRole("button", { name: messages.resumeForm.addCertification }),
    ).not.toBeInTheDocument();

    await user.click(view.getByRole("button", { name: /Remove Cert 0/i }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
