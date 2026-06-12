// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Not under test; isolate Header from Radix Sheet internals.
vi.mock("../../client/src/components/dashboard/BriefWorkshop", () => ({
  BriefWorkshop: () => null,
}));

import { Header } from "../../client/src/components/dashboard/Header";

function renderHeader(overrides: { onSelectSection?: (s: string) => void; selectedSection?: "all" | "ai" | "csp" | "quantum" } = {}) {
  return render(
    <Header
      stats={undefined}
      showBookmarks={false}
      setShowBookmarks={() => {}}
      notificationsEnabled={false}
      setNotificationsEnabled={() => {}}
      refreshMutation={{ isPending: false, mutate: vi.fn() } as any}
      bookmarksCount={0}
      selectedSection={overrides.selectedSection ?? "all"}
      onSelectSection={overrides.onSelectSection ?? (() => {})}
    />,
  );
}

describe("<Header /> section switcher", () => {
  it("renders all four section options with the active one pressed", () => {
    renderHeader({ selectedSection: "csp" });
    const nav = screen.getByRole("navigation", { name: "Section filter" });
    expect(nav).toBeInTheDocument();
    for (const label of ["ALL", "AI", "CSP", "QUANTUM"]) {
      expect(screen.getByRole("button", { name: `Show ${label} section` })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Show CSP section" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show AI section" })).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onSelectSection with the chosen value", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onSelectSection: spy });
    await user.click(screen.getByRole("button", { name: "Show QUANTUM section" }));
    expect(spy).toHaveBeenCalledWith("quantum");
  });
});
