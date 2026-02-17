/**
 * Narrator2 Toggle Button
 * 
 * Floating button to open/close the Narrator2 drawer.
 */

import { Sparkles } from 'lucide-react';
import { useNarrator2 } from '../../context/Narrator2Context';

export default function Narrator2Toggle() {
  const { isOpen, toggleNarrator } = useNarrator2();

  return (
    <button
      onClick={toggleNarrator}
      className={`relative flex items-center justify-center w-11 h-11 rounded-xl shadow-lg transition-all duration-200 ${
        isOpen
          ? 'bg-purple-600 hover:bg-purple-700 text-white ring-2 ring-purple-400/50'
          : 'bg-gray-800 hover:bg-purple-600 text-gray-300 hover:text-white border border-gray-600 hover:border-purple-500'
      }`}
      title="AI Narrator (v2)"
    >
      <Sparkles className="w-5 h-5" />
      {/* v2 badge */}
      <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
        2
      </span>
    </button>
  );
}
