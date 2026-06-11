import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { timeAgo } from "./utils";

export function BriefingPanel() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("ai-noc-briefing-collapsed") === "true",
  );
  const { toast } = useToast();

  const { data: briefing } = useQuery<{
    content: string | null;
    generatedAt: string | null;
    itemCount: number;
  }>({
    queryKey: ["/api/briefing"],
    refetchInterval: 5 * 60 * 1000,
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/briefing/regenerate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
    },
    onError: () => {
      toast({ title: "BRIEFING FAILED", description: "Could not regenerate briefing. Try again.", variant: "destructive" });
    },
  });

  useEffect(() => {
    localStorage.setItem("ai-noc-briefing-collapsed", String(collapsed));
  }, [collapsed]);

  if (!briefing?.content && !regenerateMutation.isPending) return null;

  return (
    <div className="flex-shrink-0 bg-primary/[0.04] border-b border-b-white/[0.06] border-l-2 border-l-primary/40">
      <div className="w-full flex items-center gap-2 pr-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex-1 flex items-center gap-2 pl-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Activity size={12} className="text-primary/90" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-primary/90 data-readout font-medium">
            INTELLIGENCE BRIEFING
          </span>
          {briefing?.generatedAt && (
            <span className="text-[9px] text-muted-foreground/60 data-readout">
              {timeAgo(briefing.generatedAt)}
            </span>
          )}
          <span className="ml-auto">
            {collapsed ? (
              <ChevronDown size={12} className="text-muted-foreground/60" />
            ) : (
              <ChevronUp size={12} className="text-muted-foreground/60" />
            )}
          </span>
        </button>
        <button
          onClick={() => regenerateMutation.mutate()}
          disabled={regenerateMutation.isPending}
          className={`flex-shrink-0 text-[9px] tracking-[0.14em] px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-foreground/80 hover:bg-white/[0.07] hover:text-foreground data-readout transition-colors cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
            regenerateMutation.isPending ? "animate-pulse" : ""
          }`}
        >
          {regenerateMutation.isPending ? "GENERATING..." : "REGENERATE"}
        </button>
      </div>
      {!collapsed && (
        <div className="px-4 pb-3">
          <p className="text-[13px] font-sans text-foreground/85 leading-relaxed max-w-3xl">
            {regenerateMutation.isPending
              ? "Analyzing top signals..."
              : briefing?.content || "Briefing will be generated shortly..."}
          </p>
        </div>
      )}
    </div>
  );
}
