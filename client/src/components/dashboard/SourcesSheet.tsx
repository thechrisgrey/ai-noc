import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES } from "./constants";
import { getSourceMeta } from "./utils";

interface ManagedSource {
  id: number;
  slug: string;
  label: string;
  url: string;
  defaultCategory: string;
  enabled: boolean;
  createdAt: string;
  itemCount: number;
  health: {
    lastSuccess: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    consecutiveFailures: number;
    totalFetches: number;
    totalSuccesses: number;
  } | null;
}

const SOURCE_CATEGORIES = CATEGORIES.filter((c) => c.value !== "all");

const INPUT_CLASS =
  "w-full text-[11px] px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.04] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 data-readout";

function extractApiError(err: unknown): string {
  if (!(err instanceof Error)) return "Request failed";
  const match = err.message.match(/^\d{3}: ([\s\S]*)$/);
  const body = match ? match[1] : err.message;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    // Body was not JSON — fall through to the raw text.
  }
  return body;
}

function SourcesPanel() {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ feedTitle: string; itemCount: number } | null>(null);
  const [armedId, setArmedId] = useState<number | null>(null);

  const { data: sources = [], isLoading } = useQuery<ManagedSource[]>({
    queryKey: ["/api/sources"],
  });

  const addMutation = useMutation({
    mutationFn: async (body: { url: string; label: string; defaultCategory: string }) => {
      const res = await apiRequest("POST", "/api/sources", body);
      return res.json() as Promise<ManagedSource & { feedTitle: string; itemCount: number }>;
    },
    onSuccess: (created) => {
      setAdded({ feedTitle: created.feedTitle, itemCount: created.itemCount });
      setFormError(null);
      setUrl("");
      setLabel("");
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
    },
    onError: (err) => {
      setAdded(null);
      setFormError(extractApiError(err));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/sources/${id}`, { enabled });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sources/${id}`);
    },
    onSettled: () => {
      setArmedId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
    },
  });

  const canSubmit =
    url.trim() !== "" && label.trim() !== "" && category !== "" && !addMutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setAdded(null);
    setFormError(null);
    addMutation.mutate({ url: url.trim(), label: label.trim(), defaultCategory: category });
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">
      {/* Add form */}
      <div className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground data-readout">
          ADD SOURCE
        </div>
        <input
          type="url"
          placeholder="https://example.com/feed.xml"
          aria-label="Feed URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={INPUT_CLASS}
        />
        <input
          type="text"
          placeholder="Source label"
          aria-label="Source label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          className={INPUT_CLASS}
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger
            aria-label="Default category"
            className="h-8 text-[10px] rounded-lg border-white/[0.08] bg-white/[0.04] data-readout uppercase tracking-[0.14em]"
          >
            <SelectValue placeholder="CATEGORY" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_CATEGORIES.map((cat) => (
              <SelectItem
                key={cat.value}
                value={cat.value}
                className="text-[10px] data-readout uppercase tracking-[0.14em]"
              >
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-1.5 text-[10px] px-2.5 py-2 rounded-lg bg-primary text-primary-foreground font-medium uppercase tracking-[0.14em] data-readout transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {addMutation.isPending && <Loader2 size={10} className="animate-spin" />}
          {addMutation.isPending ? "TESTING FEED" : "TEST & ADD"}
        </button>
        {formError && (
          <p role="alert" className="text-[10px] text-destructive break-words">
            {formError}
          </p>
        )}
        {added && (
          <div className="text-[10px] px-2.5 py-2 rounded-lg bg-primary/[0.08] border border-primary/20 text-primary data-readout">
            {added.feedTitle} — {added.itemCount} entries
          </div>
        )}
      </div>

      {/* Source list */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground data-readout">
          CONFIGURED SOURCES
        </div>
        {isLoading && (
          <p className="text-[10px] text-muted-foreground/60 data-readout">LOADING...</p>
        )}
        {!isLoading && sources.length === 0 && (
          <p className="text-[10px] text-muted-foreground/60 data-readout">NO SOURCES CONFIGURED</p>
        )}
        {sources.map((s) => {
          const info = getSourceMeta(s.slug);
          const SrcIcon = info.icon;
          const failing = (s.health?.consecutiveFailures ?? 0) > 0;
          return (
            <div
              key={s.id}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02]"
            >
              <SrcIcon size={12} className="flex-shrink-0" style={{ color: info.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    title={failing ? s.health?.lastError ?? "Failing" : undefined}
                    className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                      failing
                        ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]"
                        : "bg-primary shadow-[0_0_6px_hsla(68,96%,58%,0.5)]"
                    }`}
                  />
                  <span className="text-[11px] text-foreground truncate">{s.label}</span>
                </div>
                <p className="text-[9px] text-muted-foreground/60 truncate data-readout">{s.url}</p>
              </div>
              <span className="data-readout text-[10px] tabular-nums text-muted-foreground flex-shrink-0">
                {s.itemCount}
              </span>
              <Switch
                checked={s.enabled}
                onCheckedChange={(enabled) => toggleMutation.mutate({ id: s.id, enabled })}
                aria-label={`Toggle source ${s.label}`}
                className="scale-75 flex-shrink-0"
              />
              {armedId === s.id ? (
                <button
                  onClick={() => deleteMutation.mutate(s.id)}
                  aria-label={`Confirm delete source ${s.label}`}
                  className="flex-shrink-0 text-[9px] px-1.5 py-1 rounded border border-destructive/40 bg-destructive/10 text-destructive data-readout uppercase tracking-[0.14em] hover:bg-destructive/20 transition-colors"
                >
                  CONFIRM
                </button>
              ) : (
                <button
                  onClick={() => setArmedId(s.id)}
                  aria-label={`Delete source ${s.label}`}
                  className="flex-shrink-0 text-muted-foreground/60 hover:text-destructive transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SourcesSheet() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Manage sources"
          className="text-[9px] px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:text-foreground hover:bg-white/[0.07] data-readout uppercase tracking-[0.14em] transition-colors"
        >
          MANAGE
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-card border-white/[0.08] p-0 flex flex-col gap-0"
      >
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <SheetTitle className="text-xs uppercase tracking-[0.14em] font-medium data-readout">
            SOURCE MANAGEMENT
          </SheetTitle>
          <SheetDescription className="text-[10px] text-muted-foreground">
            Add, toggle, or remove RSS signal sources.
          </SheetDescription>
        </SheetHeader>
        {/* Query hooks live below SheetContent so they only mount when open. */}
        <SourcesPanel />
      </SheetContent>
    </Sheet>
  );
}
