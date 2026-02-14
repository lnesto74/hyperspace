import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Trash2, GripVertical, Play, Pause, Plus, Film, Clock, CheckCircle, AlertCircle } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001'

interface PlaylistVideo {
  id: string
  venueId: string
  name: string
  filename: string
  filePath: string
  durationMs: number
  fileSizeBytes?: number
  mimeType?: string
}

interface PlaylistItem {
  id: string
  screenId: string
  videoId: string
  orderIndex: number
  enabled: boolean
  video: PlaylistVideo
}

interface PlaylistManagerProps {
  screenId: string
  venueId: string
}

export default function PlaylistManager({ screenId, venueId }: PlaylistManagerProps) {
  const [venueVideos, setVenueVideos] = useState<PlaylistVideo[]>([])
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)

  // Load venue videos and screen playlist
  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Load all venue videos
      const videosRes = await fetch(`${API_BASE}/api/dooh/videos?venueId=${venueId}`)
      if (videosRes.ok) {
        const data = await videosRes.json()
        setVenueVideos(data.videos || [])
      }

      // Load screen playlist
      if (screenId) {
        const playlistRes = await fetch(`${API_BASE}/api/dooh/screens/${screenId}/playlist`)
        if (playlistRes.ok) {
          const data = await playlistRes.json()
          setPlaylist(data.playlist || [])
        }
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [venueId, screenId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Upload video
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setUploadProgress(0)
    setError(null)

    try {
      // Get video duration using a temporary video element
      const videoUrl = URL.createObjectURL(file)
      const tempVideo = document.createElement('video')
      tempVideo.src = videoUrl
      
      const durationMs = await new Promise<number>((resolve) => {
        tempVideo.onloadedmetadata = () => {
          resolve(Math.round(tempVideo.duration * 1000))
          URL.revokeObjectURL(videoUrl)
        }
        tempVideo.onerror = () => {
          resolve(0)
          URL.revokeObjectURL(videoUrl)
        }
      })

      const formData = new FormData()
      formData.append('video', file)
      formData.append('venueId', venueId)
      formData.append('name', file.name.replace(/\.[^/.]+$/, ''))
      formData.append('durationMs', String(durationMs))

      const res = await fetch(`${API_BASE}/api/dooh/videos`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        throw new Error('Failed to upload video')
      }

      const data = await res.json()
      setVenueVideos(prev => [data.video, ...prev])
      setUploadProgress(100)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Add video to playlist
  const addToPlaylist = async (videoId: string) => {
    if (!screenId) return
    
    try {
      const res = await fetch(`${API_BASE}/api/dooh/screens/${screenId}/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })

      if (res.ok) {
        await loadData()
        // Notify viewport to refresh video playback
        window.dispatchEvent(new CustomEvent('dooh-playlist-updated'))
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Remove video from playlist
  const removeFromPlaylist = async (videoId: string) => {
    if (!screenId) return
    
    try {
      await fetch(`${API_BASE}/api/dooh/screens/${screenId}/playlist/${videoId}`, {
        method: 'DELETE',
      })
      setPlaylist(prev => prev.filter(item => item.videoId !== videoId))
      // Notify viewport to refresh video playback
      window.dispatchEvent(new CustomEvent('dooh-playlist-updated'))
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Delete video from venue
  const deleteVideo = async (videoId: string) => {
    if (!confirm('Delete this video? It will be removed from all playlists.')) return
    
    try {
      await fetch(`${API_BASE}/api/dooh/videos/${videoId}`, {
        method: 'DELETE',
      })
      setVenueVideos(prev => prev.filter(v => v.id !== videoId))
      setPlaylist(prev => prev.filter(item => item.videoId !== videoId))
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Update playlist order
  const moveItem = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= playlist.length) return

    const newPlaylist = [...playlist]
    const [item] = newPlaylist.splice(index, 1)
    newPlaylist.splice(newIndex, 0, item)

    // Update order indices
    const items = newPlaylist.map((item, i) => ({
      videoId: item.videoId,
      orderIndex: i,
      enabled: item.enabled,
    }))

    setPlaylist(newPlaylist.map((item, i) => ({ ...item, orderIndex: i })))

    try {
      await fetch(`${API_BASE}/api/dooh/screens/${screenId}/playlist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
    } catch (err: any) {
      setError(err.message)
      loadData() // Revert on error
    }
  }

  // Format duration
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Get videos not in playlist
  const availableVideos = venueVideos.filter(
    v => !playlist.some(p => p.videoId === v.id)
  )

  // Calculate total playlist duration
  const totalDurationMs = playlist.reduce((sum, item) => sum + (item.video?.durationMs || 0), 0)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-500 border-t-transparent mr-2" />
        Loading playlist...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Current Playlist */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-white flex items-center gap-2">
            <Film className="w-4 h-4 text-purple-400" />
            Screen Playlist
          </h4>
          {playlist.length > 0 && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Total: {formatDuration(totalDurationMs)}
            </span>
          )}
        </div>

        {playlist.length === 0 ? (
          <div className="text-center py-6 bg-gray-700/30 rounded border border-dashed border-gray-600">
            <Film className="w-8 h-8 mx-auto text-gray-500 mb-2" />
            <p className="text-sm text-gray-400">No videos in playlist</p>
            <p className="text-xs text-gray-500">Add videos from the library below</p>
          </div>
        ) : (
          <div className="space-y-1">
            {playlist.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 bg-gray-700/50 rounded border border-gray-600 group"
              >
                <GripVertical className="w-4 h-4 text-gray-500 cursor-grab" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{item.video?.name || 'Unknown'}</p>
                  <p className="text-xs text-gray-400">
                    {formatDuration(item.video?.durationMs || 0)}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => moveItem(index, 'up')}
                    disabled={index === 0}
                    className="p-1 hover:bg-gray-600 rounded disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveItem(index, 'down')}
                    disabled={index === playlist.length - 1}
                    className="p-1 hover:bg-gray-600 rounded disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeFromPlaylist(item.videoId)}
                    className="p-1 hover:bg-red-600/50 rounded text-red-400"
                    title="Remove from playlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Video Library */}
      <div className="border-t border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-white">Video Library</h4>
          <label className="flex items-center gap-1 px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs text-white cursor-pointer">
            <Upload className="w-3 h-3" />
            Upload
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/ogg,video/quicktime"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </div>

        {isUploading && (
          <div className="mb-2 p-2 bg-gray-700/50 rounded">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-500 border-t-transparent" />
              Uploading... {uploadProgress}%
            </div>
            <div className="mt-1 h-1 bg-gray-600 rounded overflow-hidden">
              <div 
                className="h-full bg-purple-500 transition-all" 
                style={{ width: `${uploadProgress}%` }} 
              />
            </div>
          </div>
        )}

        {venueVideos.length === 0 ? (
          <div className="text-center py-4 text-gray-400 text-sm">
            No videos uploaded yet
          </div>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {venueVideos.map(video => {
              const inPlaylist = playlist.some(p => p.videoId === video.id)
              return (
                <div
                  key={video.id}
                  className={`flex items-center gap-2 p-2 rounded border ${
                    inPlaylist 
                      ? 'bg-purple-900/20 border-purple-700/50' 
                      : 'bg-gray-700/30 border-gray-600 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="w-8 h-8 bg-gray-600 rounded flex items-center justify-center">
                    <Film className="w-4 h-4 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{video.name}</p>
                    <p className="text-xs text-gray-400">
                      {formatDuration(video.durationMs)} • {video.mimeType?.split('/')[1]?.toUpperCase() || 'VIDEO'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {inPlaylist ? (
                      <span className="flex items-center gap-1 text-xs text-purple-400">
                        <CheckCircle className="w-3 h-3" />
                        In playlist
                      </span>
                    ) : (
                      <button
                        onClick={() => addToPlaylist(video.id)}
                        className="p-1 hover:bg-purple-600/50 rounded text-purple-400"
                        title="Add to playlist"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteVideo(video.id)}
                      className="p-1 hover:bg-red-600/50 rounded text-red-400"
                      title="Delete video"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Playback Info */}
      {playlist.length > 0 && (
        <div className="border-t border-gray-700 pt-3">
          <p className="text-xs text-gray-400">
            Videos will play in order and loop continuously. 
            Proof-of-play is recorded for each video play event.
          </p>
        </div>
      )}
    </div>
  )
}
