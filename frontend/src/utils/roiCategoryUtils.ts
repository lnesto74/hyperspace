import type { RegionOfInterest } from '../types'

export const ROI_CATEGORY_COLOR = '#fcd34d' // amber-300, matches object hover tooltip

type ObjectLike = {
  id: string
  metadata?: {
    business_category_label?: string
    business_category?: string
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Client-side category: ROI metadata or linked shelf object. */
export function resolveRoiCategorySync(
  roi: Pick<RegionOfInterest, 'metadata'>,
  objects: ObjectLike[],
): string | null {
  const fromRoi = roi.metadata?.business_category_label
  if (typeof fromRoi === 'string' && fromRoi.trim()) return fromRoi.trim()

  const shelfId = roi.metadata?.shelfId
  if (shelfId) {
    const obj = objects.find(o => o.id === shelfId)
    const fromObj = obj?.metadata?.business_category_label || obj?.metadata?.business_category
    if (typeof fromObj === 'string' && fromObj.trim()) return fromObj.trim()
  }

  return null
}

export function setRoiLabelHtml(
  labelDiv: HTMLDivElement,
  roiName: string,
  category: string | null,
  borderColor: string,
) {
  labelDiv.style.border = `2px solid ${borderColor}`

  if (category) {
    labelDiv.innerHTML = `
      <div style="color:#fff;font-weight:500;line-height:1.3">${escapeHtml(roiName)}</div>
      <div style="color:${ROI_CATEGORY_COLOR};font-size:11px;margin-top:2px;font-weight:600">${escapeHtml(category)}</div>
    `
  } else {
    labelDiv.textContent = roiName
  }
}

export async function fetchRoiCategoryLabel(roiId: string, apiBase: string): Promise<string | null> {
  const res = await fetch(`${apiBase}/api/roi/${roiId}/shelf-info`)
  if (!res.ok) return null

  const data = await res.json()
  if (typeof data.businessCategory === 'string' && data.businessCategory.trim()) {
    return data.businessCategory.trim()
  }
  if (Array.isArray(data.categories) && data.categories.length > 0) {
    return data.categories.filter(Boolean).join(', ')
  }
  return null
}
