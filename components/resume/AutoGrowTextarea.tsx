"use client";

import { useCallback, useLayoutEffect, useRef, type ComponentProps } from "react";
import { Textarea } from "@/components/ui/textarea";

/**
 * A textarea that is always exactly as tall as its content.
 *
 * Resume bullets run to a couple of hundred characters, and a fixed one-row
 * box turns writing one into peering through a letterbox: the beginning
 * scrolls out of sight exactly when you want to re-read it. Growing the field
 * costs a little vertical space and removes the need to scroll inside a
 * control that is itself inside a scrolling column.
 *
 * The height is set in a layout effect keyed on the value, so it stays correct
 * when the text changes from somewhere other than typing — the Bold button
 * rewriting the value, a draft loading, an undo.
 */
export function AutoGrowTextarea({
  value,
  ref,
  className,
  ...props
}: ComponentProps<typeof Textarea> & {
  ref?: (element: HTMLTextAreaElement | null) => void;
}) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  // Compose the caller's ref (the markdown registry needs the node too) with
  // the one this component measures.
  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      ref?.(node);
    },
    [ref],
  );

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    // Collapse first: scrollHeight only shrinks back if the box is smaller
    // than its content, so measuring without this makes the field one-way.
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  return (
    <Textarea
      {...props}
      ref={setRef}
      value={value}
      rows={1}
      className={className}
    />
  );
}
