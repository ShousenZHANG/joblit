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
    expect(screen.getAllByRole("link", { name: "Automation" }).length).toBeGreaterThan(0);
    expect(container.querySelector(".edu-route-progress")).toBeNull();
  });

  it("renders a dedicated mobile route dropdown", () => {
    renderNav();

    expect(screen.getAllByTestId("mobile-route-select-wrap")[0]).toBeInTheDocument();
    expect(screen.getAllByTestId("mobile-route-select")[0]).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-tab-nav")).not.toBeInTheDocument();
  });

  it("renders the LocaleSwitcher", () => {
    renderNav();
    expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
  });
});
