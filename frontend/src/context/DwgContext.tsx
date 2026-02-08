import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface DwgContextType {
  dwgLayoutId: string | null
  setDwgLayoutId: (id: string | null) => void
  isDwgMode: boolean
}

const DwgContext = createContext<DwgContextType>({
  dwgLayoutId: null,
  setDwgLayoutId: () => {},
  isDwgMode: false,
})

export function DwgProvider({ children }: { children: ReactNode }) {
  const [dwgLayoutId, setDwgLayoutId] = useState<string | null>(() => {
    const stored = localStorage.getItem('venueDwg-selectedLayout') || null
    console.log(`[DwgContext] Initial dwgLayoutId from localStorage: ${stored}`)
    return stored
  })

  // Persist to localStorage
  useEffect(() => {
    if (dwgLayoutId) {
      localStorage.setItem('venueDwg-selectedLayout', dwgLayoutId)
    } else {
      localStorage.removeItem('venueDwg-selectedLayout')
    }
  }, [dwgLayoutId])

  // Listen for DWG layout selection events
  useEffect(() => {
    const handleDwgLayoutSelected = (e: CustomEvent) => {
      console.log(`[DwgContext] Received dwgLayoutSelected event, layoutId: ${e.detail.layoutId}`)
      setDwgLayoutId(e.detail.layoutId || null)
    }
    
    window.addEventListener('dwgLayoutSelected', handleDwgLayoutSelected as EventListener)
    return () => {
      window.removeEventListener('dwgLayoutSelected', handleDwgLayoutSelected as EventListener)
    }
  }, [])

  return (
    <DwgContext.Provider value={{
      dwgLayoutId,
      setDwgLayoutId,
      isDwgMode: !!dwgLayoutId,
    }}>
      {children}
    </DwgContext.Provider>
  )
}

export function useDwg() {
  return useContext(DwgContext)
}
