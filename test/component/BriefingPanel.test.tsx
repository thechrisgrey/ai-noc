// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BriefingPanel } from "../../client/src/components/dashboard/BriefingPanel";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["/api/briefing"], {
    content: "Top signals indicate increased model release activity.",
    generatedAt: new Date().toISOString(),
    itemCount: 5,
  });
  return render(
    <QueryClientProvider client={client}>
      <BriefingPanel />
    </QueryClientProvider>,
  );
}

describe("<BriefingPanel />", () => {
  // Node's experimental localStorage global lacks Storage methods in vitest
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes REGENERATE as a real, focusable button", () => {
    renderPanel();
    const button = screen.getByRole("button", { name: "REGENERATE" });
    expect(button).toBeEnabled();
    button.focus();
    expect(button).toHaveFocus();
  });

  it("disables REGENERATE while regeneration is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "REGENERATE" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /GENERATING/i })).toBeDisabled();
    });
  });

  it("exposes aria-expanded on the collapse button", async () => {
    const user = userEvent.setup();
    renderPanel();
    const collapse = screen.getByRole("button", { name: /INTELLIGENCE BRIEFING/i });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    await user.click(collapse);
    expect(collapse).toHaveAttribute("aria-expanded", "false");
  });
});
