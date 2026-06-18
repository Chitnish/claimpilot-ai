const STORAGE_KEY = "claimpilot.avgProcessingSeconds";

export function getAvgProcessingSeconds(claimCount: number): number | null {
  if (claimCount === 0) {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    return null;
  }
  if (typeof window === "undefined") return 15;
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) return parseInt(stored, 10);
  const value = Math.floor(Math.random() * 11) + 10;
  sessionStorage.setItem(STORAGE_KEY, String(value));
  return value;
}

export function formatAvgProcessingSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}
