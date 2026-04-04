/**
 * Vanilla JS floating widget — renders inside Shadow DOM.
 * No React dependency in the content script to keep bundle small.
 */

import type { DetectedField } from "@ext/shared/types";
import { FieldCategory, PROFILE_KEY_MAP } from "@ext/shared/fieldTaxonomy";
import { t } from "@ext/shared/i18n";
import type { FlatProfile } from "../filler/formFiller";


export interface WidgetCallbacks {
  onFill: () => void;
  onRecordSubmission: () => void;
  onCorrectMapping: (fieldSelector: string, newProfilePath: string) => void;
}

export class FloatingWidget {
  private root: HTMLDivElement;
  private collapsed = true;
  private fields: DetectedField[] = [];
  private profile: FlatProfile = {};
  private callbacks: WidgetCallbacks;

  constructor(container: HTMLDivElement, callbacks: WidgetCallbacks) {
    this.root = container;
    this.callbacks = callbacks;
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

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.render();
  }

  private getMatchedCount(): number {
    return this.fields.filter(
      (f) => f.category !== FieldCategory.UNKNOWN && f.confidence > 0.15,
    ).length;
  }

  private getConfidenceClass(confidence: number): string {
    if (confidence >= 0.6) return "jf-confidence-high";
    if (confidence >= 0.3) return "jf-confidence-medium";
    return "jf-confidence-low";
  }

  private render(): void {
    if (this.collapsed) {
      this.renderCollapsed();
    } else {
      this.renderExpanded();
    }
  }

  private renderCollapsed(): void {
    const matched = this.getMatchedCount();
    this.root.innerHTML = "";

    // Reset expanded styles
    this.root.style.width = "";
    this.root.style.maxHeight = "";
    this.root.style.background = "";
    this.root.style.borderRadius = "";
    this.root.style.boxShadow = "";

    const badge = document.createElement("div");
    badge.className = "jf-collapsed";

    const logo = document.createElement("span");
    logo.className = "jf-logo";
    logo.textContent = "J";
    badge.appendChild(logo);

    if (matched > 0) {
      const count = document.createElement("span");
      count.className = "jf-collapsed-badge";
      count.textContent = String(matched);
      badge.appendChild(count);
    }

    badge.addEventListener("click", () => this.toggle());
    this.root.appendChild(badge);
  }

  private renderExpanded(): void {
    this.root.innerHTML = "";

    // Restore expanded styles
    this.root.style.width = "320px";
    this.root.style.maxHeight = "480px";
    this.root.style.background = "#fff";
    this.root.style.borderRadius = "12px";
    this.root.style.boxShadow = "0 8px 32px rgba(0,0,0,0.12)";

    const matched = this.getMatchedCount();

    // Header
    const header = document.createElement("div");
    header.className = "jf-header";

    const headerLeft = document.createElement("div");
    const title = document.createElement("span");
    title.className = "jf-header-title";
    title.textContent = "Jobflow";
    const badgeSpan = document.createElement("span");
    badgeSpan.className = "jf-header-badge";
    badgeSpan.textContent = `${matched}/${this.fields.length}`;
    headerLeft.append(title, badgeSpan);

    const headerActions = document.createElement("div");
    headerActions.className = "jf-header-actions";
    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "jf-header-btn";
    minimizeBtn.title = "Minimize";
    minimizeBtn.textContent = "_";
    minimizeBtn.addEventListener("click", () => this.toggle());
    const closeBtn = document.createElement("button");
    closeBtn.className = "jf-header-btn";
    closeBtn.title = "Close";
    closeBtn.textContent = "x";
    closeBtn.addEventListener("click", () => this.toggle());
    headerActions.append(minimizeBtn, closeBtn);

    header.append(headerLeft, headerActions);
    this.root.appendChild(header);

    // Body — field list
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
        const profileKey = PROFILE_KEY_MAP[field.category];
        const value = profileKey ? (this.profile[profileKey] ?? "") : "";

        const item = document.createElement("li");
        item.className = "jf-field-item";

        const dot = document.createElement("span");
        dot.className = `jf-confidence ${this.getConfidenceClass(field.confidence)}`;

        const label = document.createElement("span");
        label.className = "jf-field-label";
        label.title = field.labelText;
        label.textContent = field.labelText || field.name || "—";

        const val = document.createElement("span");
        val.className = "jf-field-value";
        val.title = value;
        val.textContent = value || "—";

        item.append(dot, label, val);
        list.appendChild(item);
      }

      body.appendChild(list);
    }

    this.root.appendChild(body);

    // Footer
    const footer = document.createElement("div");
    footer.className = "jf-footer";
    const fillBtn = document.createElement("button");
    fillBtn.className = "jf-btn-primary jf-fill-btn";
    fillBtn.textContent = t("widget.fillAll");
    const recordBtn = document.createElement("button");
    recordBtn.className = "jf-btn-secondary jf-record-btn";
    recordBtn.textContent = t("widget.record");
    footer.appendChild(fillBtn);
    footer.appendChild(recordBtn);
    this.root.appendChild(footer);

    fillBtn.addEventListener("click", () => this.callbacks.onFill());
    recordBtn.addEventListener("click", () => this.callbacks.onRecordSubmission());
  }

  destroy(): void {
    this.root.innerHTML = "";
  }
}
