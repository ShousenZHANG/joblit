"use client";

import type { ReactNode, HTMLAttributes } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableItem } from "./SortableItem";

interface ReorderableListProps<T> {
  items: T[];
  /** Stable identity for a row — MUST follow the entry, not its position.
      Position-based ids made dnd-kit's drop FLIP animate the wrong element
      (cards teleported on release) and pinned focus/expanded state to slots
      instead of entries. Rows carry a client-only rowId for this. */
  getId: (item: T, index: number) => string;
  onMove: (from: number, to: number) => void;
  renderItem: (
    item: T,
    index: number,
    dragHandleProps: HTMLAttributes<HTMLButtonElement>,
    isDragging: boolean,
  ) => ReactNode;
}

export function ReorderableList<T>({
  items,
  getId,
  onMove,
  renderItem,
}: ReorderableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortableIds = items.map((item, i) => getId(item, i));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = sortableIds.indexOf(String(active.id));
    const to = sortableIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onMove(from, to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-3">
          {items.map((item, index) => (
            <SortableItem key={sortableIds[index]} id={sortableIds[index]}>
              {({ dragHandleProps, isDragging }) =>
                renderItem(item, index, dragHandleProps, isDragging)
              }
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
