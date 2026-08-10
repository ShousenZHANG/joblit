import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import type { JobItem } from "../types";
import { JobListItem } from "./JobListItem";

function baseJob(): JobItem {
  return {
    id: "job-row",
    title: "Platform Engineer",
    company: "Acme",
    location: "Sydney",
    jobUrl: "https://example.com/job-row",
    status: "NEW",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  } as JobItem;
}

function renderJobListItem({
  locale = "en",
}: {
  locale?: "en" | "zh";
} = {}) {
  const messages = locale === "zh" ? zhMessages : enMessages;

  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      now={new Date("2026-07-28T00:00:00.000Z")}
    >
      <JobListItem
        job={baseJob()}
        isActive
        onSelectJob={vi.fn()}
        timeZone="Australia/Sydney"
      />
    </NextIntlClientProvider>,
  );
}


afterEach(cleanup);

describe("JobListItem", () => {
  it("renders the row", () => {
    renderJobListItem();

    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
  });

  it("limits its 180ms motion to composited and visual properties", () => {
    renderJobListItem();

    const surface = screen.getByRole("listitem").firstElementChild;
    expect(surface).toHaveClass("duration-[180ms]");
    expect(surface).toHaveClass(
      "transition-[background-color,border-color,box-shadow,transform]",
    );
    expect(surface).toHaveClass("motion-reduce:transition-none");
    expect(surface).not.toHaveClass("transition-all");
  });

  it("renders the row under the Chinese locale", () => {
    renderJobListItem({ locale: "zh" });

    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
  });
});
