/**
 * Vanilla JS floating widget — renders inside Shadow DOM.
 * Supports inline field editing and post-fill review mode.
 * No React dependency in the content script to keep bundle small.
 */

import type { DetectedField } from "@ext/shared/types";
import { FieldCategory, PROFILE_KEY_MAP } from "@ext/shared/fieldTaxonomy";
import { t } from "@ext/shared/i18n";
import type { FlatProfile } from "../filler/formFiller";
import { matchValueToProfile } from "@ext/shared/profileMatcher";


export interface WidgetCallbacks {
  onRecordSubmission: () => void;
  onCorrectMapping: (fieldSelector: string, newProfilePath: string) => void;
  /** Save a field correction as a knowledge base rule. Returns true if persisted. */
  onSaveRule: (rule: FieldRuleData) => Promise<boolean>;
  /** Apply a value to a form field immediately. */
  onApplyValue: (fieldSelector: string, value: string) => void;
}

export interface FieldRuleData {
  fieldSelector: string;
  fieldLabel: string;
  profilePath: string;
  staticValue?: string;
  atsProvider: string;
  pageDomain: string;
  scope: "site" | "ats" | "global";
}

/** Tracks user edits during a session. */
interface FieldEdit {
  value: string;
  source: "user";
}

export class FloatingWidget {
  private root: HTMLDivElement;
  private collapsed = true;
  private fields: DetectedField[] = [];
  private profile: FlatProfile = {};
  private callbacks: WidgetCallbacks;
  private fillProgress: { filled: number; total: number; status: "idle" | "filling" | "done" } = {
    filled: 0, total: 0, status: "idle",
  };
  /** True while saveAllEdits is in progress — prevents double-submit. */
  private saving = false;
  /** Map of fieldSelector → user-edited value */
  private edits: Map<string, FieldEdit> = new Map();
  /** Which field is currently being edited (selector) */
  private editingField: string | null = null;
  /** Filled field results from last fill operation (includes actual values) */
  private fillResults: Map<string, { filled: boolean; source: string; value: string }> = new Map();
  /** ATS provider for current page */
  private atsProvider = "";
  /** Page domain for current page */
  private pageDomain = "";
  /** Poll timer for detecting field changes after fill. */
  private fieldPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Last-known DOM values per field — used to detect external changes. */
  private lastFieldValues: Map<string, string> = new Map();
  /** Cleanup functions for event listeners added after fill. */
  private fieldChangeCleanups: (() => void)[] = [];

  constructor(container: HTMLDivElement, callbacks: WidgetCallbacks) {
    this.root = container;
    this.callbacks = callbacks;
    this.pageDomain = window.location.hostname;
    this.render();
  }

  setFields(fields: DetectedField[]): void {
    this.fields = fields;
    this.render();
  }

  setProfile(profile: FlatProfile | null | undefined): void {
    this.profile = profile ?? {};
    this.render();
  }

  setAtsProvider(provider: string): void {
    this.atsProvider = provider;
  }

  setFillProgress(filled: number, total: number, status: "idle" | "filling" | "done"): void {
    this.fillProgress = { filled, total, status };
    if (status === "done") {
      // Start watching for manual field changes (e.g. dropdown selections)
      this.startWatchingFields();
    }
    this.render();
  }

  setFillResults(results: Map<string, { filled: boolean; source: string; value: string }>): void {
    this.fillResults = results;
    this.render();
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.render();
  }

  private getMatchedCount(): number {
    return this.fields.filter(
      (f) => f.category !== FieldCategory.UNKNOWN && f.confidence > 0.15,
    ).length;
  }

  private getFieldValue(field: DetectedField): string {
    // User edit takes priority
    const edit = this.edits.get(field.selector);
    if (edit) return edit.value;
    // Then fill results (includes KB/historical values)
    const fillResult = this.fillResults.get(field.selector);
    if (fillResult?.filled && fillResult.value) return fillResult.value;
    // Then profile
    const profileKey = PROFILE_KEY_MAP[field.category];
    return profileKey ? (this.profile[profileKey] ?? "") : "";
  }

