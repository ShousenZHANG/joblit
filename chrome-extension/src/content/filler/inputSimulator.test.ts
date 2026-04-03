import { describe, it, expect, beforeEach, vi } from "vitest";
import { simulateInput, simulateSelect } from "./inputSimulator";

describe("simulateInput", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("sets value on text input", () => {
    document.body.innerHTML = `<input id="name" type="text" />`;
    const input = document.getElementById("name") as HTMLInputElement;
    simulateInput(input, "John Doe");
    expect(input.value).toBe("John Doe");
  });

  it("sets value on textarea", () => {
    document.body.innerHTML = `<textarea id="cover"></textarea>`;
    const textarea = document.getElementById("cover") as HTMLTextAreaElement;
    simulateInput(textarea, "I am excited to apply...");
    expect(textarea.value).toBe("I am excited to apply...");
  });

  it("sets textContent on contenteditable", () => {
    document.body.innerHTML = `<div id="editor" contenteditable="true"></div>`;
    const div = document.getElementById("editor")!;
    simulateInput(div, "Some content");
    expect(div.textContent).toBe("Some content");
  });

  it("dispatches focus, input, change, blur events", () => {
    document.body.innerHTML = `<input id="field" type="text" />`;
    const input = document.getElementById("field") as HTMLInputElement;
    const events: string[] = [];

    for (const event of ["focus", "input", "change", "blur"]) {
      input.addEventListener(event, () => events.push(event));
    }

    simulateInput(input, "test");
    expect(events).toEqual(["focus", "input", "change", "blur"]);
  });

  it("events bubble", () => {
    document.body.innerHTML = `<div id="wrapper"><input id="child" /></div>`;
    const wrapper = document.getElementById("wrapper")!;
    const input = document.getElementById("child") as HTMLInputElement;
    const bubbled: string[] = [];

    wrapper.addEventListener("input", () => bubbled.push("input"));
    wrapper.addEventListener("change", () => bubbled.push("change"));

    simulateInput(input, "val");
    expect(bubbled).toContain("input");
    expect(bubbled).toContain("change");
  });
});

describe("simulateSelect", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("selects option by value", () => {
    document.body.innerHTML = `
      <select id="country">
        <option value="US">United States</option>
        <option value="AU">Australia</option>
      </select>
    `;
    const select = document.getElementById("country") as HTMLSelectElement;
    const result = simulateSelect(select, "AU");
    expect(result).toBe(true);
    expect(select.value).toBe("AU");
  });

  it("selects option by text content", () => {
    document.body.innerHTML = `
      <select id="country">
        <option value="1">United States</option>
        <option value="2">Australia</option>
      </select>
    `;
    const select = document.getElementById("country") as HTMLSelectElement;
    const result = simulateSelect(select, "Australia");
    expect(result).toBe(true);
    expect(select.value).toBe("2");
  });

  it("returns false when option not found", () => {
    document.body.innerHTML = `
      <select id="country">
        <option value="US">United States</option>
      </select>
    `;
    const select = document.getElementById("country") as HTMLSelectElement;
    const result = simulateSelect(select, "Japan");
    expect(result).toBe(false);
  });

  it("dispatches change event", () => {
    document.body.innerHTML = `
      <select id="s">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    `;
    const select = document.getElementById("s") as HTMLSelectElement;
    const changed = vi.fn();
    select.addEventListener("change", changed);

    simulateSelect(select, "b");
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
