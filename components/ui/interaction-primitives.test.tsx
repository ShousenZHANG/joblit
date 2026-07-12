import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

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
