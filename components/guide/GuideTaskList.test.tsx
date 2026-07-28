import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";
import { GuideTaskList } from "./GuideTaskList";

describe("GuideTaskList touch contract", () => {
  it("keeps current and upcoming task actions touch-sized on coarse pointers", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <GuideTaskList
          checklist={{
            resume_setup: false,
            first_fetch: false,
            review_jobs: false,
            generate_first_pdf: false,
            mark_applied: false,
          }}
          activeTaskId="resume_setup"
          onNavigate={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("button", { name: messages.guide.takeMeThere }),
    ).toHaveClass("[@media(any-pointer:coarse)]:min-h-11");
    expect(
      screen.getByRole("button", {
        name: messages.guide.task_first_fetch_title,
      }),
    ).toHaveClass("[@media(any-pointer:coarse)]:min-h-11");
  });
});