  private getFieldStatus(field: DetectedField): "filled" | "edited" | "unfilled" | "unknown" {
    if (this.edits.has(field.selector)) return "edited";
    // Check fill results (includes KB/historical fills)
    const fillResult = this.fillResults.get(field.selector);
    if (fillResult?.filled && fillResult.value) return "filled";
    if (field.category === FieldCategory.UNKNOWN || field.confidence < 0.15) return "unknown";
    const profileKey = PROFILE_KEY_MAP[field.category];
    const value = profileKey ? (this.profile[profileKey] ?? "") : "";
    return value ? "filled" : "unfilled";
  }

  private getStatusDotClass(status: string): string {
    switch (status) {
      case "filled": return "jf-dot-filled";
      case "edited": return "jf-dot-edited";
      case "unfilled": return "jf-dot-unfilled";
      default: return "jf-dot-unknown";
    }
  }

  private render(): void {
    if (this.collapsed) {
      this.renderCollapsed();
    } else {
      this.renderExpanded();
    }
  }

  private logoSvg(size: number): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
      <circle cx="10.5" cy="10.5" r="5" stroke="white" stroke-width="2" fill="none"/>
      <line x1="14" y1="14" x2="18" y2="18" stroke="white" stroke-width="2" stroke-linecap="round"/>
      <path d="M8.5 10.5h4M10.5 8.5v4" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }

  private renderCollapsed(): void {
    const matched = this.getMatchedCount();
    const editCount = this.edits.size;
    this.root.replaceChildren();

    this.root.style.width = "";
    this.root.style.maxHeight = "";
    this.root.style.background = "";
    this.root.style.borderRadius = "";
    this.root.style.boxShadow = "";

    const badge = document.createElement("div");
    badge.className = "jf-collapsed";

    const logoSpan = document.createElement("span");
    logoSpan.className = "jf-logo";
    logoSpan.innerHTML = this.logoSvg(22);
    badge.appendChild(logoSpan);

    const total = matched + editCount;
    if (total > 0) {
      const count = document.createElement("span");
      count.className = "jf-collapsed-badge";
      count.textContent = String(total);
      badge.appendChild(count);
      badge.classList.add("jf-collapsed--has-fields");
    }

    // Drag-to-reposition: distinguish click (<3px) from drag
    let startX = 0, startY = 0, dragging = false;
    badge.addEventListener("mousedown", (e: MouseEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.abs(dx) + Math.abs(dy) > 3) dragging = true;
        if (dragging) {
          const host = document.getElementById("joblit-autofill-widget");
          if (!host) return;
          const rect = host.getBoundingClientRect();
          const newRight = Math.max(0, window.innerWidth - rect.right - dx);
          const newBottom = Math.max(0, window.innerHeight - rect.bottom - dy);
          this.root.style.right = `${newRight}px`;
          this.root.style.bottom = `${newBottom}px`;
          startX = ev.clientX;
          startY = ev.clientY;
        }
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (!dragging) {
          this.toggle();
        } else {
          // Persist position
          const right = this.root.style.right;
          const bottom = this.root.style.bottom;
          chrome.storage.local.set({ widgetPosition: { right, bottom } });
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    this.root.appendChild(badge);
  }

  private renderExpanded(): void {
    this.root.replaceChildren();

    this.root.style.width = "340px";
    this.root.style.maxHeight = "520px";
    this.root.style.background = "#fff";
    this.root.style.borderRadius = "14px";
    this.root.style.boxShadow = "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)";

    const matched = this.getMatchedCount();

    // ── Header ──
    const header = document.createElement("div");
    header.className = "jf-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "jf-header-left";

    const logoSpan = document.createElement("span");
    logoSpan.className = "jf-header-logo-icon";
    logoSpan.innerHTML = this.logoSvg(16);
    headerLeft.appendChild(logoSpan);

    const title = document.createElement("span");
    title.className = "jf-header-title";
    title.textContent = "Joblit";
    headerLeft.appendChild(title);

    const badgeSpan = document.createElement("span");
    badgeSpan.className = "jf-header-badge";
    badgeSpan.textContent = `${matched}/${this.fields.length}`;
    headerLeft.appendChild(badgeSpan);

    const headerActions = document.createElement("div");
    headerActions.className = "jf-header-actions";

    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "jf-header-btn";
    minimizeBtn.title = "Minimize";
    minimizeBtn.setAttribute("aria-label", "Minimize widget");
    minimizeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    minimizeBtn.addEventListener("click", () => this.toggle());

    const closeBtn = document.createElement("button");
    closeBtn.className = "jf-header-btn";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close widget");
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    closeBtn.addEventListener("click", () => this.toggle());

    headerActions.append(minimizeBtn, closeBtn);
    header.append(headerLeft, headerActions);
    this.root.appendChild(header);

    // ── Fill progress bar ──
    if (this.fillProgress.status !== "idle") {
      const progressWrap = document.createElement("div");
      progressWrap.className = "jf-fill-progress";

      const progressBar = document.createElement("div");
      progressBar.className = "jf-fill-progress-bar";

      if (this.fillProgress.status === "filling") {
        const pct = this.fillProgress.total > 0
          ? Math.round((this.fillProgress.filled / this.fillProgress.total) * 100)
          : 0;
        progressBar.style.width = `${pct}%`;
        progressBar.classList.add("jf-fill-progress-bar--active");
      } else {
        progressBar.style.width = "100%";
        progressBar.classList.add("jf-fill-progress-bar--done");
      }

      progressWrap.appendChild(progressBar);
      this.root.appendChild(progressWrap);
    }

    // ── Body — field list ──
    const body = document.createElement("div");
    body.className = "jf-body";

    if (this.fields.length === 0) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "jf-empty";
      emptyDiv.textContent = t("widget.noFields");
      body.appendChild(emptyDiv);
    } else {
      const list = document.createElement("ul");
      list.className = "jf-field-list";

      for (const field of this.fields) {
        list.appendChild(this.renderFieldItem(field));
      }

      body.appendChild(list);
    }

    this.root.appendChild(body);

    // ── Footer ──
    const footer = document.createElement("div");
    footer.className = "jf-footer";

    if (this.edits.size > 0) {
      // Pending edits: show "Save N Changes" + "Discard"
      const actions = document.createElement("div");
      actions.className = "jf-footer-actions";

      const saveBtn = document.createElement("button");
      saveBtn.className = "jf-btn-primary";
      saveBtn.textContent = t("widget.saveChanges", { count: this.edits.size });
      saveBtn.disabled = this.saving;
      saveBtn.addEventListener("click", () => this.saveAllEdits());

      const discardBtn = document.createElement("button");
      discardBtn.className = "jf-btn-secondary";
      discardBtn.textContent = t("widget.skip");
      discardBtn.addEventListener("click", () => {
        this.edits.clear();
        this.render();
      });

      actions.append(saveBtn, discardBtn);
      footer.appendChild(actions);
    }

    this.root.appendChild(footer);

    // Focus the editing input if one is active
    if (this.editingField) {
      const input = this.root.querySelector<HTMLInputElement>(".jf-edit-input");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }

  private renderFieldItem(field: DetectedField): HTMLLIElement {
    const value = this.getFieldValue(field);
    const status = this.getFieldStatus(field);
    const isEditing = this.editingField === field.selector;

    const item = document.createElement("li");
    item.className = `jf-field-item ${isEditing ? "jf-field-item--editing" : ""}`;

    // Status dot
    const dot = document.createElement("span");
    dot.className = `jf-confidence ${this.getStatusDotClass(status)}`;
    dot.title = status;

    // Label
    const label = document.createElement("span");
    label.className = "jf-field-label";
    label.title = field.labelText;
    label.textContent = field.labelText || field.name || "—";

    if (isEditing) {
      // ── Editing mode ──
      const inputWrap = document.createElement("div");
      inputWrap.className = "jf-edit-wrap";

      const input = document.createElement("input");
      input.className = "jf-edit-input";
      input.type = "text";
      input.value = value;
      input.placeholder = t("widget.typeValue");

      // Confirm on Enter, cancel on Escape
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.commitEdit(field, input.value);
        } else if (e.key === "Escape") {
          this.editingField = null;
          this.render();
        }
      });

      const confirmBtn = document.createElement("button");
      confirmBtn.className = "jf-edit-confirm";
      confirmBtn.title = "Confirm";
      confirmBtn.setAttribute("aria-label", "Confirm edit");
      confirmBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      confirmBtn.addEventListener("click", () => {
        this.commitEdit(field, input.value);
      });

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "jf-edit-cancel";
      cancelBtn.title = "Cancel";
      cancelBtn.setAttribute("aria-label", "Cancel edit");
      cancelBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      cancelBtn.addEventListener("click", () => {
        this.editingField = null;
        this.render();
      });

      inputWrap.append(input, confirmBtn, cancelBtn);
      item.append(dot, label, inputWrap);
    } else {
      // ── Display mode ──
      const val = document.createElement("span");
      val.className = `jf-field-value ${status === "edited" ? "jf-field-value--edited" : ""} ${status === "unknown" || status === "unfilled" ? "jf-field-value--empty" : ""}`;
      val.title = value || t("widget.clickToAdd");
      val.textContent = value || (status === "unknown" ? "?" : "—");

      // Edit button (visible on hover)
      const editBtn = document.createElement("button");
      editBtn.className = "jf-edit-btn";
      editBtn.title = t("widget.edit");
      editBtn.setAttribute("aria-label", `${t("widget.edit")}: ${field.labelText || field.name || "field"}`);
      editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2l2.5 2.5L4 10.5H1.5V8L7.5 2z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editingField = field.selector;
        this.render();
      });

      // Click on value to edit too
      val.addEventListener("click", () => {
        this.editingField = field.selector;
        this.render();
      });

      // Source badge (only for filled fields)
      const fillResult = this.fillResults.get(field.selector);
      if (fillResult?.filled && fillResult.source && fillResult.source !== "skipped") {
        const badge = document.createElement("span");
        badge.className = "jf-source-badge";
        if (fillResult.source === "profile") {
          badge.style.cssText = "font-size:9px;padding:1px 4px;border-radius:4px;margin-left:4px;background:#f0fdf4;color:#065f46;border:1px solid #d1fae5;";
          badge.textContent = "profile";
        } else if (fillResult.source === "historical") {
          badge.style.cssText = "font-size:9px;padding:1px 4px;border-radius:4px;margin-left:4px;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;";
          badge.textContent = "historical";
        }
        item.append(dot, label, val, badge, editBtn);
      } else {
        item.append(dot, label, val, editBtn);
      }
    }

    return item;
  }

  /** Commit an edit: apply value to form immediately, defer DB save until explicit Save click. */
  private commitEdit(field: DetectedField, value: string): void {
    const trimmed = value.trim();

    if (trimmed) {
      this.edits.set(field.selector, { value: trimmed, source: "user" });
      // Apply value to the actual form field immediately
      this.callbacks.onApplyValue(field.selector, trimmed);
    } else {
      this.edits.delete(field.selector);
    }

    this.editingField = null;
    this.render();
  }

  /** Batch-save all pending edits to the knowledge base. */
  private async saveAllEdits(): Promise<void> {
    if (this.saving) return;
    const entries = Array.from(this.edits.entries());
    if (entries.length === 0) return;

    this.saving = true;
    this.render(); // Show disabled save button immediately

    try {
      const savedSelectors: string[] = [];

      for (const [selector, edit] of entries) {
        const field = this.fields.find((f) => f.selector === selector);
        if (!field) continue;
        const ok = await this.saveFieldRule(field, edit.value);
        if (ok) savedSelectors.push(selector);
      }

      const savedCount = savedSelectors.length;
      if (savedCount === entries.length) {
        this.showToast(t("widget.allSaved"));
      } else {
        this.showToast(t("widget.partialSaved", { saved: savedCount, total: entries.length }));
      }

      // Promote ONLY successfully saved edits into fillResults
      for (const selector of savedSelectors) {
        const edit = this.edits.get(selector);
        if (edit) {
          this.fillResults.set(selector, { filled: true, source: "historical", value: edit.value });
        }
        this.edits.delete(selector);
      }
      // Failed edits remain in this.edits for retry
    } finally {
      this.saving = false;
      this.render();
    }
  }

  /** Persist a single field edit as a knowledge base rule. */
  private async saveFieldRule(field: DetectedField, value: string): Promise<boolean> {
    const profileMatch = matchValueToProfile(value, this.profile);
    // Map category to profile key (e.g. "first_name" → "firstName")
    const profileKey = PROFILE_KEY_MAP[field.category];

    const rule: FieldRuleData = {
      fieldSelector: field.selector,
      fieldLabel: field.labelText || field.name || "",
      profilePath: profileMatch?.profilePath ?? profileKey ?? field.category,
      // Always store staticValue — user explicitly chose this value over the profile
      staticValue: value,
      atsProvider: this.atsProvider,
      pageDomain: this.pageDomain,
      scope: "ats",
    };

    return this.callbacks.onSaveRule(rule);
  }

  /** Show a brief toast notification inside the widget. */
  private showToast(message: string): void {
    const existing = this.root.querySelector(".jf-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "jf-toast";
    toast.textContent = message;
    this.root.appendChild(toast);

    setTimeout(() => toast.remove(), 2000);
  }

  // ── Field change detection (review mode) ──

  private static PLACEHOLDER_RE = /^(select\.{0,3}|choose\.{0,3}|请选择|-- .+ --)$/i;
  private static ARROW_RE = /[▼▾▸►◄↓↑⌄⌃\u25bc\u25be\ue5cf]/g;

  /** Start watching form field values to detect manual user changes (e.g. dropdown selection). */
  private startWatchingFields(): void {
    this.stopWatchingFields();
    // Snapshot current DOM values
    for (const field of this.fields) {
      this.lastFieldValues.set(field.selector, this.readFieldValueFromDOM(field));
    }

    // Fast path: document-level event delegation catches native select/input changes instantly
    const onChangeCapture = () => this.checkFieldChanges();
    document.addEventListener("change", onChangeCapture, { capture: true });
    document.addEventListener("input", onChangeCapture, { capture: true });
    this.fieldChangeCleanups.push(
      () => document.removeEventListener("change", onChangeCapture, { capture: true }),
      () => document.removeEventListener("input", onChangeCapture, { capture: true }),
    );

    // Slow path: poll every 800ms for custom dropdown changes that don't fire native events
    this.fieldPollTimer = setInterval(() => this.checkFieldChanges(), 800);
  }

  /** Stop watching for field changes and clean up all listeners. */
  private stopWatchingFields(): void {
    if (this.fieldPollTimer) {
      clearInterval(this.fieldPollTimer);
      this.fieldPollTimer = null;
    }
    for (const cleanup of this.fieldChangeCleanups) cleanup();
    this.fieldChangeCleanups = [];
    this.lastFieldValues.clear();
  }

  /** Read the current value of a form field directly from the DOM. */
  private readFieldValueFromDOM(field: DetectedField): string {
    let el: HTMLElement | null = null;
    try {
      el = field.selector ? document.querySelector<HTMLElement>(field.selector) : null;
    } catch { /* invalid selector */ }
    if (!el) el = field.element as HTMLElement;

    // 1. Native <select> — read selected option text
    if (el instanceof HTMLSelectElement) {
      const opt = el.options[el.selectedIndex];
      return opt ? (opt.text || opt.value).trim() : "";
    }

    // 2. Check if this element lives inside a custom dropdown container.
    //    Custom dropdowns (React Select, Workday, Greenhouse) render a visible
    //    display element but may NOT update the native input.value.
    const dropdownText = this.readDropdownDisplayText(el, field.labelText);
    if (dropdownText) return dropdownText;

    // 3. Native input/textarea — read .value (works when framework updates native value)
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value.trim();
    }

    // 4. Fallback for other custom elements
    return (el.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  /** Walk up from an element to find a dropdown container and read its displayed selection text. */
  private readDropdownDisplayText(el: HTMLElement, labelText: string): string {
    const VALUE_SELECTORS =
      '[class*="singleValue"], [class*="SingleValue"], ' +
      '[class*="selected-option"], [class*="selectedOption"], ' +
      '[class*="current-selection"], [class*="placeholder"], [data-value]';

    // Step 1: Walk up to find the first dropdown container
    let dropdownNode: HTMLElement | null = null;
    let node: HTMLElement | null = el;
    for (let depth = 0; depth < 4 && node; depth++) {
      const role = node.getAttribute("role");
      const cls = node.className?.toLowerCase?.() ?? "";
      if (
        role === "combobox" || role === "listbox" ||
        node.dataset?.automationId?.includes("Dropdown") ||
        cls.includes("select-menu") || cls.includes("dropdown") ||
        cls.includes("combobox") || cls.includes("listbox")
      ) {
        dropdownNode = node;
        break;
      }
      node = node.parentElement;
    }
    if (!dropdownNode) return "";

    // Step 2: Search for value display text from the dropdown node upward.
    // React Select puts the singleValue div as a SIBLING of the input, so
    // when dropdownNode is the input itself we must check parent containers.
    let container: HTMLElement | null = dropdownNode;
    for (let up = 0; up < 3 && container; up++) {
      const valueEl = container.querySelector(VALUE_SELECTORS);
      const valueText = valueEl?.textContent?.trim();
      if (valueText && !FloatingWidget.PLACEHOLDER_RE.test(valueText)) {
        return valueText;
      }
      container = container.parentElement;
    }

    // Step 3: Fallback — read textContent from the dropdown's parent (skip input itself)
    const textSource = dropdownNode instanceof HTMLInputElement
      ? (dropdownNode.parentElement ?? dropdownNode)
      : dropdownNode;
    let text = (textSource.textContent ?? "")
      .replace(FloatingWidget.ARROW_RE, "")
      .replace(/\s+/g, " ")
      .trim();
    if (labelText && text.startsWith(labelText)) {
      text = text.slice(labelText.length).trim();
    }
    if (text && !FloatingWidget.PLACEHOLDER_RE.test(text)) return text;

    return "";
  }

  /** Compare DOM values against snapshots; add new external edits to the edits map. */
  private checkFieldChanges(): void {
    let changed = false;

    for (const field of this.fields) {
      // Skip fields the user is actively editing in the widget or already edited
      if (this.edits.has(field.selector) || this.editingField === field.selector) continue;

      const currentValue = this.readFieldValueFromDOM(field);
      const lastValue = this.lastFieldValues.get(field.selector) ?? "";

      // Skip empty or placeholder values
      if (!currentValue || FloatingWidget.PLACEHOLDER_RE.test(currentValue)) continue;

      if (currentValue !== lastValue) {
        this.lastFieldValues.set(field.selector, currentValue);
        // Only register as edit if different from the already-filled value
        const existingValue = this.getFieldValue(field);
        if (currentValue !== existingValue) {
          this.edits.set(field.selector, { value: currentValue, source: "user" });
          changed = true;
        }
      }
    }

    if (changed) this.render();
  }

  /** Record submission (called externally when user submits the form). */
  recordSubmission(): void {
    this.callbacks.onRecordSubmission();
  }

  destroy(): void {
    this.stopWatchingFields();
    this.root.replaceChildren();
  }
}
