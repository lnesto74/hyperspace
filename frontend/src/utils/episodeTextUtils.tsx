import type { ReactNode } from 'react'
import { ROI_CATEGORY_COLOR } from './roiCategoryUtils'

/** Split text and wrap matching terms in an amber highlight span. */
export function highlightTerms(text: string, terms: string[]): ReactNode {
  const active = terms.filter(t => t && t.trim()).map(t => t.trim())
  if (!text || active.length === 0) return text

  const pattern = active
    .sort((a, b) => b.length - a.length)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  if (!pattern) return text

  const parts = text.split(new RegExp(`(${pattern})`, 'gi'))
  return parts.map((part, i) => {
    const isMatch = active.some(t => t.toLowerCase() === part.toLowerCase())
    if (!isMatch) return part
    return (
      <span
        key={`${part}-${i}`}
        className="font-semibold"
        style={{ color: ROI_CATEGORY_COLOR }}
      >
        {part}
      </span>
    )
  })
}

export function episodeHighlightTerms(episode: {
  product_category?: string | null
  features?: Record<string, unknown>
}): string[] {
  const terms: string[] = []
  if (episode.product_category) terms.push(episode.product_category)
  const fromFeatures = episode.features?.product_category
  if (typeof fromFeatures === 'string' && fromFeatures.trim()) {
    terms.push(fromFeatures.trim())
  }
  return [...new Set(terms)]
}
