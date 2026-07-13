import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldCategory } from "@ext/shared/fieldTaxonomy";

const runtimeMocks = vi.hoisted(() => ({
  advanceMultiStepForm: vi.fn(),
  detectForms: vi.fn(),
  fillFields: vi.fn(),
  highlightUnfilledFields: vi.fn(() => vi.fn()),
  mountWidget: vi.fn(),
  sendMessage: vi.fn(),
  widgetCallbacks: null as null | {
    onSaveRule: (rule: {
      fieldSelector: string;
      fieldLabel: string;
      profilePath: string;
      staticValue?: string;
      atsProvider: string;
      pageDomain: string;
      scope: "site" | "ats" | "global";
    }) => Promise<boolean>;
  },
}));

vi.mock("./detector/formDetector", () => ({ detectForms: runtimeMocks.detectForms }));
vi.mock("./filler/formFiller", () => ({
  advanceMultiStepForm: runtimeMocks.advanceMultiStepForm,
  fillFields: runtimeMocks.fillFields,
  highlightUnfilledFields: runtimeMocks.highlightUnfilledFields,
}));
vi.mock("@ext/shared/messaging", () => ({ sendMessage: runtimeMocks.sendMessage }));
vi.mock("@ext/shared/jobContext", () => ({ isJobApplicationContext: () => false }));
vi.mock("./widget/mount", () => ({
  isWidgetMounted: () => false,
  mountWidget: runtimeMocks.mountWidget,
  unmountWidget: vi.fn(),
}));
vi.mock("./widget/FloatingWidget", () => ({
  FloatingWidget: class {
    constructor(_container: HTMLDivElement, callbacks: NonNullable<typeof runtimeMocks.widgetCallbacks>) {
      runtimeMocks.widgetCallbacks = callbacks;
    }
    setFields() {}
    setAtsProvider() {}
    setProfile() {}
    toggle() {}
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  runtimeMocks.widgetCallbacks = null;
  document.body.replaceChildren();
});

describe("content-script fill runtime", () => {
  it("leaves multi-step navigation under user control after filling", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    delete (globalThis as typeof globalThis & { __joblitContentScriptInstalled__?: boolean })
      .__joblitContentScriptInstalled__;

    const input = document.createElement("input");
    input.id = "candidate-name";
    document.body.appendChild(input);
    const field = {
      element: input,
      selector: "#candidate-name",
      inputType: "text",
      category: FieldCategory.FULL_NAME,
      confidence: 0.98,
      labelText: "Full name",
      name: "candidateName",
      id: "candidate-name",
      placeholder: "",
    };
    runtimeMocks.detectForms.mockReturnValue({ atsProvider: "generic", fields: [field], forms: [] });
    runtimeMocks.fillFields.mockReturnValue({
      filled: 1,
      skipped: 0,
      fields: [{ selector: field.selector, filled: true, source: "profile", value: "Alice" }],
    });
    runtimeMocks.advanceMultiStepForm.mockReturnValue(true);
    runtimeMocks.sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_FLAT_PROFILE") {
        return { success: true, data: { flat: { fullName: "Alice" } } };
      }
      return { success: true, data: [] };
    });

    let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] | undefined;
    vi.spyOn(chrome.runtime.onMessage, "addListener").mockImplementation((candidate) => {
      listener = candidate;
    });
    await import("./index");
    expect(listener).toBeDefined();

    const response = new Promise<unknown>((resolveResponse) => {
      listener?.(
        { type: "TRIGGER_FILL" },
        {} as chrome.runtime.MessageSender,
        resolveResponse,
      );
    });
    await response;
    await vi.advanceTimersByTimeAsync(2_000);

    expect(runtimeMocks.fillFields).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.advanceMultiStepForm).not.toHaveBeenCalled();
  });

  it("forwards an intentionally cleared draft to the mapping API", async () => {
    vi.resetModules();
    delete (globalThis as typeof globalThis & { __joblitContentScriptInstalled__?: boolean })
      .__joblitContentScriptInstalled__;

    const input = document.createElement("input");
    input.id = "candidate-name";
    const field = {
      element: input,
      selector: "#candidate-name",
      inputType: "text",
      category: FieldCategory.FULL_NAME,
      confidence: 0.98,
      labelText: "Full name",
      name: "candidateName",
      id: "candidate-name",
      placeholder: "",
    };
    runtimeMocks.detectForms.mockReturnValue({ atsProvider: "generic", fields: [field], forms: [] });
    runtimeMocks.mountWidget.mockReturnValue({
      container: document.createElement("div"),
      shadowRoot: document.createElement("div"),
    });
    runtimeMocks.sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_FLAT_PROFILE") {
        return { success: true, data: { flat: { fullName: "Alice" } } };
      }
      return { success: true, data: {} };
    });

    let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] | undefined;
    vi.spyOn(chrome.runtime.onMessage, "addListener").mockImplementation((candidate) => {
      listener = candidate;
    });
    await import("./index");

    await new Promise<void>((resolveResponse) => {
      listener?.(
        { type: "TOGGLE_WIDGET" },
        {} as chrome.runtime.MessageSender,
        () => resolveResponse(),
      );
    });
    expect(runtimeMocks.widgetCallbacks).not.toBeNull();

    await runtimeMocks.widgetCallbacks?.onSaveRule({
      fieldSelector: "#candidate-name",
      fieldLabel: "Full name",
      profilePath: "fullName",
      staticValue: "",
      atsProvider: "generic",
      pageDomain: "jobs.example.com",
      scope: "ats",
    });

    expect(runtimeMocks.sendMessage).toHaveBeenCalledWith({
      type: "PUT_FIELD_MAPPING",
      data: expect.objectContaining({
        fieldSelector: "#candidate-name",
        staticValue: "",
      }),
    });
  });
});
