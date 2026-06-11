export function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: number | string;
  icon: any;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_4px_16px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-3">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
          }}
        >
          <Icon size={15} className="opacity-90" style={{ color }} />
        </div>
        <div className="min-w-0">
          <div className="font-mono tabular-nums text-2xl font-semibold leading-tight text-foreground">
            {value}
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground mt-0.5">
            {label}
          </div>
          {sub && (
            <div className="text-[9px] uppercase tracking-[0.14em] font-medium text-muted-foreground/60 data-readout mt-0.5">
              {sub}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
