/** Shared styling for Neural Dashboard overlay modals (alerts, journey patterns, etc.) */

export const NEURAL_MODAL_BACKDROP = 'rgba(0, 0, 0, 0.62)'
export const NEURAL_MODAL_PANEL_BG = 'rgba(24, 26, 38, 0.98)'
export const NEURAL_MODAL_BORDER = 'rgba(255, 255, 255, 0.16)'
export const NEURAL_MODAL_DIVIDER = 'rgba(255, 255, 255, 0.12)'
export const NEURAL_MODAL_SECTION_BG = 'rgba(255, 255, 255, 0.05)'

export const neuralModalBackdropStyle = {
  zIndex: 99999,
  background: NEURAL_MODAL_BACKDROP,
  backdropFilter: 'blur(8px)',
} as const

export const neuralModalPanelStyle = {
  background: NEURAL_MODAL_PANEL_BG,
  borderColor: NEURAL_MODAL_BORDER,
} as const
