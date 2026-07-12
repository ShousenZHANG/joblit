import { useRef, useState, type KeyboardEvent } from "react";

type ActivationMode = "automatic" | "manual";

export function useAccessibleTabs<T extends string>({
  id,
  value,
  values,
  onValueChange,
  activationMode = "automatic",
}: {
  id: string;
  value: T;
  values: readonly T[];
  onValueChange: (value: T) => void;
  activationMode?: ActivationMode;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const [tabStop, setTabStop] = useState<T>(value);

  const move = (next: T) => {
    setTabStop(next);
    refs.current.get(next)?.focus();
    if (activationMode === "automatic") onValueChange(next);
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: T,
  ) => {
    if (
      activationMode === "manual" &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      setTabStop(current);
      onValueChange(current);
      return;
    }

    const index = values.indexOf(current);
    let next: T | undefined;

    if (event.key === "ArrowRight") {
      next = values[(index + 1) % values.length];
    }
    if (event.key === "ArrowLeft") {
      next = values[(index - 1 + values.length) % values.length];
    }
    if (event.key === "Home") next = values[0];
    if (event.key === "End") next = values[values.length - 1];
    if (!next) return;

    event.preventDefault();
    move(next);
  };

  return {
    tabListProps: { id: `${id}-tablist`, role: "tablist" as const },
    getTabProps: (tab: T) => ({
      id: `${id}-tab-${tab}`,
      role: "tab" as const,
      "data-value": tab,
      "aria-selected": value === tab,
      "aria-controls": `${id}-panel-${tab}`,
      tabIndex:
        (activationMode === "manual" ? tabStop : value) === tab ? 0 : -1,
      ref: (node: HTMLButtonElement | null) => {
        if (node) refs.current.set(tab, node);
        else refs.current.delete(tab);
      },
      onClick: () => {
        setTabStop(tab);
        onValueChange(tab);
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) =>
        onKeyDown(event, tab),
    }),
    getPanelProps: (tab: T) => ({
      id: `${id}-panel-${tab}`,
      role: "tabpanel" as const,
      "aria-labelledby": `${id}-tab-${tab}`,
      hidden: value !== tab,
      tabIndex: 0,
    }),
  };
}
