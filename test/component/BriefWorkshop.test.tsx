// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BriefWorkshop } from "../../client/src/components/dashboard/BriefWorkshop";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const DRAFT = {
  id: 7,
  kind: "daily_skim",
  status: "draft",
  itemCount: 2,
  generatedAt: new Date().toISOString(),
  subject: "AI brief: OpenAI ships GPT-6",
  content: [
    "## CORE — Models",
    "[1] OpenAI shipped GPT-6 **Why it matters:** it resets the price-performance frontier.",
    "## PERIPHERY — you didn't ask, but you'd want to know",
    "[2] A new inference chip **Why it matters:** could change your hosting math.",
    "## SOURCES",
    "[1] OpenAI ships GPT-6 — https://openai.test/gpt6",
    "[2] New inference chip — https://chips.test/x",
    "## ABOUT",
    "How this brief is made: every item is human-reviewed.",
  ].join("\n"),
};

function renderWorkshop(draft: unknown = DRAFT) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) =>
          queryKey[0] === "/api/brief/draft" ? draft : null,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BriefWorkshop />
    </QueryClientProvider>,
  );
}

describe("<BriefWorkshop />", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the workshop and shows the draft subject and tier sections", async () => {
    const user = userEvent.setup();
    renderWorkshop();
    await user.click(screen.getByLabelText(/open brief workshop/i));

    expect(await screen.findByDisplayValue("AI brief: OpenAI ships GPT-6")).toBeInTheDocument();
    expect(screen.getByText("CORE — Models")).toBeInTheDocument();
    expect(
      screen.getByText("PERIPHERY — you didn't ask, but you'd want to know"),
    ).toBeInTheDocument();
    // The bolded so-what renders as emphasis, not literal asterisks.
    expect(screen.getAllByText("Why it matters:").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\*\*Why it matters/)).not.toBeInTheDocument();
  });

  it("renders the SOURCES legend as a clickable preflight link (new tab)", async () => {
    const user = userEvent.setup();
    renderWorkshop();
    await user.click(screen.getByLabelText(/open brief workshop/i));

    const link = await screen.findByRole("link", { name: /OpenAI ships GPT-6/i });
    expect(link).toHaveAttribute("href", "https://openai.test/gpt6");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("toggles to a raw editor showing the brief body", async () => {
    const user = userEvent.setup();
    renderWorkshop();
    await user.click(screen.getByLabelText(/open brief workshop/i));
    await screen.findByDisplayValue("AI brief: OpenAI ships GPT-6");

    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByDisplayValue(/## CORE — Models/)).toBeInTheDocument();
  });

  it("requires a two-step confirm before sending", async () => {
    const user = userEvent.setup();
    renderWorkshop();
    await user.click(screen.getByLabelText(/open brief workshop/i));
    await screen.findByDisplayValue("AI brief: OpenAI ships GPT-6");

    const send = screen.getByRole("button", { name: /approve & send/i });
    await user.click(send);
    // First click arms the confirm; it does not send.
    expect(screen.getByRole("button", { name: /confirm send/i })).toBeInTheDocument();
  });

  it("shows an empty state when no draft is pending", async () => {
    const user = userEvent.setup();
    renderWorkshop(null);
    await user.click(screen.getByLabelText(/open brief workshop/i));
    expect(await screen.findByText(/no draft pending/i)).toBeInTheDocument();
  });
});
