import { API_BASE } from '../../../config/api'
import type { BenchmarkArtifact } from '../types'

interface Props {
  runId: string
  artifacts: BenchmarkArtifact[]
  selectedImage: string | null
  onSelectImage: (name: string | null) => void
}

export default function ArtifactPanel({ runId, artifacts, selectedImage, onSelectImage }: Props) {
  const images = artifacts.filter((a) => a.is_image)
  const jsons = artifacts.filter((a) => a.is_json)

  if (!artifacts.length) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-700 rounded-xl">
        No artifacts yet — benchmark still running or spatial stage skipped.
      </div>
    )
  }

  const imgName = selectedImage || images[0]?.name
  const imgUrl = imgName
    ? `${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(imgName)}`
    : null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 rounded-xl border border-gray-700 bg-gray-900/50 overflow-hidden min-h-[280px] flex items-center justify-center">
        {imgUrl ? (
          <img src={imgUrl} alt={imgName!} className="max-w-full max-h-[420px] object-contain" />
        ) : (
          <span className="text-gray-500 text-sm">No PNG artifacts</span>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Maps & plots</p>
        {images.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={() => onSelectImage(a.name)}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono border transition-colors ${
              imgName === a.name
                ? 'border-amber-500/60 bg-amber-950/30 text-amber-100'
                : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            {a.name}
          </button>
        ))}
        {jsons.length > 0 && (
          <>
            <p className="text-xs text-gray-500 uppercase tracking-wide pt-2">Data files</p>
            {jsons.map((a) => (
              <a
                key={a.name}
                href={`${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(a.name)}`}
                target="_blank"
                rel="noreferrer"
                className="block px-3 py-2 rounded-lg text-xs font-mono border border-gray-700 bg-gray-800/50 text-blue-400 hover:text-blue-300"
              >
                {a.name}
              </a>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
