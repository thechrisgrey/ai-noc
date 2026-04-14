export function KpiCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: any;
  color: string;
}) {
  return (
    <div className="relative px-4 py-3 rounded border border-border/40 bg-card/30 overflow-hidden">
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px]"
        style={{ backgroundColor: color, opacity: 0.5 }}
      />
      <div className="flex items-center gap-3">
        <div style={{ color }} className="opacity-60">
          <Icon size={18} />
        </div>
        <div>
          <div className="data-readout text-lg font-semibold text-foreground">
            {value}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}
