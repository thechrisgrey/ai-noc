import { useEffect } from "react";

interface KeyboardNavItem {
  id: number;
}

interface UseKeyboardNavOptions<T extends KeyboardNavItem> {
  items: T[];
  selectedId: number | null;
  onSelect: (item: T) => void;
  onOpen: (item: T) => void;
  onBookmark: (item: T) => void;
  onClear: () => void;
  enabled?: boolean;
}

function isInertTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

/**
 * List keyboard navigation: j/k move selection (clamped; from no selection
 * either key selects the first item), o/Enter opens, b bookmarks, Escape
 * clears. Inert while typing in form fields or while a dialog is open.
 */
export function useKeyboardNav<T extends KeyboardNavItem>({
  items,
  selectedId,
  onSelect,
  onOpen,
  onBookmark,
  onClear,
  enabled = true,
}: UseKeyboardNavOptions<T>) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isInertTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;

      const idx = items.findIndex((i) => i.id === selectedId);
      const selected = idx >= 0 ? items[idx] : undefined;

      switch (e.key) {
        case "j": {
          if (items.length === 0) return;
          e.preventDefault();
          onSelect(items[idx < 0 ? 0 : Math.min(idx + 1, items.length - 1)]);
          break;
        }
        case "k": {
          if (items.length === 0) return;
          e.preventDefault();
          onSelect(items[idx < 0 ? 0 : Math.max(idx - 1, 0)]);
          break;
        }
        case "o":
        case "Enter": {
          if (!selected) return;
          e.preventDefault();
          onOpen(selected);
          break;
        }
        case "b": {
          if (!selected) return;
          e.preventDefault();
          onBookmark(selected);
          break;
        }
        case "Escape": {
          onClear();
          break;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, selectedId, onSelect, onOpen, onBookmark, onClear, enabled]);
}
