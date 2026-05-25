import { API_BASE } from '../../config/api'
import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  ShoppingBag,
  RefreshCw,
  Clock,
  Building2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useVenue } from '../../context/VenueContext';
import { PERSONAS, getPersonaById, enforceKpiCap } from './personas';
import ReportingKpiStrip from './components/ReportingKpiStrip';
import ReportingInsightsPanel from './components/ReportingInsightsPanel';
import ZonePerformanceViewport, { type ZonePerformanceItem } from './components/ZonePerformanceViewport';
import PersonaIconRail from './components/PersonaIconRail';
import CategoryRankingPanel, { CategoryRankingRow } from './components/CategoryRankingPanel';

type TimeRange = '1h' | '24h' | '7d' | 'custom';

interface TimeRangeOption {
  id: TimeRange;
  label: string;
  getRange: () => { startTs: number; endTs: number };
}

const TIME_RANGES: TimeRangeOption[] = [
  {
    id: '1h',
    label: '1h',
    getRange: () => ({
      startTs: Date.now() - 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
  {
    id: '24h',
    label: '24h',
    getRange: () => ({
      startTs: Date.now() - 24 * 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
  {
    id: '7d',
    label: '7d',
    getRange: () => ({
      startTs: Date.now() - 7 * 24 * 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
];

const ZONE_MAP_PERSONAS = new Set(['store-manager', 'merchandising']);

interface BusinessReportingPageProps {
  onClose: () => void;
}

export default function BusinessReportingPage({ onClose }: BusinessReportingPageProps) {
  const { venue, venues } = useVenue();
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(venue?.id || null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(PERSONAS[0].id);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>('24h');
  const [kpiValues, setKpiValues] = useState<Record<string, number | null>>({});
  const [supporting, setSupporting] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; skuCount?: number }>>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);

  const selectedPersona = useMemo(
    () => getPersonaById(selectedPersonaId) || PERSONAS[0],
    [selectedPersonaId],
  );

  const kpiDefinitions = useMemo(
    () => enforceKpiCap(selectedPersona),
    [selectedPersona],
  );

  const deadZones = useMemo(
    () => (supporting.deadZones as ZonePerformanceItem[]) || [],
    [supporting.deadZones],
  );

  const topZones = useMemo(
    () => (supporting.topZones as ZonePerformanceItem[]) || [],
    [supporting.topZones],
  );

  const showZoneMap = ZONE_MAP_PERSONAS.has(selectedPersonaId)
    && selectedVenueId
    && (deadZones.length > 0 || topZones.length > 0);

  const fetchData = async () => {
    if (!selectedVenueId) return;

    setLoading(true);
    setError(null);

    try {
      const timeRangeOption = TIME_RANGES.find(t => t.id === selectedTimeRange);
      const { startTs, endTs } = timeRangeOption?.getRange() || TIME_RANGES[1].getRange();

      const params = new URLSearchParams({
        personaId: selectedPersonaId,
        venueId: selectedVenueId,
        startTs: String(startTs),
        endTs: String(endTs),
      });

      if (selectedPersonaId === 'merchandising' && selectedCategoryId !== 'all') {
        params.set('categoryId', selectedCategoryId);
      }

      const response = await fetch(`${API_BASE}/api/reporting/summary?${params}`);

      if (!response.ok) {
        if (response.status === 404) {
          setError('Business Reporting feature is not enabled. Set FEATURE_BUSINESS_REPORTING=true.');
          return;
        }
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const data = await response.json();
      setKpiValues(data.kpis || {});
      setSupporting(data.supporting || {});
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch reporting data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedVenueId, selectedPersonaId, selectedTimeRange, selectedCategoryId]);

  useEffect(() => {
    if (venue?.id && !selectedVenueId) {
      setSelectedVenueId(venue.id);
    }
  }, [venue?.id]);

  useEffect(() => {
    const fetchCategories = async () => {
      if (!selectedVenueId) return;
      try {
        const res = await fetch(`${API_BASE}/api/reporting/categories?venueId=${selectedVenueId}`);
        if (res.ok) {
          const data = await res.json();
          setCategories(data.categories || []);
        }
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      }
    };
    fetchCategories();
  }, [selectedVenueId]);

  const topCategories = supporting.topCategories as CategoryRankingRow[] | undefined;

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden">
      {/* Command strip header */}
      <div className="h-12 border-b border-gray-700 flex items-center justify-between px-3 bg-gray-800 flex-shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5 flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs hidden sm:inline">Back</span>
          </button>
          <div className="h-5 w-px bg-gray-700 flex-shrink-0" />
          <h1 className="text-white text-sm font-semibold truncate">Business Reporting</h1>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Building2 className="w-3.5 h-3.5 text-gray-500 hidden sm:block" />
          <select
            value={selectedVenueId || ''}
            onChange={(e) => setSelectedVenueId(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-xs text-white max-w-[140px] sm:max-w-none"
          >
            {(venues || []).map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>

          <div className="flex bg-gray-700 rounded-md p-0.5">
            {TIME_RANGES.map(tr => (
              <button
                key={tr.id}
                onClick={() => setSelectedTimeRange(tr.id)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  selectedTimeRange === tr.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tr.label}
              </button>
            ))}
          </div>

          {selectedPersonaId === 'merchandising' && categories.length > 0 && (
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-xs text-white max-w-[120px] hidden md:block"
            >
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={fetchData}
            disabled={loading}
            className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-gray-300 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {lastUpdated && (
            <span className="text-[10px] text-gray-500 hidden lg:inline">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-3 py-3 space-y-3">
          <PersonaIconRail
            selectedPersonaId={selectedPersonaId}
            onSelect={setSelectedPersonaId}
          />

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {loading && !error && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          )}

          {!loading && !error && (
            <>
              <ReportingKpiStrip
                kpiDefinitions={kpiDefinitions}
                kpiValues={kpiValues}
              />

              {showZoneMap && (
                <ZonePerformanceViewport
                  venueId={selectedVenueId!}
                  deadZones={deadZones}
                  topZones={topZones}
                />
              )}

              <ReportingInsightsPanel
                kpiDefinitions={kpiDefinitions}
                kpiValues={kpiValues}
                personaName={selectedPersona.name}
                compact
              />

              {Array.isArray(topCategories) && topCategories.length > 0 && (
                <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCategoriesExpanded(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-800/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-left">
                      {categoriesExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
                      <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-medium text-white">Category Performance Ranking</span>
                      <span className="text-[10px] text-gray-500">({topCategories.length})</span>
                    </div>
                    {selectedPersonaId === 'merchandising' && selectedCategoryId !== 'all' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCategoryId('all');
                        }}
                        className="text-[10px] text-amber-400 hover:text-amber-300"
                      >
                        Clear filter
                      </button>
                    )}
                  </button>
                  {categoriesExpanded && (
                    <div className="px-3 pb-3 border-t border-gray-700/60 pt-2">
                      <CategoryRankingPanel
                        categories={topCategories}
                        selectedCategoryId={selectedPersonaId === 'merchandising' ? selectedCategoryId : undefined}
                        onSelectCategory={
                          selectedPersonaId === 'merchandising'
                            ? (categoryId) => setSelectedCategoryId(categoryId)
                            : undefined
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {supporting.activeCampaigns && (supporting.activeCampaigns as unknown[]).length > 0 && (
                <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 px-3 py-2">
                  <h3 className="text-xs font-medium text-gray-400 mb-2">Active Campaigns</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(supporting.activeCampaigns as Array<{ id: string; name: string }>).map(campaign => (
                      <span
                        key={campaign.id}
                        className="px-2 py-0.5 bg-purple-500/10 border border-purple-500/30 rounded-full text-[10px] text-purple-300"
                      >
                        {campaign.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
