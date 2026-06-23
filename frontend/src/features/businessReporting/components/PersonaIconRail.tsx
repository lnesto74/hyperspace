import { Store, ShoppingBag, Monitor, TrendingUp, Landmark } from 'lucide-react';
import { PERSONAS } from '../personas';

function getPersonaIcon(iconName: string) {
  switch (iconName) {
    case 'Store': return Store;
    case 'ShoppingBag': return ShoppingBag;
    case 'Monitor': return Monitor;
    case 'TrendingUp': return TrendingUp;
    case 'Landmark': return Landmark;
    default: return Store;
  }
}

interface PersonaIconRailProps {
  selectedPersonaId: string;
  onSelect: (id: string) => void;
}

export default function PersonaIconRail({ selectedPersonaId, onSelect }: PersonaIconRailProps) {
  return (
    <div className="flex items-center gap-2">
      {PERSONAS.map(persona => {
        const Icon = getPersonaIcon(persona.icon);
        const isSelected = persona.id === selectedPersonaId;
        return (
          <button
            key={persona.id}
            type="button"
            onClick={() => onSelect(persona.id)}
            title={`${persona.name} — ${persona.description}`}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
              isSelected
                ? 'bg-gray-800 border-gray-500 shadow-sm'
                : 'bg-gray-800/40 border-gray-700/80 hover:border-gray-600'
            }`}
            style={isSelected ? { borderColor: persona.color } : undefined}
          >
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${persona.color}20` }}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: persona.color }} />
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${isSelected ? 'text-white' : 'text-gray-400'}`}>
              {persona.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
