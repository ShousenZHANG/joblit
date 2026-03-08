import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

function renderWithLocale(locale: string) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  );
}

describe("LocaleSwitcher", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    document.cookie = "locale=; max-age=0";
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders EN and 中文 buttons", () => {
    renderWithLocale("en");
    expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
  });

  it("highlights EN when locale is en", () => {
    renderWithLocale("en");
    const enBtn = screen.getByRole("button", { name: "EN" });
    expect(enBtn.className).toContain("bg-slate-900");
  });

  it("highlights 中文 when locale is zh", () => {
    renderWithLocale("zh");
    const zhBtn = screen.getByRole("button", { name: "中文" });
    expect(zhBtn.className).toContain("bg-slate-900");
  });

  it("sets cookie and localStorage on switch to zh", async () => {
    renderWithLocale("en");
    await userEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(localStorage.getItem("locale")).toBe("zh");
    expect(document.cookie).toContain("locale=zh");
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("does not refresh when clicking already-active locale", async () => {
    renderWithLocale("en");
    await userEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
