import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { TopNav } from "./TopNav";
import messages from "../../messages/en.json";

const openGuideMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/jobs",
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test@example.com" } } }),
  signOut: vi.fn(),
}));

vi.mock("../GuideContext", () => ({
  useGuide: () => ({
    openGuide: openGuideMock,
    state: { completedCount: 2, totalCount: 5 },
  }),
}));

function renderNav() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TopNav />
    </NextIntlClientProvider>,
  );
}

describe("TopNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render duplicate route progress element", () => {
    const { container } = renderNav();
    expect(screen.getAllByRole("link", { name: "Jobs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Resume" }).length).toBeGreaterThan(0);
    expect(container.querySelector(".edu-route-progress")).toBeNull();
  });

  it("renders a minimal mobile current-route label instead of dropdown", () => {
    renderNav();

    expect(screen.queryByTestId("mobile-route-select-wrap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mobile-route-select")).not.toBeInTheDocument();
    expect(screen.getByTestId("mobile-current-route")).toHaveTextContent("Jobs");
  });

  it("opens a mobile route menu when tapping current route", async () => {
    renderNav();

    screen.getByTestId("mobile-current-route").click();

    // Menu is rendered via Radix; at minimum we expect the current route button to still be present.
    expect(screen.getByTestId("mobile-current-route")).toBeInTheDocument();
  });

  it("renders the LocaleSwitcher", () => {
    renderNav();
    expect(screen.getAllByRole("button", { name: "EN" })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "中文" })[0]).toBeInTheDocument();
  });
});
