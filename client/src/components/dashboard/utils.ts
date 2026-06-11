import { SOURCE_META, type FeedItemWithBookmark } from "./constants";

export function getSourceMeta(source: string) {
  return SOURCE_META[source] || { icon: SOURCE_META.community.icon, color: "hsl(68, 95%, 60%)", label: source };
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function getTimeGroup(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  if (date.toDateString() === now.toDateString()) return "TODAY";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "YESTERDAY";
  const diffDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays <= 7) return "THIS WEEK";
  return "EARLIER";
}

export function extractTrending(
  items: FeedItemWithBookmark[],
): { word: string; count: number }[] {
  const stop = new Set([
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "by","from","is","it","that","this","are","was","be","has","had","have",
    "will","can","do","does","did","not","no","so","if","its","how","new",
    "vs","than","more","most","all","into","out","up","about","what","which",
    "their","our","your","you","we","they","been","being","get","got","use",
    "used","using","one","two","may","also","just","over","per","why","top",
    "best","key","big","now","could","like","based","first","make","way",
    "says","said","show","shows","here","after","before","between","through",
  ]);
  const counts: Record<string, number> = {};
  for (const item of items) {
    const words = item.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w));
    const seen = new Set<string>();
    for (const w of words) {
      if (!seen.has(w)) {
        counts[w] = (counts[w] || 0) + 1;
        seen.add(w);
      }
    }
  }
  return Object.entries(counts)
    .map(([word, count]) => ({ word, count }))
    .filter(({ count }) => count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}
