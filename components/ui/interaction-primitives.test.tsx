import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Input } from "./input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

afterEach(cleanup);

describe("interaction primitives", () => {
  it("provides explicit 44px touch button variants", () => {
    render(
      <>
        <Button size="touch">Continue</Button>
        <Button size="icon-touch" aria-label="Menu">
          M
        </Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Continue" })).toHaveClass(
      "h-11",
    );
    expect(screen.getByRole("button", { name: "Menu" })).toHaveClass(
      "size-11",
    );
  });

  it("keeps icon-sm compact on fine pointers and exposes the coarse-pointer hook", () => {
    render(
      <Button size="icon-sm" aria-label="Compact menu">
        M
      </Button>,
    );

    const compactButton = screen.getByRole("button", { name: "Compact menu" });
    expect(compactButton).toHaveClass("size-8");
    expect(compactButton).toHaveAttribute("data-slot", "button");
  });

  it("renders every data-slot hook used by the coarse-pointer contract", () => {
    render(
      <>
        <Button size="icon-sm" aria-label="Slot button">
          B
        </Button>
        <Input aria-label="Slot input" />
        <Select open defaultValue="ready">
          <SelectTrigger aria-label="Slot select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ready">Ready</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );

    const button = screen.getByLabelText("Slot button");
    const input = screen.getByLabelText("Slot input");
    const selectTrigger = screen.getByLabelText("Slot select");
    const selectItem = screen.getByRole("option", { name: "Ready" });

    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle className="sr-only">Slot dialog</DialogTitle>
          Body
        </DialogContent>
      </Dialog>,
    );
    const dialogClose = screen.getByRole("button", { name: /close/i });

    expect([
      button.getAttribute("data-slot"),
      input.getAttribute("data-slot"),
      selectTrigger.getAttribute("data-slot"),
      selectItem.getAttribute("data-slot"),
      dialogClose.getAttribute("data-slot"),
    ]).toEqual([
      "button",
      "input",
      "select-trigger",
      "select-item",
      "dialog-close",
    ]);
  });

  it("renders the default dialog close with a 44px target", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle className="sr-only">Touch target dialog</DialogTitle>
          Body
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: /close/i })).toHaveClass(
      "size-11",
    );
  });
});
