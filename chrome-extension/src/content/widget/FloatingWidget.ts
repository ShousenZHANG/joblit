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
  onFill: () => void;
  onRecordSubmission: () => void;
  onCorrectMapping: (fieldSelector: string, newProfilePath: string) => void;
  /** Save a field correction as a knowledge base rule. */
  onSaveRule: (rule: FieldRuleData) => void;
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

type WidgetMode = "browse" | "review";

export class FloatingWidget {
  private root: HTMLDivElement;
  private collapsed = true;
  private fields: DetectedField[] = [];
  private profile: FlatProfile = {};
  private callbacks: WidgetCallbacks;
  private fillProgress: { filled: number; total: number; status: "idle" | "filling" | "done" } = {
    filled: 0, total: 0, status: "idle",
  };
  private mode: WidgetMode = "browse";
  /** Map of fieldSelector → user-edited value */
  private edits: Map<string, FieldEdit> = new Map();
  /** Which field is currently being edited (selector) */
  private editingField: string | null = null;
  /** Filled field results from last fill operation */
  private fillResults: Map<string, { filled: boolean; source: string }> = new Map();
  /** ATS provider for current page */
  private atsProvider = "";
  /** Page domain for current page */
  private pageDomain = "";

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
      this.mode = "review";
    }
    this.render();
  }

  setFillResults(results: Map<string, { filled: boolean; source: string }>): void {
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
    // Then profile
    const profileKey = PROFILE_KEY_MAP[field.category];
    return profileKey ? (this.profile[profileKey] ?? "") : "";
  }

  private getFieldStatus(field: DetectedField): "filled" | "edited" | "unfilled" | "unknown" {
    if (this.edits.has(field.selector)) return "edited";
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

    badge.addEventListener("click", () => this.toggle());
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
    badgeSpan.textContent = this.mode === "review"
      ? t("widget.review")
      : `${matched}/${this.fields.length}`;
    headerLeft.appendChild(badgeSpan);

    const headerActions = document.createElement("div");
    headerActions.className = "jf-header-actions";

    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "jf-header-btn";
    minimizeBtn.title = "Minimize";
    minimizeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    minimizeBtn.addEventListener("click", () => this.toggle());

    const closeBtn = document.createElement("button");
    closeBtn.className = "jf-header-btn";
    closeBtn.title = "Close";
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
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

    // ── Mode label bar (review mode) ──
    if (this.mode === "review") {
      const reviewBar = document.createElement("div");
      reviewBar.className = "jf-review-bar";
      reviewBar.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="#059669" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const reviewText = document.createElement("span");
      reviewText.textContent = t("widget.reviewHint");
      reviewBar.appendChild(reviewText);
      this.root.appendChild(reviewBar);
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

    if (this.mode === "review") {
      // Review mode: Save All + Done
      const hasEdits = this.edits.size > 0;

      if (hasEdits) {
        const saveAllBtn = document.createElement("button");
        saveAllBtn.className = "jf-btn-primary";
        saveAllBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5l3 3L12 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> ${t("widget.saveAll")} (${this.edits.size})`;
        saveAllBtn.addEventListener("click", () => this.handleSaveAll());
        footer.appendChild(saveAllBtn);
      }

      const doneBtn = document.createElement("button");
      doneBtn.className = hasEdits ? "jf-btn-secondary" : "jf-btn-primary";
      doneBtn.textContent = t("widget.looksGood");
      doneBtn.addEventListener("click", () => this.handleDone());
      footer.appendChild(doneBtn);
    } else {
      // Browse mode
      const hasEdits = this.edits.size > 0;

      if (hasEdits) {
        // Show Save button when user has made edits in browse mode
        const saveAllBtn = document.createElement("button");
        saveAllBtn.className = "jf-btn-primary";
        saveAllBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5l3 3L12 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> ${t("widget.saveAll")} (${this.edits.size})`;
        saveAllBtn.addEventListener("click", () => this.handleSaveAll());
        footer.appendChild(saveAllBtn);
      }

      const fillBtn = document.createElement("button");
      fillBtn.className = hasEdits ? "jf-btn-secondary" : "jf-btn-primary jf-fill-btn";
      fillBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12l3-8h6l3 8M4.5 8h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> ${t("widget.fillAll")}`;
      fillBtn.addEventListener("click", () => this.callbacks.onFill());

      footer.appendChild(fillBtn);
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
      confirmBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      confirmBtn.addEventListener("click", () => {
        this.commitEdit(field, input.value);
      });

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "jf-edit-cancel";
      cancelBtn.title = "Cancel";
      cancelBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
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
      editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M7.5 2l2.5 2.5L4 10.5H1.5V8L7.5 2z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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

      item.append(dot, label, val, editBtn);
    }

    return item;
  }

  /** Commit an edit: apply to form, save to edits map. */
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

  /** Save all edits as knowledge base rules. */
  private handleSaveAll(): void {
    for (const [selector, edit] of this.edits) {
      const field = this.fields.find((f) => f.selector === selector);
      if (!field) continue;

      // Check if value matches a profile field
      const profileMatch = matchValueToProfile(edit.value, this.profile);

      const rule: FieldRuleData = {
        fieldSelector: selector,
        fieldLabel: field.labelText || field.name || "",
        profilePath: profileMatch?.profilePath ?? field.category,
        staticValue: profileMatch ? undefined : edit.value,
        atsProvider: this.atsProvider,
        pageDomain: this.pageDomain,
        scope: "ats", // default: all sites with same ATS
      };

      this.callbacks.onSaveRule(rule);
    }

    // Record submission after saving
    this.callbacks.onRecordSubmission();

    // Clear edits and switch to browse
    this.edits.clear();
    this.mode = "browse";
    this.fillProgress = { filled: 0, total: 0, status: "idle" };
    this.render();
  }

  /** User confirms fill looks good — record and exit review. */
  private handleDone(): void {
    this.callbacks.onRecordSubmission();
    this.mode = "browse";
    this.fillProgress = { filled: 0, total: 0, status: "idle" };
    this.render();
  }

  destroy(): void {
    this.root.replaceChildren();
  }
}
