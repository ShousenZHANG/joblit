import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";
import { JobSearchBar } from "./JobSearchBar";

describe("JobSearchBar", () => {
  it("gives the search field a localized stable label", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <JobSearchBar
          q=""
          onQueryChange={vi.fn()}
          onSubmit={vi.fn()}
          placeholder={messages.jobs.placeholder}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByText("Search saved jobs", { selector: "label" }),
    ).not.toHaveClass("sr-only");
    expect(screen.getByRole("textbox", { name: "Search saved jobs" })).toHaveClass(
      "[@media(any-pointer:coarse)]:min-h-11",
    );
  });
});
