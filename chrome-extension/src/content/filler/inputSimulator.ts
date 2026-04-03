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
  el.dispatchEvent(new Event("focus", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

/** Simulate selecting an option in a <select> element. */
export function simulateSelect(el: HTMLSelectElement, value: string): boolean {
  const options = Array.from(el.options);
  const target = options.find(
    (opt) =>
      opt.value === value ||
      opt.textContent?.trim().toLowerCase() === value.toLowerCase(),
  );

  if (!target) return false;

  el.value = target.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
