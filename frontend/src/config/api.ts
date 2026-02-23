/**
 * Centralized API configuration
 * 
 * In development: Uses http://localhost:3001
 * In production: Uses relative URLs (empty string) so requests go to same origin
 * 
 * The VITE_API_URL env var should be:
 * - Not set or 'http://localhost:3001' for local development
 * - Empty string '' for production (relative URLs via Caddy proxy)
 */

const getApiBase = (): string => {
  const envUrl = import.meta.env.VITE_API_URL
  
  // If VITE_API_URL is explicitly set (including empty string), use it
  if (envUrl !== undefined) {
    return envUrl
  }
  
  // Default fallback for local development
  return 'http://localhost:3001'
}

export const API_BASE = getApiBase()

// WebSocket base URL derived from API_BASE
export const WS_BASE = API_BASE 
  ? API_BASE.replace('http://', 'ws://').replace('https://', 'wss://')
  : `ws://${window.location.host}`
