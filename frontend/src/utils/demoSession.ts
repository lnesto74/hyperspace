/** Append demoSession query param when a JSONL replay demo is active. */
export function withDemoSession(url: string, demoSessionId: string | null | undefined): string {
  if (!demoSessionId) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}demoSession=${encodeURIComponent(demoSessionId)}`
}
