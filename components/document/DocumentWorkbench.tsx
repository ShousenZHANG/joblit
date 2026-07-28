"use client";

import {
  useId,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type DocumentWorkbenchPane = "editor" | "preview";

export type DocumentWorkbenchLabels = {
  tablist: string;
  editor: string;
  preview: string;
};

export type DocumentWorkbenchProps = {
  /** Compact pane selection. Wide layouts render both panes without changing it. */
  pane: DocumentWorkbenchPane;
  onPaneChange: (pane: DocumentWorkbenchPane) => void;
  labels: DocumentWorkbenchLabels;
  editor: ReactNode;
  preview: ReactNode;
  className?: string;
  /** CSS grid-template-columns used when the module enters its two-pane layout. */
  columns?: string;
};

type WorkbenchStyle = CSSProperties & {
  "--document-workbench-columns": string;
};

type WorkbenchIds = Record<
  DocumentWorkbenchPane,
  { tab: string; panel: string }
>;

type WorkbenchTabs = {
  ids: WorkbenchIds;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

type WorkbenchPaneItem = {
  pane: DocumentWorkbenchPane;
  label: string;
  content: ReactNode;
};

const DEFAULT_COLUMNS = "minmax(0, 1fr) minmax(0, 1.2fr)";
const SPLIT_PANE_QUERY = "(min-width: 1024px)";

export function DocumentWorkbench(
  props: DocumentWorkbenchProps,
): ReactElement {
  const splitPane = useSplitPaneViewport();
  const tabs = useWorkbenchTabs(props.pane, props.onPaneChange);
  const style: WorkbenchStyle = {
    "--document-workbench-columns": props.columns ?? DEFAULT_COLUMNS,
  };
  return (
    <WorkbenchFrame
      {...props}
      splitPane={splitPane}
      tabs={tabs}
      style={style}
    />
  );
}

function WorkbenchFrame({
  pane,
  onPaneChange,
  labels,
  editor,
  preview,
  className,
  splitPane,
  tabs,
  style,
}: DocumentWorkbenchProps & {
  splitPane: boolean;
  tabs: WorkbenchTabs;
  style: WorkbenchStyle;
}): ReactElement {
  return (
    <section
      data-slot="document-workbench"
      className={cn(
        "min-w-0 max-w-full overflow-x-hidden",
        "pb-[max(0px,env(safe-area-inset-bottom))]",
        "pl-[max(0px,env(safe-area-inset-left))]",
        "pr-[max(0px,env(safe-area-inset-right))]",
        className,
      )}
      style={style}
    >
      {splitPane ? null : (
        <CompactPaneTabs
          pane={pane}
          onPaneChange={onPaneChange}
          labels={labels}
          tabs={tabs}
        />
      )}
      <WorkbenchGrid
        pane={pane}
        labels={labels}
        editor={editor}
        preview={preview}
        splitPane={splitPane}
        ids={tabs.ids}
      />
    </section>
  );
}

function CompactPaneTabs({
  pane,
  onPaneChange,
  labels,
  tabs,
}: {
  pane: DocumentWorkbenchPane;
  onPaneChange: (pane: DocumentWorkbenchPane) => void;
  labels: DocumentWorkbenchLabels;
  tabs: WorkbenchTabs;
}): ReactElement {
  return (
    <div
      role="tablist"
      aria-label={labels.tablist}
      aria-orientation="horizontal"
      className="mb-4 flex items-center gap-2 rounded-full border border-border/70 bg-background p-1 lg:hidden"
    >
      <PaneTab
        id={tabs.ids.editor.tab}
        controls={tabs.ids.editor.panel}
        selected={pane === "editor"}
        onClick={() => onPaneChange("editor")}
        onKeyDown={tabs.onKeyDown}
      >
        {labels.editor}
      </PaneTab>
      <PaneTab
        id={tabs.ids.preview.tab}
        controls={tabs.ids.preview.panel}
        selected={pane === "preview"}
        onClick={() => onPaneChange("preview")}
        onKeyDown={tabs.onKeyDown}
      >
        {labels.preview}
      </PaneTab>
    </div>
  );
}

function WorkbenchGrid({
  pane,
  labels,
  editor,
  preview,
  splitPane,
  ids,
}: {
  pane: DocumentWorkbenchPane;
  labels: DocumentWorkbenchLabels;
  editor: ReactNode;
  preview: ReactNode;
  splitPane: boolean;
  ids: WorkbenchIds;
}): ReactElement {
  const items: WorkbenchPaneItem[] = [
    { pane: "editor", label: labels.editor, content: editor },
    { pane: "preview", label: labels.preview, content: preview },
  ];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[var(--document-workbench-columns)]">
      {items.map((item) => (
        <WorkbenchPane
          key={item.pane}
          item={item}
          selected={item.pane === pane}
          splitPane={splitPane}
          ids={ids[item.pane]}
        />
      ))}
    </div>
  );
}

function WorkbenchPane({
  item,
  selected,
  splitPane,
  ids,
}: {
  item: WorkbenchPaneItem;
  selected: boolean;
  splitPane: boolean;
  ids: WorkbenchIds[DocumentWorkbenchPane];
}): ReactElement {
  return (
    <div
      id={ids.panel}
      role={splitPane ? "region" : "tabpanel"}
      aria-label={splitPane ? item.label : undefined}
      aria-labelledby={splitPane ? undefined : ids.tab}
      tabIndex={splitPane ? undefined : 0}
      className={cn(
        "min-h-0 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        !splitPane && !selected && "hidden lg:block",
      )}
    >
      {item.content}
    </div>
  );
}

function useWorkbenchTabs(
  pane: DocumentWorkbenchPane,
  onPaneChange: (pane: DocumentWorkbenchPane) => void,
): WorkbenchTabs {
  const id = useId();
  const ids: WorkbenchIds = {
    editor: { tab: `${id}-editor-tab`, panel: `${id}-editor-panel` },
    preview: { tab: `${id}-preview-tab`, panel: `${id}-preview-panel` },
  };
  function selectFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    nextPane: DocumentWorkbenchPane,
  ) {
    event.preventDefault();
    onPaneChange(nextPane);
    document.getElementById(ids[nextPane].tab)?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Home") selectFromKeyboard(event, "editor");
    else if (event.key === "End") selectFromKeyboard(event, "preview");
    else if (event.key === "ArrowLeft") {
      selectFromKeyboard(event, pane === "editor" ? "preview" : "editor");
    } else if (event.key === "ArrowRight") {
      selectFromKeyboard(event, pane === "preview" ? "editor" : "preview");
    }
  }
  return { ids, onKeyDown };
}

function useSplitPaneViewport(): boolean {
  return useSyncExternalStore(
    subscribeSplitPaneViewport,
    getSplitPaneViewport,
    getServerSplitPaneViewport,
  );
}

function subscribeSplitPaneViewport(onChange: () => void): () => void {
  const media = window.matchMedia(SPLIT_PANE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSplitPaneViewport(): boolean {
  return window.matchMedia(SPLIT_PANE_QUERY).matches;
}

function getServerSplitPaneViewport(): boolean {
  return false;
}

function PaneTab({
  id,
  controls,
  selected,
  onClick,
  onKeyDown,
  children,
}: {
  id: string;
  controls: string;
  selected: boolean;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-controls={controls}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex min-h-11 min-w-11 flex-1 touch-manipulation items-center justify-center rounded-full px-4 text-sm font-semibold",
        "transition-colors duration-200 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
