export function getPersistenceMode(): "local" | "supabase" {
  const mode = process.env.NEXT_PUBLIC_PERSISTENCE ?? "local";
  return mode === "supabase" ? "supabase" : "local";
}

export function isSupabaseConfigured(): boolean {
  return (
    getPersistenceMode() === "supabase" &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

export function generateToken(length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function generateSecret(length = 16): string {
  return generateToken(length);
}

export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function getShareUrl(shareToken: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/m/${shareToken}`;
  }
  return `/m/${shareToken}`;
}

export function getResultsUrl(shareToken: string, ownerSecret: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/m/${shareToken}/results?secret=${ownerSecret}`;
  }
  return `/m/${shareToken}/results?secret=${ownerSecret}`;
}
