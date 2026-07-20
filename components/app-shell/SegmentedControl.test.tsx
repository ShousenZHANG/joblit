import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./SegmentedControl";

const OPTIONS = [
  { value: "NEW", label: "New" },
  { value: "APPLIED", label: "Applied" },
  { value: "REJECTED", label: "Rejected" },
] as const;

function renderControl(
  value: (typeof OPTIONS)[number]["value"] = "NEW",
  onChange = vi.fn(),
) {
  render(
    <SegmentedControl
      options={OPTIONS}
      value={value}
      onChange={onChange}
      ariaLabel="Status"
    />,
  );
  return onChange;
}

afterEach(cleanup);

describe("SegmentedControl", () => {
  it("exposes an exclusive choice rather than independent toggles", () => {
    renderControl();

    const group = screen.getByRole("radiogroup", { name: "Status" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks only the selected option as checked", () => {
    renderControl("APPLIED");

    expect(screen.getByRole("radio", { name: "New" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Applied" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Rejected" })).toHaveAttribute("aria-checked", "false");
  });

  it("keeps the whole control to a single tab stop", () => {
    renderControl("APPLIED");

    expect(screen.getByRole("radio", { name: "Applied" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "New" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "Rejected" })).toHaveAttribute("tabindex", "-1");
  });

  it("reports the clicked option", async () => {
    const user = userEvent.setup();
    const onChange = renderControl("NEW");

    await user.click(screen.getByRole("radio", { name: "Rejected" }));

    expect(onChange).toHaveBeenCalledWith("REJECTED");
  });

  it("moves selection with the arrow keys", async () => {
    const user = userEvent.setup();
    const onChange = renderControl("NEW");

    screen.getByRole("radio", { name: "New" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("APPLIED");
  });

  it("wraps around both edges", async () => {
    const user = userEvent.setup();

    const forward = renderControl("REJECTED");
    screen.getByRole("radio", { name: "Rejected" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(forward).toHaveBeenCalledWith("NEW");

    cleanup();

    const backward = renderControl("NEW");
    screen.getByRole("radio", { name: "New" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(backward).toHaveBeenCalledWith("REJECTED");
  });

  it("jumps to the ends with Home and End", async () => {
    const user = userEvent.setup();
    const onChange = renderControl("APPLIED");

    screen.getByRole("radio", { name: "Applied" }).focus();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenCalledWith("REJECTED");

    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenCalledWith("NEW");
  });

  it("renders counts when supplied", () => {
    render(
      <SegmentedControl
        options={[
          { value: "NEW", label: "New", count: 12 },
          { value: "APPLIED", label: "Applied", count: 0 },
        ]}
        value="NEW"
        onChange={vi.fn()}
        ariaLabel="Status"
      />,
    );

    expect(screen.getByRole("radio", { name: /New/ })).toHaveTextContent("12");
    expect(screen.getByRole("radio", { name: /Applied/ })).toHaveTextContent("0");
  });
});
