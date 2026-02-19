/**
 * StoryGridModal
 * 
 * Grid of episode thumbnails — discovery surface for behavior episodes.
 * Each tile shows mini-map placeholder, 1-line caption, episode type badge.
 * Click → opens episode in ReplayInsightPanel.
 */

import { useEffect } from 'react';
import { X, Zap, Play, BookOpen, Filter, Users, AlertTriangle, TrendingUp, TrendingDown, MapPin, Clock, Eye, ShoppingCart, ArrowRightLeft } from 'lucide-react';
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

const EPISODE_ICONS: Record<string, typeof Zap> = {
  QUEUE_BUILDUP_SPIKE: Users,
  LANE_UNDERSUPPLY: ShoppingCart,
  LANE_OVERSUPPLY: ShoppingCart,
  ABANDONMENT_WAVE: Users,
  QUEUE_SWITCHING: ArrowRightLeft,
  HIGH_PASSBY_LOW_BROWSE: Eye,
  BROWSE_NO_CONVERT_PROXY: MapPin,
  BOTTLENECK_CORRIDOR: Users,
  ROUTE_DETOUR: ArrowRightLeft,
  STORE_VISIT_TIME_SHIFT: Clock,
  EXPOSURE_TO_ACTION_WIN: TrendingUp,
  EXPOSURE_NO_FOLLOWTHROUGH: TrendingDown,
  ATTENTION_QUALITY_DROP: AlertTriangle,
};

const SEVERITY_LABELS: Record<string, { text: string; bg: string; border: string }> = {
  high: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/25' },
  medium: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/25' },
  low: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/25' },
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
                        className="group text-left bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-gray-600 rounded-xl overflow-hidden transition-all hover:scale-[1.02] hover:shadow-lg"
                      >
                        {/* Card header visual */}
                        <div
                          className="h-[72px] relative overflow-hidden"
                          style={{
                            background: `linear-gradient(135deg, ${color}12, ${color}06, rgba(17,24,39,0.9))`,
                          }}
                        >
                          {/* Background icon (large, faded) */}
                          {(() => {
                            const Icon = EPISODE_ICONS[episode.episode_type] || Zap;
                            return (
                              <Icon
                                className="absolute -right-2 -bottom-2 w-16 h-16 opacity-[0.06] group-hover:opacity-[0.1] transition-opacity"
                                style={{ color }}
                              />
                            );
                          })()}

                          {/* Top row: severity + type badge */}
                          <div className="absolute top-2 left-2.5 right-2.5 flex items-center justify-between">
                            {(() => {
                              const sev = SEVERITY_LABELS[episode.severity] || SEVERITY_LABELS.low;
                              return (
                                <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${sev.bg} ${sev.text} border ${sev.border}`}>
                                  {episode.severity}
                                </span>
                              );
                            })()}
                            <span className="text-[9px] text-gray-500 font-mono">
                              {Math.round(episode.score * 100)}%
                            </span>
                          </div>

                          {/* Bottom row: KPI deltas */}
                          <div className="absolute bottom-2 left-2.5 flex items-center gap-2">
                            {episode.kpis && episode.kpis.length > 0 ? (
                              episode.kpis.slice(0, 3).map((kpi, ki) => (
                                <div
                                  key={ki}
                                  className="flex items-center gap-0.5 text-[9px]"
                                  style={{ color: kpi.direction === 'up' ? '#34d399' : kpi.direction === 'down' ? '#f87171' : '#9ca3af' }}
                                >
                                  {kpi.direction === 'up' ? <TrendingUp className="w-2.5 h-2.5" /> : kpi.direction === 'down' ? <TrendingDown className="w-2.5 h-2.5" /> : null}
                                  <span className="truncate max-w-[50px]">{kpi.label}</span>
                                </div>
                              ))
                            ) : (
                              <div className="flex items-center gap-1 text-[9px] text-gray-600">
                                <Zap className="w-2.5 h-2.5" style={{ color }} />
                                <span>{episode.category}</span>
                              </div>
                            )}
                          </div>

                          {/* Zone count badge */}
                          {episode.highlight_zones && episode.highlight_zones.length > 0 && (
                            <div className="absolute bottom-2 right-2.5 flex items-center gap-0.5 text-[9px] text-gray-500">
                              <MapPin className="w-2.5 h-2.5" />
                              {episode.highlight_zones.length}
                            </div>
                          )}
                        </div>

                        {/* Caption */}
                        <div className="px-3 py-2.5">
                          <div className="text-xs font-medium text-white leading-snug line-clamp-2 mb-1 group-hover:text-gray-100">
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
