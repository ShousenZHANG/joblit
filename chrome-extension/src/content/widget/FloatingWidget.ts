/**
 * Vanilla JS floating widget — renders inside Shadow DOM.
 * No React dependency in the content script to keep bundle small.
 */

import type { DetectedField } from "@ext/shared/types";
import { FieldCategory, PROFILE_KEY_MAP } from "@ext/shared/fieldTaxonomy";
import type { FlatProfile } from "../filler/formFiller";

/** Escape HTML entities to prevent XSS when inserting user-controlled text. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

  setProfile(profile: FlatProfile): void {
    this.profile = profile;
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
    badge.innerHTML = `
      <span class="jf-logo">J</span>
      ${matched > 0 ? `<span class="jf-collapsed-badge">${matched}</span>` : ""}
    `;
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
    header.innerHTML = `
      <div>
        <span class="jf-header-title">Jobflow</span>
        <span class="jf-header-badge">${matched}/${this.fields.length}</span>
      </div>
      <div class="jf-header-actions">
        <button class="jf-header-btn jf-minimize-btn" title="Minimize">_</button>
        <button class="jf-header-btn jf-close-btn" title="Close">x</button>
      </div>
    `;
    this.root.appendChild(header);

    header.querySelector(".jf-minimize-btn")?.addEventListener("click", () => this.toggle());
    header.querySelector(".jf-close-btn")?.addEventListener("click", () => this.toggle());

    // Body — field list
    const body = document.createElement("div");
    body.className = "jf-body";

    if (this.fields.length === 0) {
      body.innerHTML = '<div class="jf-empty">No form fields detected on this page.</div>';
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
    footer.innerHTML = `
      <button class="jf-btn-primary jf-fill-btn">Fill All</button>
      <button class="jf-btn-secondary jf-record-btn">Record</button>
    `;
    this.root.appendChild(footer);

    footer.querySelector(".jf-fill-btn")?.addEventListener("click", () => this.callbacks.onFill());
    footer.querySelector(".jf-record-btn")?.addEventListener("click", () => this.callbacks.onRecordSubmission());
  }

  destroy(): void {
    this.root.innerHTML = "";
  }
}
