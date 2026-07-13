import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useAccessibleCombobox } from "./useAccessibleCombobox";

afterEach(cleanup);

function Harness({ initialItems = ["Sydney", "Melbourne"] }: {
  initialItems?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [items, setItems] = useState(initialItems);
  const box = useAccessibleCombobox({
    id: "location",
    open,
    setOpen,
    items,
    onSelect: (item) => {
      setValue(item);
      setOpen(false);
    },
  });

  return (
    <>
      <input
        aria-label="Location"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        {...box.inputProps}
      />
      {open ? (
        <ul {...box.listboxProps}>
          {items.map((item, index) => (
            <li key={item} {...box.getOptionProps(item, index)}>
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      <button onClick={() => setValue("External value")}>Set value externally</button>
      <button onClick={() => setItems(["Sydney"])}>Keep first item</button>
      <button onClick={() => setItems(["Brisbane", "Perth"])}>
        Replace items
      </button>
      <button onClick={() => box.setActiveIndex(0)}>Activate first externally</button>
      <button onClick={() => setOpen(false)}>Close externally</button>
      <button>After combobox</button>
    </>
  );
}

describe("useAccessibleCombobox", () => {
  it("links the input, listbox, and active option with combobox semantics", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("combobox", { name: "Location" });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-controls", "location-listbox");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    input.focus();
    await user.keyboard("{ArrowDown}");

    const listbox = screen.getByRole("listbox");
    const sydney = screen.getByRole("option", { name: "Sydney" });
    const melbourne = screen.getByRole("option", { name: "Melbourne" });
    expect(listbox).toHaveAttribute("id", "location-listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-0",
    );
    expect(sydney).toHaveAttribute("id", "location-option-0");
    expect(sydney).toHaveAttribute("aria-selected", "true");
    expect(melbourne).toHaveAttribute("id", "location-option-1");
    expect(melbourne).toHaveAttribute("aria-selected", "false");
  });

  it("cycles in both directions and selects the active item with Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("combobox", { name: "Location" });
    input.focus();

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-1",
    );

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-0",
    );

    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-1",
    );

    await user.keyboard("{Enter}");
    expect(input).toHaveValue("Melbourne");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("opens at the last option with ArrowUp and resets on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("combobox", { name: "Location" });
    input.focus();
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-1",
    );

    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(input).toHaveValue("");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-0",
    );
  });

  it("tracks pointer activity, preserves input focus on mouse down, and selects on click", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("combobox", { name: "Location" });
    input.focus();
    await user.keyboard("{ArrowDown}");
    const melbourne = screen.getByRole("option", { name: "Melbourne" });

    await user.hover(melbourne);
    expect(melbourne).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-1",
    );
    expect(fireEvent.mouseDown(melbourne)).toBe(false);
    expect(input).toHaveFocus();

    await user.click(melbourne);
    expect(input).toHaveValue("Melbourne");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("opens safely with no items and does not intercept Tab", async () => {
    const user = userEvent.setup();
    render(<Harness initialItems={[]} />);

    const input = screen.getByRole("combobox", { name: "Location" });
    input.focus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(input).toHaveValue("");
    expect(screen.getByRole("listbox")).toBeEmptyDOMElement();

    await user.tab();
    expect(screen.getByRole("button", { name: "Set value externally" })).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("stays synchronized with caller-owned value, items, open state, and active index", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("combobox", { name: "Location" });
    input.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-1",
    );

    await user.click(screen.getByRole("button", { name: "Set value externally" }));
    expect(input).toHaveValue("External value");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-1",
    );

    await user.click(screen.getByRole("button", { name: "Replace items" }));
    expect(screen.getByRole("option", { name: "Perth" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    input.focus();
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("Perth");
    expect(input).toHaveAttribute("aria-expanded", "false");

    input.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("button", { name: "Close externally" }));
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    await user.click(screen.getByRole("button", { name: "Keep first item" }));
    await user.click(
      screen.getByRole("button", { name: "Activate first externally" }),
    );
    expect(input).not.toHaveAttribute("aria-activedescendant");

    input.focus();
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-0",
    );
  });

  it("clears an active index that falls outside externally filtered items", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("combobox", { name: "Location" });
    input.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "location-option-1",
    );

    await user.click(screen.getByRole("button", { name: "Keep first item" }));
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(screen.getByRole("option", { name: "Sydney" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});
