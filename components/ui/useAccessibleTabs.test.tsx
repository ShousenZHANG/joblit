import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useAccessibleTabs } from "./useAccessibleTabs";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState<"list" | "detail">("list");
  const tabs = useAccessibleTabs({
    id: "jobs-mobile",
    value,
    values: ["list", "detail"] as const,
    onValueChange: setValue,
  });

  return (
    <>
      <div aria-label="Job views" {...tabs.tabListProps}>
        <button {...tabs.getTabProps("list")}>List</button>
        <button {...tabs.getTabProps("detail")}>Detail</button>
      </div>
      <section {...tabs.getPanelProps("list")}>List panel</section>
      <section {...tabs.getPanelProps("detail")}>Detail panel</section>
    </>
  );
}

function ManualHarness() {
  const [value, setValue] = useState<"first" | "second">("first");
  const tabs = useAccessibleTabs({
    id: "resume-sections",
    value,
    values: ["first", "second"] as const,
    onValueChange: setValue,
    activationMode: "manual",
  });

  return (
    <>
      <div aria-label="Resume sections" {...tabs.tabListProps}>
        <button {...tabs.getTabProps("first")}>First</button>
        <button {...tabs.getTabProps("second")}>Second</button>
      </div>
      <section {...tabs.getPanelProps("first")}>First panel</section>
      <section {...tabs.getPanelProps("second")}>Second panel</section>
    </>
  );
}

describe("useAccessibleTabs", () => {
  it("links the tablist, tabs, and panels and activates tabs on click", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const tabList = screen.getByRole("tablist", { name: "Job views" });
    const list = screen.getByRole("tab", { name: "List" });
    const detail = screen.getByRole("tab", { name: "Detail" });
    const listPanel = screen.getByText("List panel");
    const detailPanel = screen.getByText("Detail panel");

    expect(tabList).toBeInTheDocument();
    expect(tabList).toHaveAttribute("id", "jobs-mobile-tablist");
    expect(list).toHaveAttribute("id", "jobs-mobile-tab-list");
    expect(list).toHaveAttribute("aria-controls", "jobs-mobile-panel-list");
    expect(list).toHaveAttribute("aria-selected", "true");
    expect(list).toHaveAttribute("tabindex", "0");
    expect(detail).toHaveAttribute("id", "jobs-mobile-tab-detail");
    expect(detail).toHaveAttribute(
      "aria-controls",
      "jobs-mobile-panel-detail",
    );
    expect(detail).toHaveAttribute("aria-selected", "false");
    expect(detail).toHaveAttribute("tabindex", "-1");
    expect(listPanel).toHaveAttribute("id", "jobs-mobile-panel-list");
    expect(listPanel).toHaveAttribute("role", "tabpanel");
    expect(listPanel).toHaveAttribute(
      "aria-labelledby",
      "jobs-mobile-tab-list",
    );
    expect(listPanel).toHaveAttribute("tabindex", "0");
    expect(listPanel).not.toHaveAttribute("hidden");
    expect(detailPanel).toHaveAttribute("id", "jobs-mobile-panel-detail");
    expect(detailPanel).toHaveAttribute("role", "tabpanel");
    expect(detailPanel).toHaveAttribute(
      "aria-labelledby",
      "jobs-mobile-tab-detail",
    );
    expect(detailPanel).toHaveAttribute("hidden");

    await user.click(detail);

    expect(detail).toHaveAttribute("aria-selected", "true");
    expect(detail).toHaveAttribute("tabindex", "0");
    expect(list).toHaveAttribute("tabindex", "-1");
    expect(detailPanel).not.toHaveAttribute("hidden");
    expect(listPanel).toHaveAttribute("hidden");
  });

  it("automatically activates tabs with arrows, Home, and End", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const list = screen.getByRole("tab", { name: "List" });
    const detail = screen.getByRole("tab", { name: "Detail" });

    await user.click(list);
    await user.keyboard("{ArrowRight}");
    expect(detail).toHaveFocus();
    expect(detail).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");
    expect(detail).toHaveFocus();
    expect(detail).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(detail).toHaveFocus();
    expect(detail).toHaveAttribute("aria-selected", "true");
  });

  it("roves focus without activation in manual mode until Enter or Space", async () => {
    const user = userEvent.setup();
    render(<ManualHarness />);

    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });

    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(second).toHaveAttribute("aria-selected", "false");
    expect(second).toHaveAttribute("tabindex", "0");

    await user.click(first);
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{ArrowRight}");
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(second).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(first).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");

    await user.keyboard(" ");
    expect(first).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
  });
});
