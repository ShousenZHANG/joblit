import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";
import { LocalAiSetupCard } from "./LocalAiSetupCard";

const bridge = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/client/localAiBridge", () => ({
  sendLocalAiBridgeRequest: bridge.send,
}));

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LocalAiSetupCard />
    </NextIntlClientProvider>,
  );
}

describe("LocalAiSetupCard", () => {
  beforeEach(() => bridge.send.mockReset());
  afterEach(cleanup);

  it.each([
    ["ready", "Local AI Ready"],
    ["joblit_disconnected", "Joblit disconnected"],
    ["not_configured", "Hermes setup required"],
    ["unreachable", "Hermes setup required"],
    ["auth_failed", "Hermes setup required"],
    ["incompatible", "Hermes setup required"],
  ] as const)("renders %s without local secret fields", async (status, label) => {
    bridge.send.mockResolvedValueOnce({ state: status, joblitConnected: status !== "joblit_disconnected" });
    renderCard();
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key|endpoint/i)).not.toBeInTheDocument();
    expect(bridge.send).toHaveBeenCalledWith(
      "GET_STATUS",
      {},
      expect.objectContaining({ timeoutMs: 1_500 }),
    );
  });

  it("shows installation guidance when bounded detection fails", async () => {
    bridge.send.mockRejectedValueOnce(new Error("timeout"));
    renderCard();
    expect(await screen.findByText("Extension missing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install extension" })).toHaveAttribute("href", "/get-extension");
  });

  it("checks again and provides extension-settings guidance", async () => {
    const user = userEvent.setup();
    bridge.send
      .mockResolvedValueOnce({ state: "not_configured", joblitConnected: true })
      .mockResolvedValueOnce({ state: "ready", joblitConnected: true });
    renderCard();
    await screen.findByText("Hermes setup required");
    await user.click(screen.getByRole("button", { name: "Setup guidance" }));
    expect(screen.getByText(/Chrome's toolbar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByText("Local AI Ready")).toBeInTheDocument());
    expect(bridge.send).toHaveBeenCalledTimes(2);
  });

  it("labels status updates as polite and discloses browser-only beta scope", async () => {
    bridge.send.mockResolvedValueOnce({ state: "ready", joblitConnected: true });
    renderCard();
    const status = await screen.findByText("Local AI Ready");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/checked only in this browser/i)).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
