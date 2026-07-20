import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import CareerPage from "./page";

describe("retired Career route", () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it("redirects existing bookmarks to the Jobs workspace", () => {
    CareerPage();

    expect(redirectMock).toHaveBeenCalledWith("/jobs");
  });
});
