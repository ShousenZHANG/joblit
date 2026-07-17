import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";
import { LocalAiSetupCard } from "./LocalAiSetupCard";

const bridge = vi.hoisted(() => ({ detect: vi.fn() }));
vi.mock("@/lib/client/localAiBridge", () => ({
  detectLocalAiAvailability: bridge.detect,
}));

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LocalAiSetupCard />
    </NextIntlClientProvider>,
  );
}

describe("LocalAiSetupCard", () => {
  beforeEach(() => bridge.detect.mockReset());
  afterEach(cleanup);

  it.each([
    ["ready", "Local AI Ready"],
    ["joblit_disconnected", "Joblit disconnected"],
    ["not_configured", "Hermes setup required"],
    ["unreachable", "Hermes setup required"],
    ["auth_failed", "Hermes setup required"],
    ["incompatible", "Hermes setup required"],
  ] as const)("renders %s without local secret fields", async (status, label) => {
    bridge.detect.mockResolvedValueOnce(status);
    renderCard();
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key|endpoint/i)).not.toBeInTheDocument();
    expect(bridge.detect).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shows installation guidance when bounded detection fails", async () => {
    bridge.detect.mockResolvedValueOnce("extension_missing");
    renderCard();
    expect(await screen.findByText("Extension missing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install extension" })).toHaveAttribute("href", "/get-extension");
  });

  it("does not offer reinstall when the extension exists but its bridge probe fails", async () => {
    bridge.detect.mockResolvedValueOnce("bridge_error");
    renderCard();
    expect(await screen.findByText("Extension connection needs attention")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Install extension" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Setup guidance" })).toBeInTheDocument();
  });

  it("checks again and provides extension-settings guidance", async () => {
    const user = userEvent.setup();
    bridge.detect
      .mockResolvedValueOnce("not_configured")
      .mockResolvedValueOnce("ready");
    renderCard();
    await screen.findByText("Hermes setup required");
    await user.click(screen.getByRole("button", { name: "Setup guidance" }));
    expect(screen.getByText(/Chrome's toolbar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByText("Local AI Ready")).toBeInTheDocument());
    expect(bridge.detect).toHaveBeenCalledTimes(2);
  });

  it("labels status updates as polite and discloses browser-only beta scope", async () => {
    bridge.detect.mockResolvedValueOnce("ready");
    renderCard();
    const status = await screen.findByText("Local AI Ready");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/checked only in this browser/i)).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
