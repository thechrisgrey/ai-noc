export interface SourceHealth {
  source: string;
  lastSuccess: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  totalFetches: number;
  totalSuccesses: number;
}

const healthMap = new Map<string, SourceHealth>();

function getOrCreate(source: string): SourceHealth {
  let entry = healthMap.get(source);
  if (!entry) {
    entry = {
      source,
      lastSuccess: null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      totalFetches: 0,
      totalSuccesses: 0,
    };
    healthMap.set(source, entry);
  }
  return entry;
}

export function recordSuccess(source: string): void {
  const entry = getOrCreate(source);
  entry.lastSuccess = new Date().toISOString();
  entry.consecutiveFailures = 0;
  entry.totalFetches++;
  entry.totalSuccesses++;
}

export function recordFailure(source: string, errorMessage: string): void {
  const entry = getOrCreate(source);
  entry.lastError = errorMessage;
  entry.lastErrorAt = new Date().toISOString();
  entry.consecutiveFailures++;
  entry.totalFetches++;
}

export function getHealthMap(): Record<string, SourceHealth> {
  const result: Record<string, SourceHealth> = {};
  healthMap.forEach((value, key) => {
    result[key] = { ...value };
  });
  return result;
}

export function getHealthSummary(): { online: number; failing: number; total: number } {
  let online = 0;
  let failing = 0;
  healthMap.forEach((entry) => {
    if (entry.consecutiveFailures > 0) {
      failing++;
    } else {
      online++;
    }
  });
  return { online, failing, total: healthMap.size };
}
