import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "./providers";

const providerTestState = vi.hoisted(() => ({
  reducedMotionValues: [] as unknown[],
}));

vi.mock("framer-motion", () => ({
  MotionConfig: ({
    children,
    reducedMotion,
  }: {
    children: ReactNode;
    reducedMotion: unknown;
  }) => {
    providerTestState.reducedMotionValues.push(reducedMotion);
    return <>{children}</>;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClient: class QueryClient {},
  QueryClientProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("nextjs-toploader", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => null,
}));

vi.mock("@/components/providers/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./FetchProgressPanel", () => ({
  FetchProgressPanel: () => null,
}));

vi.mock("./FetchStatusContext", () => ({
  FetchStatusProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  providerTestState.reducedMotionValues.length = 0;
});

afterEach(cleanup);

describe("Providers", () => {
  it("configures user reduced motion without delaying rendered content", () => {
    render(
      <Providers>
        <main>Server-rendered content</main>
      </Providers>,
    );

    expect(providerTestState.reducedMotionValues).toEqual(["user"]);
    expect(screen.getByText("Server-rendered content")).toBeInTheDocument();
  });
});
