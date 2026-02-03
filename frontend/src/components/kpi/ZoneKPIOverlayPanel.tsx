import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'
import ZoneKPIIndicator from './ZoneKPIIndicator'

interface ZoneKPIOverlayPanelProps {
  onZoneClick?: (roiId: string) => void
}

export default function ZoneKPIOverlayPanel({ onZoneClick }: ZoneKPIOverlayPanelProps) {
  const { regions, showKPIOverlays, openKPIPopup } = useRoi()
  const { selectedObjectId } = useVenue()

  // Hide when right panel is open (object selected) or KPI overlays toggled off
  if (!showKPIOverlays || regions.length === 0 || selectedObjectId) {
    return null
  }

  const handleZoneClick = (roiId: string) => {
    if (onZoneClick) {
      onZoneClick(roiId)
    } else {
      openKPIPopup(roiId)
    }
  }

  return (
    <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 max-h-[calc(100vh-120px)] overflow-y-auto pr-1">
      {regions.map((roi) => (
        <ZoneKPIIndicator
          key={roi.id}
          roiId={roi.id}
          roiName={roi.name}
          roiColor={roi.color}
          onClick={() => handleZoneClick(roi.id)}
        />
      ))}
    </div>
  )
}
