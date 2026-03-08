import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useMarket } from "@/hooks/useMarket";

function wrapper(locale: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={{}}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

describe("useMarket", () => {
  it("returns AU for en locale", () => {
    const { result } = renderHook(() => useMarket(), { wrapper: wrapper("en") });
    expect(result.current).toBe("AU");
  });

  it("returns CN for zh locale", () => {
    const { result } = renderHook(() => useMarket(), { wrapper: wrapper("zh") });
    expect(result.current).toBe("CN");
  });
});
