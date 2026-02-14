import { Sparkles } from 'lucide-react';
import { useNarrator } from '../../context/NarratorContext';

export default function NarratorToggle() {
  const { isOpen, toggleNarrator, proactiveInsights, proactiveMode } = useNarrator();

  const hasAlerts = proactiveMode && proactiveInsights.length > 0;

  return (
    <button
      onClick={toggleNarrator}
      className={`relative flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all ${
        isOpen
          ? 'bg-purple-600 hover:bg-purple-700 text-white'
          : 'bg-gray-800 hover:bg-purple-600 text-gray-300 hover:text-white border border-gray-600 hover:border-purple-500'
      }`}
      title="AI Narrator"
    >
      <Sparkles className="w-4 h-4" />
      {hasAlerts && !isOpen && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
          {proactiveInsights.length > 9 ? '9+' : proactiveInsights.length}
        </span>
      )}
    </button>
  );
}
