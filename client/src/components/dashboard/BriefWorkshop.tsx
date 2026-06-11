import { useState, useEffect, Fragment, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  FileText,
  Send,
  Pencil,
  Eye,
  Check,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { timeAgo } from "./utils";

interface DraftBrief {
  id: number;
  content: string;
  itemCount: number;
  generatedAt: string;
  kind: string;
  status: string;
  subject: string | null;
}

/** Render a line's text, promoting **bolded** spans (the so-what) to <strong>. */
function renderBold(text: string): ReactNode {
  const segments = text.split(/\*\*([^*]+)\*\*/g);
  return segments.map((seg, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-foreground">
        {seg}
      </strong>
    ) : (
      <Fragment key={i}>{seg}</Fragment>
    ),
  );
}

const LEGEND_RE = /^(\[\d+\])\s+(.*?)\s+—\s+(\S+)$/;

/**
 * Render the brief's plain-text body. CORE/PERIPHERY headers are accented; the
 * SOURCES section becomes clickable links so the owner can verify each resolves
 * before approving (the source preflight). ABOUT is muted methodology text.
 */
function BriefBody({ content }: { content: string }) {
  let inSources = false;
  return (
    <div className="space-y-1.5">
      {content.split("\n").map((raw, idx) => {
        const line = raw.trim();
        if (line === "") return null;

        if (line.startsWith("## ")) {
          const label = line.slice(3);
          inSources = label.toUpperCase().startsWith("SOURCES");
          const isCore = label.toUpperCase().startsWith("CORE");
          const isPeriphery = label.toUpperCase().startsWith("PERIPHERY");
          return (
            <div
              key={idx}
              className={`text-[10px] uppercase tracking-[0.14em] font-medium data-readout pt-3 ${
                isCore
                  ? "text-primary/90"
                  : isPeriphery
                    ? "text-amber-400/80"
                    : "text-muted-foreground/70"
              }`}
            >
              {label}
            </div>
          );
        }

        if (inSources) {
          const m = line.match(LEGEND_RE);
          if (m) {
            const [, marker, title, url] = m;
            const safe = /^https?:\/\//i.test(url) ? url : null;
            return (
              <div key={idx} className="text-[11px] leading-relaxed flex gap-1.5">
                <span className="text-muted-foreground/50 tabular-nums shrink-0">{marker}</span>
                {safe ? (
                  <a
                    href={safe}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary/80 hover:text-primary inline-flex items-start gap-1 underline-offset-2 hover:underline break-all"
                  >
                    {title}
                    <ExternalLink size={9} className="mt-0.5 shrink-0 opacity-60" />
                  </a>
                ) : (
                  <span className="text-muted-foreground/60">{title} (no link)</span>
                )}
              </div>
            );
          }
        }

        return (
          <p key={idx} className="text-[12px] text-foreground/80 leading-relaxed">
            {renderBold(line)}
          </p>
        );
      })}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  daily_skim: "DAILY SKIM",
  weekly_heavy: "WEEKLY BRIEF",
};

function WorkshopBody() {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);

  const { data: draft, isLoading } = useQuery<DraftBrief | null>({
    queryKey: ["/api/brief/draft"],
  });

  // Re-seed local edits when a different draft loads.
  useEffect(() => {
    setSubject(draft?.subject ?? "");
    setBody(draft?.content ?? "");
    setEditing(false);
    setConfirming(false);
  }, [draft?.id]);

  const dirty = !!draft && (subject !== (draft.subject ?? "") || body !== draft.content);

  const generateMutation = useMutation({
    mutationFn: async (kind: "daily_skim" | "weekly_heavy") => {
      const res = await apiRequest("POST", "/api/brief/generate", { kind });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brief/draft"] });
      toast({ title: "DRAFT GENERATED", description: "A fresh draft is ready for review." });
    },
    onError: () =>
      toast({
        title: "NOT ENOUGH SIGNAL",
        description: "Nothing cleared the bar for a draft right now.",
        variant: "destructive",
      }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/brief/${draft!.id}`, { subject, content: body });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/brief/draft"] }),
    onError: () =>
      toast({ title: "SAVE FAILED", description: "Could not save your edits.", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await apiRequest("PATCH", `/api/brief/${draft!.id}`, { subject, content: body });
      }
      const res = await apiRequest("POST", `/api/brief/${draft!.id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brief/draft"] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefings"] });
      toast({ title: "BRIEF SENT", description: "Delivered and archived." });
      setConfirming(false);
    },
    onError: () => {
      setConfirming(false);
      toast({
        title: "SEND FAILED",
        description: "Delivery did not go through. The draft is untouched.",
        variant: "destructive",
      });
    },
  });

  const busy = generateMutation.isPending || approveMutation.isPending || saveMutation.isPending;

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-5 pt-4 space-y-4">
      {/* Generate controls */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] data-readout uppercase tracking-[0.14em] text-muted-foreground/60 mr-1">
          Draft
        </span>
        {(["daily_skim", "weekly_heavy"] as const).map((k) => (
          <button
            key={k}
            onClick={() => generateMutation.mutate(k)}
            disabled={busy}
            className="flex items-center gap-1 text-[9px] px-2 py-1 rounded-lg data-readout uppercase tracking-[0.14em] border border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:text-foreground hover:bg-white/[0.07] transition-colors disabled:opacity-50"
          >
            <Sparkles size={9} />
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {isLoading && (
        <p className="text-[10px] text-muted-foreground/60 data-readout">LOADING DRAFT...</p>
      )}

      {!isLoading && !draft && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 text-center">
          <FileText size={18} className="mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-[11px] text-muted-foreground/70 data-readout uppercase tracking-[0.14em]">
            No draft pending
          </p>
          <p className="text-[11px] text-muted-foreground/50 mt-1.5 leading-relaxed">
            The daily skim drafts automatically. Generate one now to review and send.
          </p>
        </div>
      )}

      {!isLoading && draft && (
        <>
          <div className="flex items-center gap-2 text-[9px] data-readout text-muted-foreground/70">
            <span className="px-1.5 py-0.5 rounded uppercase tracking-[0.14em] bg-primary/[0.12] text-primary">
              {KIND_LABEL[draft.kind] ?? draft.kind}
            </span>
            <span className="px-1.5 py-0.5 rounded uppercase tracking-[0.14em] bg-amber-400/[0.12] text-amber-400/90">
              {draft.status}
            </span>
            <span className="tabular-nums">{timeAgo(draft.generatedAt)}</span>
            <span className="ml-auto tabular-nums">{draft.itemCount} SIGNALS</span>
          </div>

          {/* Subject / headline */}
          <div className="space-y-1">
            <label className="text-[9px] data-readout uppercase tracking-[0.14em] text-muted-foreground/60">
              Subject / headline
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary/30"
            />
          </div>

          {/* Body: rendered view with an edit toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[9px] data-readout uppercase tracking-[0.14em] text-muted-foreground/60">
                Brief
              </label>
              <button
                onClick={() => setEditing((e) => !e)}
                className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded data-readout uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors"
              >
                {editing ? <Eye size={9} /> : <Pencil size={9} />}
                {editing ? "Preview" : "Edit"}
              </button>
            </div>
            {editing ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck
                className="w-full h-72 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-foreground/85 font-mono leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary/30"
              />
            ) : (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <BriefBody content={body} />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || busy}
              className="text-[10px] data-readout uppercase tracking-[0.14em] px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] text-foreground/80 hover:bg-white/[0.07] hover:text-foreground transition-colors disabled:opacity-40"
            >
              {saveMutation.isPending ? "Saving..." : dirty ? "Save edits" : "Saved"}
            </button>
            <button
              onClick={() => {
                if (confirming) approveMutation.mutate();
                else {
                  setConfirming(true);
                  setTimeout(() => setConfirming(false), 4000);
                }
              }}
              disabled={busy}
              className={`ml-auto flex items-center gap-1.5 text-[10px] data-readout uppercase tracking-[0.14em] px-3.5 py-1.5 rounded-lg font-medium transition-all disabled:opacity-60 ${
                confirming
                  ? "bg-amber-400 text-black shadow-[0_0_16px_rgba(251,191,36,0.3)]"
                  : "bg-primary text-primary-foreground shadow-[0_0_16px_hsla(68,96%,58%,0.25)] hover:brightness-110"
              }`}
            >
              {approveMutation.isPending ? (
                "Sending..."
              ) : confirming ? (
                <>
                  <Check size={11} />
                  Confirm send
                </>
              ) : (
                <>
                  <Send size={11} />
                  Approve &amp; send
                </>
              )}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/45 leading-relaxed">
            Nothing sends until you approve. Verify each source link above resolves before shipping.
          </p>
        </>
      )}
    </div>
  );
}

export function BriefWorkshop() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Open brief workshop"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground transition-colors data-readout"
        >
          <FileText size={12} />
          <span className="hidden sm:inline">BRIEF</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl bg-card border-white/[0.08] p-0 flex flex-col gap-0"
      >
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <SheetTitle className="text-xs uppercase tracking-[0.14em] font-medium data-readout">
            Brief Workshop
          </SheetTitle>
          <SheetDescription className="text-[10px] text-muted-foreground">
            Review, edit into your voice, and approve before it sends.
          </SheetDescription>
        </SheetHeader>
        {open && <WorkshopBody />}
      </SheetContent>
    </Sheet>
  );
}
