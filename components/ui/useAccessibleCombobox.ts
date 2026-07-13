import { useState, type KeyboardEvent, type MouseEvent } from "react";

export function useAccessibleCombobox<T>({
  id,
  open,
  setOpen,
  items,
  onSelect,
}: {
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  items: readonly T[];
  onSelect: (item: T) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);

  if (activeIndex >= items.length) setActiveIndex(-1);

  const optionId = (index: number) => `${id}-option-${index}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);

      if (items.length === 0) {
        setActiveIndex(-1);
        return;
      }

      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        const start = index < 0 ? (delta > 0 ? -1 : 0) : index;
        return (start + delta + items.length) % items.length;
      });
      return;
    }

    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      onSelect(items[activeIndex]!);
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return {
    activeIndex,
    setActiveIndex,
    inputProps: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": `${id}-listbox`,
      "aria-activedescendant":
        open && activeIndex >= 0 ? optionId(activeIndex) : undefined,
      onKeyDown,
    },
    listboxProps: {
      id: `${id}-listbox`,
      role: "listbox" as const,
    },
    getOptionProps: (item: T, index: number) => ({
      id: optionId(index),
      role: "option" as const,
      "aria-selected": activeIndex === index,
      onMouseEnter: () => setActiveIndex(index),
      onMouseDown: (event: MouseEvent) => event.preventDefault(),
      onClick: () => onSelect(item),
    }),
  };
}
