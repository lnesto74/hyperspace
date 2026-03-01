/**
 * LaunchPad Toggle Button
 * 
 * Placed in the bottom-right toolbar alongside existing feature buttons.
 * Shows a rocket icon with optional progress badge.
 */

import { Rocket } from 'lucide-react'
import { isLaunchPadEnabled } from './launchpadTypes'

interface LaunchPadToggleProps {
  isOpen: boolean
  onToggle: () => void
  completedSteps: number
  totalSteps: number
}

export default function LaunchPadToggle({ isOpen, onToggle, completedSteps, totalSteps }: LaunchPadToggleProps) {
  if (!isLaunchPadEnabled()) return null

  const progress = totalSteps > 0 ? completedSteps / totalSteps : 0
  const hasProgress = completedSteps > 0 && completedSteps < totalSteps

  return (
    <button
      onClick={onToggle}
      className={`relative flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all ${
        isOpen
          ? 'bg-indigo-600 hover:bg-indigo-700 text-white ring-2 ring-indigo-400/50'
          : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
      }`}
      title={isOpen ? 'Close LaunchPad' : 'Open LaunchPad — Commissioning Wizard'}
    >
      <Rocket className="w-4 h-4" />
      
      {/* Progress badge */}
      {hasProgress && !isOpen && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center">
          <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" fill="#1e1e2e" stroke="#4b5563" strokeWidth="2" />
            <circle
              cx="10" cy="10" r="8"
              fill="none"
              stroke="#818cf8"
              strokeWidth="2"
              strokeDasharray={`${progress * 50.27} 50.27`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute text-[8px] font-bold text-indigo-300">
            {completedSteps}
          </span>
        </span>
      )}

      {/* Completed badge */}
      {completedSteps === totalSteps && totalSteps > 0 && !isOpen && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
          ✓
        </span>
      )}
    </button>
  )
}
