import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../config/api'
import { Building2, Plus, Trash2, Edit2, Check, X, GripVertical, MapPin, ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'

interface Company {
  id: string
  name: string
  slug: string
  logo_url: string | null
  venue_count: number
  created_at: string
  updated_at: string
}

interface VenueItem {
  id: string
  name: string
  width: number
  depth: number
  address: string | null
  company_id: string | null
}

export default function CompaniesPage({ onClose }: { onClose: () => void }) {
  const { token } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [venues, setVenues] = useState<VenueItem[]>([])
  const [newCompanyName, setNewCompanyName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [dragVenueId, setDragVenueId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token])

  const fetchData = useCallback(async () => {
    try {
      const [compRes, venueRes] = await Promise.all([
        fetch(`${API_BASE}/api/companies`, { headers: headers() }),
        fetch(`${API_BASE}/api/venues`),
      ])
      if (compRes.ok) setCompanies(await compRes.json())
      if (venueRes.ok) {
        const venueData = await venueRes.json()
        // Fetch company_id for each venue from the detailed venue list
        const detailedVenues: VenueItem[] = venueData.map((v: any) => ({
          id: v.id,
          name: v.name,
          width: v.width,
          depth: v.depth,
          address: v.address || null,
          company_id: v.company_id || null,
        }))
        setVenues(detailedVenues)
      }
    } catch (err) {
      console.error('[Companies] Fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [headers])

  useEffect(() => { fetchData() }, [fetchData])

  const createCompany = async () => {
    if (!newCompanyName.trim()) return
    try {
      const res = await fetch(`${API_BASE}/api/companies`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name: newCompanyName.trim() }),
      })
      if (res.ok) {
        setNewCompanyName('')
        fetchData()
      }
    } catch (err) {
      console.error('[Companies] Create error:', err)
    }
  }

  const updateCompany = async (id: string) => {
    if (!editingName.trim()) return
    try {
      await fetch(`${API_BASE}/api/companies/${id}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ name: editingName.trim() }),
      })
      setEditingId(null)
      fetchData()
    } catch (err) {
      console.error('[Companies] Update error:', err)
    }
  }

  const deleteCompany = async (id: string) => {
    if (!confirm('Delete this company? Venues will become unassigned.')) return
    try {
      await fetch(`${API_BASE}/api/companies/${id}`, {
        method: 'DELETE',
        headers: headers(),
      })
      fetchData()
    } catch (err) {
      console.error('[Companies] Delete error:', err)
    }
  }

  const assignVenue = async (venueId: string, companyId: string | null) => {
    try {
      if (companyId) {
        await fetch(`${API_BASE}/api/companies/${companyId}/assign-venue`, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({ venue_id: venueId }),
        })
      } else {
        await fetch(`${API_BASE}/api/companies/unassign-venue`, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({ venue_id: venueId }),
        })
      }
      fetchData()
    } catch (err) {
      console.error('[Companies] Assign error:', err)
    }
  }

  const handleDragStart = (venueId: string) => {
    setDragVenueId(venueId)
  }

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    setDropTargetId(targetId)
  }

  const handleDragLeave = () => {
    setDropTargetId(null)
  }

  const handleDrop = (e: React.DragEvent, companyId: string | null) => {
    e.preventDefault()
    if (dragVenueId) {
      assignVenue(dragVenueId, companyId)
    }
    setDragVenueId(null)
    setDropTargetId(null)
  }

  const toggleExpand = (id: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const unassignedVenues = venues.filter(v => !v.company_id)
  const getCompanyVenues = (companyId: string) => venues.filter(v => v.company_id === companyId)

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={onClose} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="h-5 w-px bg-gray-700" />
          <Building2 className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-semibold text-white">Companies & Venues</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="text-center py-20 text-gray-500">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Companies list */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Companies</h2>
                <span className="text-xs text-gray-600">{companies.length} companies</span>
              </div>

              {/* Create new company */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={e => setNewCompanyName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createCompany()}
                  placeholder="New company name..."
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
                <button
                  onClick={createCompany}
                  disabled={!newCompanyName.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>

              {/* Company cards */}
              {companies.map(company => {
                const companyVenues = getCompanyVenues(company.id)
                const isExpanded = expandedCompanies.has(company.id)
                const isDropTarget = dropTargetId === company.id

                return (
                  <div
                    key={company.id}
                    className={`rounded-xl border transition-all ${
                      isDropTarget
                        ? 'border-blue-500 bg-blue-500/5 shadow-lg shadow-blue-500/10'
                        : 'border-gray-800 bg-gray-900/50'
                    }`}
                    onDragOver={e => handleDragOver(e, company.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={e => handleDrop(e, company.id)}
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button onClick={() => toggleExpand(company.id)} className="text-gray-500 hover:text-white transition-colors">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <Building2 className="w-5 h-5 text-blue-400 shrink-0" />

                      {editingId === company.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && updateCompany(company.id)}
                            className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                            autoFocus
                          />
                          <button onClick={() => updateCompany(company.id)} className="text-green-400 hover:text-green-300"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-medium text-white truncate">{company.name}</h3>
                            <p className="text-[11px] text-gray-500">{companyVenues.length} venue{companyVenues.length !== 1 ? 's' : ''}</p>
                          </div>
                          <button
                            onClick={() => { setEditingId(company.id); setEditingName(company.name) }}
                            className="text-gray-500 hover:text-white transition-colors p-1"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteCompany(company.id)}
                            className="text-gray-500 hover:text-red-400 transition-colors p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Expanded venue list */}
                    {isExpanded && (
                      <div className="border-t border-gray-800 px-4 py-2 space-y-1">
                        {companyVenues.length === 0 ? (
                          <p className="text-xs text-gray-600 py-2 text-center">
                            Drag venues here to assign them
                          </p>
                        ) : (
                          companyVenues.map(v => (
                            <VenueCard
                              key={v.id}
                              venue={v}
                              onDragStart={() => handleDragStart(v.id)}
                              isDragging={dragVenueId === v.id}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {companies.length === 0 && (
                <div className="text-center py-12 text-gray-600 text-sm">
                  No companies yet. Create one above.
                </div>
              )}
            </div>

            {/* Right: Unassigned venues */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Unassigned Venues</h2>
                <span className="text-xs text-gray-600">{unassignedVenues.length}</span>
              </div>

              <div
                className={`rounded-xl border-2 border-dashed p-3 space-y-2 min-h-[200px] transition-all ${
                  dropTargetId === 'unassigned'
                    ? 'border-amber-500 bg-amber-500/5'
                    : 'border-gray-800'
                }`}
                onDragOver={e => handleDragOver(e, 'unassigned')}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, null)}
              >
                {unassignedVenues.length === 0 ? (
                  <p className="text-xs text-gray-600 py-8 text-center">
                    All venues are assigned
                  </p>
                ) : (
                  unassignedVenues.map(v => (
                    <VenueCard
                      key={v.id}
                      venue={v}
                      onDragStart={() => handleDragStart(v.id)}
                      isDragging={dragVenueId === v.id}
                    />
                  ))
                )}
              </div>

              <p className="text-[11px] text-gray-600 mt-3 text-center">
                Drag venues to a company to assign them
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function VenueCard({ venue, onDragStart, isDragging }: { venue: VenueItem; onDragStart: () => void; isDragging: boolean }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all ${
        isDragging
          ? 'opacity-50 border-blue-500/50 bg-blue-500/5'
          : 'border-gray-700/50 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
      }`}
    >
      <GripVertical className="w-3.5 h-3.5 text-gray-600 shrink-0" />
      <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-white truncate">{venue.name}</p>
        <p className="text-[10px] text-gray-500">{venue.width}m × {venue.depth}m{venue.address ? ` · ${venue.address}` : ''}</p>
      </div>
    </div>
  )
}
