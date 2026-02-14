import { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, 
  Store, 
  ShoppingBag, 
  Monitor, 
  TrendingUp,
  RefreshCw,
  Clock,
  Building2
} from 'lucide-react';
import { useVenue } from '../../context/VenueContext';
import { PERSONAS, getPersonaById, enforceKpiCap, PersonaConfig } from './personas';
import ReportingKpiGrid from './components/ReportingKpiGrid';
import ReportingInsightsPanel from './components/ReportingInsightsPanel';
import DeadZonesViewport from './components/DeadZonesViewport';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type TimeRange = '1h' | '24h' | '7d' | 'custom';

interface TimeRangeOption {
  id: TimeRange;
  label: string;
  getRange: () => { startTs: number; endTs: number };
}

const TIME_RANGES: TimeRangeOption[] = [
  {
    id: '1h',
    label: '1 Hour',
    getRange: () => ({
      startTs: Date.now() - 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
  {
    id: '24h',
    label: '24 Hours',
    getRange: () => ({
      startTs: Date.now() - 24 * 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
  {
    id: '7d',
    label: '7 Days',
    getRange: () => ({
      startTs: Date.now() - 7 * 24 * 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
];

function getPersonaIcon(iconName: string) {
  switch (iconName) {
    case 'Store': return Store;
    case 'ShoppingBag': return ShoppingBag;
    case 'Monitor': return Monitor;
    case 'TrendingUp': return TrendingUp;
    default: return Store;
  }
}

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
  const [categories, setCategories] = useState<Array<{id: string; name: string; skuCount?: number}>>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  
  const selectedPersona = useMemo(() => 
    getPersonaById(selectedPersonaId) || PERSONAS[0], 
    [selectedPersonaId]
  );
  
  const kpiDefinitions = useMemo(() => 
    enforceKpiCap(selectedPersona),
    [selectedPersona]
  );
  
  // Fetch KPI data
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
      
      // Add category filter for merchandising persona
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
      console.log('[BusinessReporting] API Response:', data);
      console.log('[BusinessReporting] KPI Values:', data.kpis);
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
  
  // Fetch on mount and when params change
  useEffect(() => {
    fetchData();
  }, [selectedVenueId, selectedPersonaId, selectedTimeRange, selectedCategoryId]);
  
  // Update venue selection when venue changes
  useEffect(() => {
    if (venue?.id && !selectedVenueId) {
      setSelectedVenueId(venue.id);
    }
  }, [venue?.id]);

  // Fetch categories when venue changes
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
  
  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-gray-700 flex items-center justify-between px-4 bg-gray-800 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
          <div className="h-6 w-px bg-gray-700" />
          <h1 className="text-white font-semibold">Business Reporting</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Venue Selector */}
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            <select
              value={selectedVenueId || ''}
              onChange={(e) => setSelectedVenueId(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {(venues || []).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          
          {/* Time Range Selector */}
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <div className="flex bg-gray-700 rounded-lg p-0.5">
              {TIME_RANGES.map((tr) => (
                <button
                  key={tr.id}
                  onClick={() => setSelectedTimeRange(tr.id)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    selectedTimeRange === tr.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {tr.label}
                </button>
              ))}
            </div>
          </div>
          
          {/* Category Selector (only for merchandising) */}
          {selectedPersonaId === 'merchandising' && categories.length > 0 && (
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-gray-400" />
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} {cat.skuCount ? `(${cat.skuCount} SKUs)` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Refresh Button */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          {/* Persona Tabs */}
          <div className="flex gap-3 mb-6 overflow-x-auto pb-2">
            {PERSONAS.map((persona) => {
              const Icon = getPersonaIcon(persona.icon);
              const isSelected = persona.id === selectedPersonaId;
              
              return (
                <button
                  key={persona.id}
                  onClick={() => setSelectedPersonaId(persona.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all flex-shrink-0 ${
                    isSelected
                      ? 'bg-gray-800 border-blue-500 shadow-lg'
                      : 'bg-gray-800/50 border-gray-700 hover:border-gray-500'
                  }`}
                  style={{
                    borderColor: isSelected ? persona.color : undefined,
                  }}
                >
                  <div 
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${persona.color}20` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: persona.color }} />
                  </div>
                  <div className="text-left">
                    <div className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                      {persona.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {persona.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          
          {/* Error State */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
          
          {/* Loading State */}
          {loading && !error && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          )}
          
          {/* KPI Grid */}
          {!loading && !error && (
            <>
              <ReportingKpiGrid
                kpiDefinitions={kpiDefinitions}
                kpiValues={kpiValues}
              />
              
              {/* Insights Panel */}
              <ReportingInsightsPanel
                kpiDefinitions={kpiDefinitions}
                kpiValues={kpiValues}
                personaName={selectedPersona.name}
              />
              
              {/* Dead Zones with Interactive Viewport */}
              {supporting.deadZones && (supporting.deadZones as unknown[]).length > 0 && selectedVenueId && (
                <div className="mt-6 bg-gray-800/50 rounded-xl border border-gray-700 p-5">
                  <h3 className="text-sm font-semibold text-white mb-4">Dead Zones Analysis</h3>
                  <DeadZonesViewport
                    venueId={selectedVenueId}
                    deadZones={supporting.deadZones as Array<{id: string; name: string; utilization: number}>}
                  />
                </div>
              )}
              
              {supporting.activeCampaigns && (supporting.activeCampaigns as unknown[]).length > 0 && (
                <div className="mt-6 bg-gray-800/50 rounded-xl border border-gray-700 p-5">
                  <h3 className="text-sm font-semibold text-white mb-3">Active Campaigns</h3>
                  <div className="flex flex-wrap gap-2">
                    {(supporting.activeCampaigns as Array<{id: string; name: string}>).map((campaign) => (
                      <span 
                        key={campaign.id}
                        className="px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-full text-xs text-purple-300"
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
