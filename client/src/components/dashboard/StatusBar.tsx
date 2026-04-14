import { useState, useEffect } from "react";
import { timeAgo } from "./utils";

export function StatusBar({ lastSynced }: { lastSynced?: string }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="hidden md:flex items-center gap-3 text-xs data-readout text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 status-pulse" />
        <span className="text-green-400">ONLINE</span>
      </span>
      <span className="text-border">|</span>
      <span>{time.toLocaleTimeString("en-US", { hour12: false })}</span>
      <span className="text-border">|</span>
      <span>
        UTC
        {time.getTimezoneOffset() > 0 ? "-" : "+"}
        {Math.abs(time.getTimezoneOffset() / 60)}
      </span>
      {lastSynced && (
        <>
          <span className="text-border">|</span>
          <span className="text-muted-foreground/50">
            SYNCED {timeAgo(lastSynced)}
          </span>
        </>
      )}
    </div>
  );
}
