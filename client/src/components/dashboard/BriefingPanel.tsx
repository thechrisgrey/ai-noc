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
    <div className="flex-shrink-0 border-b border-primary/15 bg-primary/[0.03]">
      <div className="w-full flex items-center gap-1 pr-4">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex-1 flex items-center gap-2 pl-4 py-2 text-left"
        >
          <Activity size={12} className="text-primary/60" />
          <span className="text-[10px] uppercase tracking-wider text-primary/60 data-readout font-medium">
            INTELLIGENCE BRIEFING
          </span>
          {briefing?.generatedAt && (
            <span className="text-[9px] text-muted-foreground/60 data-readout">
              {timeAgo(briefing.generatedAt)}
            </span>
          )}
          <span className="ml-auto">
            {collapsed ? (
              <ChevronDown size={12} className="text-muted-foreground/30" />
            ) : (
              <ChevronUp size={12} className="text-muted-foreground/30" />
            )}
          </span>
        </button>
        <button
          onClick={() => regenerateMutation.mutate()}
          disabled={regenerateMutation.isPending}
          className={`text-[9px] px-1.5 py-0.5 rounded text-primary/40 hover:text-primary hover:bg-primary/10 data-readout transition-colors cursor-pointer ${
            regenerateMutation.isPending ? "animate-pulse" : ""
          }`}
        >
          {regenerateMutation.isPending ? "GENERATING..." : "REGENERATE"}
        </button>
      </div>
      {!collapsed && (
        <div className="px-4 pb-3">
          <div className="border-l-[3px] border-primary/20 pl-4 py-1">
            <p className="text-[12px] font-mono text-foreground/75 leading-relaxed">
              {regenerateMutation.isPending
                ? "Analyzing top signals..."
                : briefing?.content || "Briefing will be generated shortly..."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
