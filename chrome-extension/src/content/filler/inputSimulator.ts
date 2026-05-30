/**
 * Input simulator that triggers proper React/Angular/Vue change events.
 *
 * Modern SPA frameworks intercept the native value setter. Setting `.value`
 * directly doesn't trigger state updates. We use the native HTMLInputElement
 * prototype setter + synthetic events to work around this.
 */

import { findBestOptionIndex } from "./selectOptionMatch";

/** Get the native value setter for an input element. */
function getNativeInputValueSetter(): ((this: HTMLInputElement, v: string) => void) | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  return descriptor?.set;
}

function getNativeTextAreaValueSetter(): ((this: HTMLTextAreaElement, v: string) => void) | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  );
  return descriptor?.set;
}

/** Simulate typing a value into an input/textarea element. */
export function simulateInput(el: HTMLElement, value: string): void {
  if (el instanceof HTMLInputElement) {
    const nativeSetter = getNativeInputValueSetter();
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  } else if (el instanceof HTMLTextAreaElement) {
    const nativeSetter = getNativeTextAreaValueSetter();
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  } else if (el.getAttribute("contenteditable") === "true") {
    el.textContent = value;
  } else {
    return;
  }

  // Dispatch events in the order frameworks expect.
  // - beforeinput: some frameworks (Vue 3, Angular) listen for this
  // - input: React 16+ listens for this specific type via native event delegation
  // - composed: true is required for events to cross shadow DOM boundaries (React 17+)
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true, composed: true }));
  el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, composed: true, inputType: "insertText", data: value }));
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true, composed: true }));
}

/** Simulate selecting an option in a <select> element. */
export function simulateSelect(el: HTMLSelectElement, value: string): boolean {
  const options = Array.from(el.options);

  // Alias/normalization-aware matching: handles country/state code <-> full
  // name ("Australia" <-> "AU", "New South Wales" <-> "NSW") and guards loose
  // substring matches against short-value false positives.
  const idx = findBestOptionIndex(
    options.map((opt) => ({ value: opt.value, text: opt.textContent ?? "" })),
    value,
  );
  if (idx === -1) return false;
  const target = options[idx];

  // Use native setter for React controlled selects (same pattern as simulateInput)
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(el, target.value);
  } else {
    el.value = target.value;
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  return true;
}

/** Simulate selecting a radio button in a group. */
export function simulateRadio(
  radioGroup: HTMLInputElement[],
  value: string,
): boolean {
  if (radioGroup.length === 0) return false;

  // Same alias/normalization-aware matcher as selects: a radio's "text" is its
  // associated label, its "value" is the input value. Handles Yes/No, country
  // and code↔name radio groups, with guarded substring fallback.
  const idx = findBestOptionIndex(
    radioGroup.map((r) => ({
      value: r.value,
      text:
        r.labels?.[0]?.textContent?.trim() ??
        r.parentElement?.textContent?.trim() ??
        "",
    })),
    value,
  );
  if (idx === -1) return false;
  const target = radioGroup[idx];

  target.checked = true;
  target.dispatchEvent(new Event("change", { bubbles: true }));
  target.dispatchEvent(new Event("click", { bubbles: true }));
  return true;
}

/** Simulate checking/unchecking a checkbox. */
export function simulateCheckbox(el: HTMLInputElement, checked: boolean): void {
  if (el.checked !== checked) {
    el.checked = checked;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("click", { bubbles: true }));
  }
}

/**
 * Simulate interaction with a custom (non-native) dropdown component.
 * Handles React/Vue/Angular custom select/combobox components.
 *
 * The trigger may be the combobox container (a <div>) or an <input> inside it.
 * We find the best clickable element to open the dropdown, and for searchable
 * inputs we also type the value to filter the option list.
 *
 * Retries with increasing delays to handle slow-rendering dropdowns.
 */
export async function simulateCustomDropdown(
  trigger: HTMLElement,
  value: string,
): Promise<boolean> {
  const DELAYS = [200, 500, 1000];

  // Find the best element to click to open the dropdown.
  // If trigger is a container div, look for an input or focusable child inside it.
  const clickTarget =
    trigger instanceof HTMLInputElement
      ? trigger
      : trigger.querySelector<HTMLElement>('input, [role="combobox"], [tabindex]') ?? trigger;

  // Find a searchable text input inside the container (for type-to-filter).
  // Only use inputs that are explicitly searchable (not readonly, not hidden, has autocomplete role).
  const searchInput =
    clickTarget instanceof HTMLInputElement && !clickTarget.readOnly && clickTarget.type !== "hidden"
      ? clickTarget
      : trigger.querySelector<HTMLInputElement>('input[aria-autocomplete]:not([readonly])');

  const optionSelectors = [
    '[role="option"]',
    '[role="menuitem"]',
    'li[data-value]',
    '.option',
    '[class*="option"]',
    '[class*="Option"]',
  ];

  for (const delay of DELAYS) {
    // Open (or re-open) the dropdown
    clickTarget.focus();
    clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    clickTarget.click();

    // For searchable dropdowns, type the value to filter the option list
    if (searchInput) {
      simulateInput(searchInput, value);
    }

    // Wait for options to render
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Search for a matching option across the entire document (many frameworks
    // render dropdown portals at document.body). Use the same alias-aware
    // matcher as native <select> so "Australia" hits an "AU" option, etc.
    for (const selector of optionSelectors) {
      const optionEls = Array.from(document.querySelectorAll<HTMLElement>(selector));
      if (optionEls.length === 0) continue;
      const idx = findBestOptionIndex(
        optionEls.map((o) => ({ value: o.dataset.value ?? "", text: o.textContent ?? "" })),
        value,
      );
      if (idx !== -1) {
        optionEls[idx].click();
        trigger.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
  }

  return false;
}
