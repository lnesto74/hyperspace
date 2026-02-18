/**
 * StoryGridModal
 * 
 * Grid of episode thumbnails — discovery surface for behavior episodes.
 * Each tile shows mini-map placeholder, 1-line caption, episode type badge.
 * Click → opens episode in ReplayInsightPanel.
 */

import { useEffect } from 'react';
import { X, Zap, Play, BookOpen, Filter } from 'lucide-react';
import { useReplayInsight } from '../../context/ReplayInsightContext';

const EPISODE_COLORS: Record<string, string> = {
  QUEUE_BUILDUP_SPIKE: '#ef4444',
  LANE_UNDERSUPPLY: '#f97316',
  LANE_OVERSUPPLY: '#eab308',
  ABANDONMENT_WAVE: '#dc2626',
  QUEUE_SWITCHING: '#f59e0b',
  HIGH_PASSBY_LOW_BROWSE: '#8b5cf6',
  BROWSE_NO_CONVERT_PROXY: '#a855f7',
  BOTTLENECK_CORRIDOR: '#f97316',
  ROUTE_DETOUR: '#f59e0b',
  STORE_VISIT_TIME_SHIFT: '#3b82f6',
  EXPOSURE_TO_ACTION_WIN: '#22c55e',
  EXPOSURE_NO_FOLLOWTHROUGH: '#ef4444',
  ATTENTION_QUALITY_DROP: '#f97316',
};

const CATEGORY_ICONS: Record<string, string> = {
  'Checkout Operations': '🛒',
  'Category Performance': '📊',
  'Store Flow': '🚶',
  'Visitor Behavior': '👥',
  'Retail Media': '📺',
  'Merchandising': '🏷️',
  'Store Layout': '🏪',
};

export default function StoryGridModal() {
  const {
    isStoryGridOpen,
    closeStoryGrid,
    episodes,
    fetchEpisodes,
    selectEpisode,
    recipes,
    fetchRecipes,
    executeRecipe,
    isLoading,
  } = useReplayInsight();

  // Fetch data on open
  useEffect(() => {
    if (isStoryGridOpen) {
      fetchEpisodes();
      fetchRecipes();
    }
  }, [isStoryGridOpen, fetchEpisodes, fetchRecipes]);

  if (!isStoryGridOpen) return null;

  // Group episodes by category
  const grouped = new Map<string, typeof episodes>();
  for (const ep of episodes) {
    const cat = ep.category || 'General';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(ep);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[900px] max-h-[80vh] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Replay Insights</h2>
              <p className="text-xs text-gray-400">Behavior episodes detected from trajectory data</p>
            </div>
          </div>
          <button
            onClick={closeStoryGrid}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Story Recipes */}
          {recipes.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-700/30">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="w-4 h-4 text-gray-400" />
                <h3 className="text-sm font-medium text-gray-300">Story Playlists</h3>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {recipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    onClick={() => executeRecipe(recipe.id)}
                    disabled={isLoading}
                    className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 text-blue-400" />
                    <div className="text-left">
                      <div className="text-sm font-medium text-white whitespace-nowrap">{recipe.name}</div>
                      <div className="text-[10px] text-gray-400 whitespace-nowrap">{recipe.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Episode Grid */}
          <div className="px-6 py-4 space-y-6">
            {episodes.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <Filter className="w-8 h-8 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No behavior episodes detected yet</p>
                <p className="text-xs text-gray-500 mt-1">Episodes appear as the system analyzes trajectory data</p>
              </div>
            )}

            {isLoading && (
              <div className="text-center py-12">
                <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-gray-400 text-sm">Analyzing behavior patterns...</p>
              </div>
            )}

            {[...grouped.entries()].map(([category, catEpisodes]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">{CATEGORY_ICONS[category] || '📋'}</span>
                  <h3 className="text-sm font-medium text-gray-300">{category}</h3>
                  <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                    {catEpisodes.length}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {catEpisodes.map((episode) => {
                    const color = EPISODE_COLORS[episode.episode_type] || '#6b7280';

                    return (
                      <button
                        key={episode.episode_id}
                        onClick={() => {
                          selectEpisode(episode.episode_id);
                          closeStoryGrid();
                        }}
                        className="group text-left bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-gray-600 rounded-xl overflow-hidden transition-all"
                      >
                        {/* Mini-map placeholder */}
                        <div
                          className="h-20 relative"
                          style={{
                            background: `linear-gradient(135deg, ${color}10, ${color}05, transparent)`,
                          }}
                        >
                          {/* Zone dots placeholder */}
                          <div className="absolute inset-2 flex items-center justify-center">
                            <div
                              className="w-8 h-8 rounded-full opacity-20 group-hover:opacity-30 transition-opacity"
                              style={{ backgroundColor: color }}
                            />
                          </div>

                          {/* Severity dot */}
                          <div
                            className="absolute top-2 right-2 w-2 h-2 rounded-full"
                            style={{ backgroundColor: color }}
                          />

                          {/* Score */}
                          <div className="absolute bottom-1 right-2 text-[9px] text-gray-500">
                            {Math.round(episode.score * 100)}%
                          </div>
                        </div>

                        {/* Caption */}
                        <div className="px-3 py-2.5">
                          <div className="text-xs font-medium text-white leading-snug line-clamp-2 mb-1">
                            {episode.title}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            {episode.time_label}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
