import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldCategory } from "@ext/shared/fieldTaxonomy";
import type { DetectedField } from "@ext/shared/types";
import { FloatingWidget } from "./FloatingWidget";

function detectedField(element: HTMLInputElement, overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    element,
    selector: `#${element.id}`,
    inputType: "text",
    category: FieldCategory.FULL_NAME,
    confidence: 0.98,
    labelText: "Full name",
    name: element.name,
    id: element.id,
    placeholder: "",
    ...overrides,
  };
}

function createWidget(onSaveRule = vi.fn().mockResolvedValue(true)) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const callbacks = {
    onRecordSubmission: vi.fn(),
    onCorrectMapping: vi.fn(),
    onSaveRule,
    onApplyValue: vi.fn(),
    onSavePosition: vi.fn(),
  };
  const widget = new FloatingWidget(container, callbacks);
  return { container, callbacks, widget };
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("FloatingWidget announcements", () => {
  it("announces submission-recording failures assertively", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const widget = new FloatingWidget(container, {
      onRecordSubmission: vi.fn(),
      onCorrectMapping: vi.fn(),
      onSaveRule: vi.fn().mockResolvedValue(true),
      onApplyValue: vi.fn(),
      onSavePosition: vi.fn(),
    });

    widget.showSubmissionError();

    const toast = container.querySelector(".jf-toast");
    expect(toast?.getAttribute("role")).toBe("alert");
    expect(toast?.getAttribute("aria-live")).toBe("assertive");

    widget.destroy();
    container.remove();
  });
});

describe("FloatingWidget draft capture", () => {
  it("keeps an intentionally cleared inline edit as a pending draft", () => {
    const hostInput = document.createElement("input");
    hostInput.id = "candidate-name";
    document.body.appendChild(hostInput);
    const { container, callbacks, widget } = createWidget();

    widget.setFields([detectedField(hostInput)]);
    widget.setProfile({ fullName: "Alice" });
    widget.toggle();
    container.querySelector<HTMLButtonElement>(".jf-edit-btn")?.click();
    const editor = container.querySelector<HTMLInputElement>(".jf-edit-input");
    expect(editor?.value).toBe("Alice");
    if (editor) editor.value = "";
    container.querySelector<HTMLButtonElement>(".jf-edit-confirm")?.click();

    expect(callbacks.onApplyValue).toHaveBeenCalledWith("#candidate-name", "");
    expect(container.querySelector(".jf-btn-primary")).not.toBeNull();

    widget.destroy();
  });

  it("keeps the latest value while a user continues typing in the host form", () => {
    const hostInput = document.createElement("input");
    hostInput.id = "candidate-name";
    hostInput.name = "candidateName";
    document.body.appendChild(hostInput);
    const { container, widget } = createWidget();

    widget.setFields([detectedField(hostInput)]);
    widget.setFillProgress(0, 1, "done");

    hostInput.value = "A";
    hostInput.dispatchEvent(new Event("input", { bubbles: true }));
    hostInput.value = "Alice Chen";
    hostInput.dispatchEvent(new Event("input", { bubbles: true }));
    widget.toggle();

    expect(container.querySelector(".jf-field-value")?.textContent).toBe("Alice Chen");

    widget.destroy();
  });

  it("keeps an explicit empty draft when a user clears the host field", async () => {
    const hostInput = document.createElement("input");
    hostInput.id = "candidate-name";
    hostInput.name = "candidateName";
    document.body.appendChild(hostInput);
    const onSaveRule = vi.fn().mockResolvedValue(true);
    const { container, widget } = createWidget(onSaveRule);

    widget.setFields([detectedField(hostInput)]);
    widget.setFillProgress(0, 1, "done");

    hostInput.value = "Alice";
    hostInput.dispatchEvent(new Event("input", { bubbles: true }));
    hostInput.value = "";
    hostInput.dispatchEvent(new Event("input", { bubbles: true }));
    widget.toggle();
    container.querySelector<HTMLButtonElement>(".jf-btn-primary")?.click();

    await vi.waitFor(() => {
      expect(onSaveRule).toHaveBeenCalledWith(expect.objectContaining({ staticValue: "" }));
      expect(container.querySelector(".jf-toast")?.getAttribute("role")).toBe("status");
      expect(container.querySelector(".jf-header-badge")?.textContent).toBe("0/1");
    });

    widget.destroy();
  });
});

describe("FloatingWidget review controls", () => {
  it("opens from the collapsed control through the native click activation path", () => {
    const { container, widget } = createWidget();

    container.querySelector<HTMLButtonElement>(".jf-collapsed")?.click();

    expect(container.querySelector(".jf-header")).not.toBeNull();

    widget.destroy();
  });

  it("does not swallow the next activation when a drag ends without a click event", async () => {
    const { container, widget } = createWidget();
    const badge = container.querySelector<HTMLButtonElement>(".jf-collapsed");

    badge?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    badge?.click();

    expect(container.querySelector(".jf-header")).not.toBeNull();

    widget.destroy();
  });

  it("shows actual fill completion and exposes an accessible determinate progressbar", () => {
    const first = document.createElement("input");
    first.id = "first-name";
    const second = document.createElement("input");
    second.id = "last-name";
    document.body.append(first, second);
    const { container, widget } = createWidget();
    const fields = [
      detectedField(first, { category: FieldCategory.FIRST_NAME, labelText: "First name" }),
      detectedField(second, { category: FieldCategory.LAST_NAME, labelText: "Last name" }),
    ];

    widget.setFields(fields);
    widget.setFillResults(new Map([
      [fields[0].selector, { filled: true, source: "profile", value: "Alice" }],
      [fields[1].selector, { filled: false, source: "skipped", value: "" }],
    ]));
    widget.setFillProgress(1, 2, "done");
    widget.toggle();

    expect(container.querySelector(".jf-header-badge")?.textContent).toBe("1/2");
    const progress = container.querySelector<HTMLElement>("[role='progressbar']");
    expect(progress?.getAttribute("aria-valuemin")).toBe("0");
    expect(progress?.getAttribute("aria-valuenow")).toBe("1");
    expect(progress?.getAttribute("aria-valuemax")).toBe("2");
    expect(container.querySelector<HTMLElement>(".jf-fill-progress-bar")?.style.width).toBe("50%");

    widget.destroy();
  });

  it("offers one unambiguous collapse action instead of duplicate minimize and close actions", () => {
    const { container, widget } = createWidget();
    widget.toggle();

    const controls = container.querySelectorAll<HTMLButtonElement>(".jf-header-btn");
    expect(controls).toHaveLength(1);
    expect(controls[0].getAttribute("aria-label")).toBe("Collapse widget");

    widget.destroy();
  });

  it("keeps a successful save toast mounted after the widget rerenders", async () => {
    const hostInput = document.createElement("input");
    hostInput.id = "candidate-name";
    document.body.appendChild(hostInput);
    const onSaveRule = vi.fn().mockResolvedValue(true);
    const { container, widget } = createWidget(onSaveRule);

    widget.setFields([detectedField(hostInput)]);
    widget.setFillProgress(0, 1, "done");
    hostInput.value = "Alice";
    hostInput.dispatchEvent(new Event("input", { bubbles: true }));
    widget.toggle();
    container.querySelector<HTMLButtonElement>(".jf-btn-primary")?.click();

    await vi.waitFor(() => {
      expect(onSaveRule).toHaveBeenCalledTimes(1);
      expect(container.querySelector(".jf-toast")?.getAttribute("role")).toBe("status");
    });

    widget.destroy();
  });
});
