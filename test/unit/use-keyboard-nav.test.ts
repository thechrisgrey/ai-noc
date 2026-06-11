// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardNav } from "../../client/src/hooks/use-keyboard-nav";

const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

function buildHandlers() {
  return {
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onBookmark: vi.fn(),
    onClear: vi.fn(),
  };
}

function press(key: string, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useKeyboardNav", () => {
  it("j with no selection selects the first item", () => {
    const handlers = buildHandlers();
    renderHook(() => useKeyboardNav({ items, selectedId: null, ...handlers }));
    press("j");
    expect(handlers.onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("j moves selection down and clamps at the last item", () => {
    const handlers = buildHandlers();
    const { rerender } = renderHook(
      ({ selectedId }) => useKeyboardNav({ items, selectedId, ...handlers }),
      { initialProps: { selectedId: 1 as number | null } },
    );
    press("j");
    expect(handlers.onSelect).toHaveBeenLastCalledWith(items[1]);

    rerender({ selectedId: 3 });
    press("j");
    expect(handlers.onSelect).toHaveBeenLastCalledWith(items[2]);
  });

  it("k with no selection selects the first item", () => {
    const handlers = buildHandlers();
    renderHook(() => useKeyboardNav({ items, selectedId: null, ...handlers }));
    press("k");
    expect(handlers.onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("k moves selection up and clamps at the first item", () => {
    const handlers = buildHandlers();
    const { rerender } = renderHook(
      ({ selectedId }) => useKeyboardNav({ items, selectedId, ...handlers }),
      { initialProps: { selectedId: 2 as number | null } },
    );
    press("k");
    expect(handlers.onSelect).toHaveBeenLastCalledWith(items[0]);

    rerender({ selectedId: 1 });
    press("k");
    expect(handlers.onSelect).toHaveBeenLastCalledWith(items[0]);
  });

  it("o and Enter open the selected item", () => {
    const handlers = buildHandlers();
    renderHook(() => useKeyboardNav({ items, selectedId: 2, ...handlers }));
    press("o");
    expect(handlers.onOpen).toHaveBeenCalledWith(items[1]);
    press("Enter");
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
  });

  it("o does nothing when nothing is selected", () => {
    const handlers = buildHandlers();
    renderHook(() => useKeyboardNav({ items, selectedId: null, ...handlers }));
    press("o");
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("b bookmarks the selected item", () => {
    const handlers = buildHandlers();
    renderHook(() => useKeyboardNav({ items, selectedId: 3, ...handlers }));
    press("b");
    expect(handlers.onBookmark).toHaveBeenCalledWith(items[2]);
  });

  it("Escape clears the selection", () => {
    const handlers = buildHandlers();
    renderHook(() => useKeyboardNav({ items, selectedId: 1, ...handlers }));
    press("Escape");
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
  });

  it("is inert when typing in an input", () => {
    const handlers = buildHandlers();
    renderHook(() => useKeyboardNav({ items, selectedId: null, ...handlers }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("j", input);
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("is inert while a dialog is open", () => {
    const handlers = buildHandlers();
    renderHook(() => useKeyboardNav({ items, selectedId: null, ...handlers }));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    press("j");
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("is inert when disabled", () => {
    const handlers = buildHandlers();
    renderHook(() =>
      useKeyboardNav({ items, selectedId: null, enabled: false, ...handlers }),
    );
    press("j");
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });
});
