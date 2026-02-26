import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { API_BASE } from '../config/api'

interface User {
  id: string
  email: string
  name: string
  picture: string
  role: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean
  isSuperadmin: boolean
  login: (googleCredential: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,
  isSuperadmin: false,
  login: async () => {},
  logout: () => {},
})

export const useAuth = () => useContext(AuthContext)

const TOKEN_KEY = 'hyperspace_token'
const USER_KEY = 'hyperspace_user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY)
    const savedUser = localStorage.getItem(USER_KEY)

    if (savedToken && savedUser) {
      try {
        const parsed = JSON.parse(savedUser)
        setToken(savedToken)
        setUser(parsed)

        // Validate token with backend
        fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        })
          .then((res) => {
            if (!res.ok) {
              // Token expired or invalid
              localStorage.removeItem(TOKEN_KEY)
              localStorage.removeItem(USER_KEY)
              setToken(null)
              setUser(null)
            } else {
              return res.json()
            }
          })
          .then((data) => {
            if (data?.user) {
              setUser(data.user)
              localStorage.setItem(USER_KEY, JSON.stringify(data.user))
            }
          })
          .catch(() => {
            // Network error, keep cached session
          })
          .finally(() => setIsLoading(false))
      } catch {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        setIsLoading(false)
      }
    } else {
      setIsLoading(false)
    }
  }, [])

  const login = useCallback(async (googleCredential: string) => {
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: googleCredential }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }))
      throw new Error(err.error || 'Login failed')
    }

    const data = await res.json()
    setToken(data.token)
    setUser(data.user)
    localStorage.setItem(TOKEN_KEY, data.token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user && !!token,
        isSuperadmin: user?.role === 'superadmin',
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
