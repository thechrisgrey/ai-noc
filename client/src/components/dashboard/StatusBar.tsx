import { useState, useEffect } from "react";
import { timeAgo } from "./utils";

export function StatusBar({ lastSynced }: { lastSynced?: string }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="hidden md:flex items-center gap-3 text-xs data-readout tabular-nums text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-primary status-pulse" />
        <span className="text-primary text-[10px] tracking-[0.14em] font-medium">ONLINE</span>
      </span>
      <span className="h-3 w-px bg-white/[0.08]" aria-hidden="true" />
      <span>{time.toLocaleTimeString("en-US", { hour12: false })}</span>
      <span className="h-3 w-px bg-white/[0.08]" aria-hidden="true" />
      <span>
        UTC
        {time.getTimezoneOffset() > 0 ? "-" : "+"}
        {Math.abs(time.getTimezoneOffset() / 60)}
      </span>
      {lastSynced && (
        <>
          <span className="h-3 w-px bg-white/[0.08]" aria-hidden="true" />
          <span className="text-muted-foreground/60">
            SYNCED {timeAgo(lastSynced)}
          </span>
        </>
      )}
      <span
        aria-hidden="true"
        className="hidden lg:inline ml-auto text-[10px] tracking-[0.14em] text-muted-foreground/50 data-readout"
      >
        J/K NAVIGATE · O OPEN · B SAVE
      </span>
    </div>
  );
}
