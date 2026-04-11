/**
 * Input simulator that triggers proper React/Angular/Vue change events.
 *
 * Modern SPA frameworks intercept the native value setter. Setting `.value`
 * directly doesn't trigger state updates. We use the native HTMLInputElement
 * prototype setter + synthetic events to work around this.
 */

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

  // Dispatch events in the order frameworks expect
  // Use InputEvent for 'input' — React 16+ listens for this specific type
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

/** Simulate selecting an option in a <select> element. */
export function simulateSelect(el: HTMLSelectElement, value: string): boolean {
  const options = Array.from(el.options);
  const normalized = value.toLowerCase().trim();

  // Try exact value match, then case-insensitive text match, then partial match
  const target =
    options.find((opt) => opt.value === value) ??
    options.find((opt) => opt.textContent?.trim().toLowerCase() === normalized) ??
    options.find((opt) => opt.textContent?.trim().toLowerCase().includes(normalized));

  if (!target) return false;

  el.value = target.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** Simulate selecting a radio button in a group. */
export function simulateRadio(
  radioGroup: HTMLInputElement[],
  value: string,
): boolean {
  const normalized = value.toLowerCase().trim();

  // Match by value, then by associated label text
  const target =
    radioGroup.find((r) => r.value.toLowerCase() === normalized) ??
    radioGroup.find((r) => {
      const label =
        r.labels?.[0]?.textContent?.trim().toLowerCase() ??
        r.parentElement?.textContent?.trim().toLowerCase() ??
        "";
      return label === normalized || label.includes(normalized);
    });

  if (!target) return false;

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
  const normalizedValue = value.toLowerCase().trim();

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

    // Search for matching option across the entire document
    // (many frameworks render dropdown portals at document body)
    for (const selector of optionSelectors) {
      const options = document.querySelectorAll(selector);
      for (const option of options) {
        const text = (option.textContent ?? "").trim().toLowerCase();
        const dataValue = (option as HTMLElement).dataset.value?.toLowerCase();
        if (text === normalizedValue || dataValue === normalizedValue || text.includes(normalizedValue)) {
          (option as HTMLElement).click();
          trigger.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
    }
  }

  return false;
}
