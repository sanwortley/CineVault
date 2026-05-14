import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { supabase } from '../supabase'
import { api } from '../api'

interface UserData {
  id: string
  email: string
  access_token?: string
  refresh_token?: string
  user_metadata?: Record<string, unknown>
}

interface AuthContextValue {
  user: UserData | null
  loading: boolean
  login: (email: string, password: string) => Promise<UserData>
  logout: () => Promise<void>
  isAdmin: () => boolean
  isAuthenticated: boolean
  getUserProgress: () => Promise<unknown[]>
  saveUserProgress: (movieId: number, watchedDuration: number) => Promise<void>
  hideMovieFromContinue: (movieId: number) => Promise<void>
  getUserMylist: () => Promise<unknown[]>
  addToMylist: (movieId: number) => Promise<void>
  removeFromMylist: (movieId: number) => Promise<void>
  isInMylist: (movieId: number) => Promise<boolean>
  refreshSession: () => Promise<UserData | null>
  changePassword: (newPassword: string) => Promise<void>
  updateUserMetadata: (metadata: Record<string, unknown>) => Promise<unknown>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(
    localStorage.getItem('cinevault_session_id')
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth()

    const handleSessionExpired = () => {
      console.warn('[Auth] Session expired event received. Logging out...')
      logout()
      window.location.href = '/login?expired=true'
    }

    window.addEventListener('session-expired', handleSessionExpired)
    return () =>
      window.removeEventListener('session-expired', handleSessionExpired)
  }, [])

  useEffect(() => {
    if (!user || !sessionId) return

    const performCheck = async () => {
      try {
        await api.checkSession()
      } catch (err) {
        const error = err as Error
        console.warn('[Heartbeat] Session check failed:', error.message)
      }
    }

    const interval = setInterval(performCheck, 30000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        performCheck()
      }
    }

    window.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(interval)
      window.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user, sessionId])

  const checkAuth = async () => {
    try {
      const stored = localStorage.getItem('cinevault_user')
      if (stored) {
        const userData: UserData = JSON.parse(stored)
        setUser(userData)
      }
    } catch (e) {
      console.error('[Auth] Error checking auth:', e)
    } finally {
      setLoading(false)
    }
  }

  const login = async (email: string, password: string): Promise<UserData> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      throw new Error(error.message || 'Login failed')
    }

    const userData: UserData = {
      id: data.user.id,
      email: data.user.email!,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user_metadata: data.user.user_metadata || {},
    }

    try {
      const { sessionId } = await api.registerSession(
        userData.id,
        userData.email
      ) as { sessionId: string }
      localStorage.setItem('cinevault_session_id', sessionId)
      setSessionId(sessionId)
    } catch (err) {
      const error = err as Error
      console.error('[Auth] Failed to register backend session:', error)
    }

    localStorage.setItem('cinevault_user', JSON.stringify(userData))
    setUser(userData)
    return userData
  }

  const logout = async () => {
    const stored = localStorage.getItem('cinevault_user')
    if (stored) {
      try {
        await supabase.auth.signOut()
      } catch (_e) {
        // ignore
      }
    }
    localStorage.removeItem('cinevault_user')
    localStorage.removeItem('cinevault_session_id')
    setUser(null)
    setSessionId(null)
  }

  const isAdmin = (): boolean => {
    const adminEmail = import.meta.env.VITE_ADMIN_EMAIL?.trim().toLowerCase()
    const userEmail = user?.email?.trim().toLowerCase()
    const ownerEmail = 'sanwortley@gmail.com'

    return !!userEmail && (userEmail === ownerEmail || (!!adminEmail && userEmail === adminEmail))
  }

  const refreshSession = async (): Promise<UserData | null> => {
    const stored = localStorage.getItem('cinevault_user')
    if (!stored) return null

    try {
      const userData: UserData = JSON.parse(stored)
      if (!userData.refresh_token) return null

      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: userData.refresh_token,
      })

      if (error) {
        console.warn('[Auth] Token refresh failed:', error.message)

        if (
          error.message.includes('Invalid Refresh Token') ||
          error.message.includes('Refresh Token Not Found') ||
          error.message.includes('invalid_grant')
        ) {
          localStorage.removeItem('cinevault_user')
          setUser(null)
          window.location.href = '/login?expired=true'
        }
        return null
      }

      if (!data.user || !data.session) {
        localStorage.removeItem('cinevault_user')
        setUser(null)
        window.location.href = '/login?expired=true'
        return null
      }

      const newUserData: UserData = {
        id: data.user.id,
        email: data.user.email!,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user_metadata: data.user.user_metadata || {},
      }

      localStorage.setItem('cinevault_user', JSON.stringify(newUserData))
      setUser(newUserData)
      return newUserData
    } catch (e) {
      console.error('[Auth] Refresh error:', e)
      return null
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem('cinevault_user')
    if (stored) {
      try {
        const userData: UserData = JSON.parse(stored)
        if (userData.refresh_token && !userData.access_token) {
          refreshSession()
        }
      } catch (_e) {
        // ignore
      }
    }
  }, [])

  const getActiveProfileId = (): string | undefined => {
    try {
      const stored = localStorage.getItem('cinevault_active_profile')
      if (stored) {
        const profile = JSON.parse(stored)
        return profile.id || undefined
      }
    } catch {}
    return undefined
  }

  const getUserProgress = async (): Promise<unknown[]> => {
    if (!user?.access_token) return []
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
    const profileId = getActiveProfileId()
    const profileFilter = profileId ? `&profile_id=eq.${profileId}` : ''
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${user.id}${profileFilter}`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${user.access_token}`,
          },
        }
      )

      if (res.status === 401 || res.status === 403) {
        const refreshed = await refreshSession()
        if (!refreshed) return []
        const newRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${refreshed.id}${profileFilter}`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${refreshed.access_token}`,
            },
          }
        )
        return (await newRes.json()) || []
      }

      return (await res.json()) || []
    } catch (e) {
      console.error('[Auth] Get progress error:', e)
      return []
    }
  }

  const saveUserProgress = async (movieId: number, watchedDuration: number) => {
    if (!user?.access_token) return
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
    const profileId = getActiveProfileId()
    const profileFilter = profileId
      ? `&profile_id=eq.${profileId}`
      : '&profile_id=is.null'

    const save = async (uid: string, token: string) => {
      await fetch(
        `${SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${uid}&movie_id=eq.${movieId}${profileFilter}`,
        {
          method: 'DELETE',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      )
      const body: Record<string, unknown> = {
        user_id: uid,
        movie_id: movieId,
        watched_duration: watchedDuration,
        updated_at: new Date().toISOString(),
      }
      if (profileId) body.profile_id = profileId
      await fetch(`${SUPABASE_URL}/rest/v1/user_movie_progress`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    }

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${user.id}&movie_id=eq.${movieId}${profileFilter}`,
        { method: 'DELETE', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${user.access_token}`, 'Content-Type': 'application/json' } }
      )

      const body: Record<string, unknown> = {
        user_id: user.id,
        movie_id: movieId,
        watched_duration: watchedDuration,
        updated_at: new Date().toISOString(),
      }
      if (profileId) body.profile_id = profileId
      await fetch(`${SUPABASE_URL}/rest/v1/user_movie_progress`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${user.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (res.status === 401 || res.status === 403) {
        const refreshed = await refreshSession()
        if (!refreshed) return
        await save(refreshed.id, refreshed.access_token)
      }
    } catch (_e) {
      // ignore
    }
  }

  const hideMovieFromContinue = async (movieId: number) => {
    if (!user?.access_token) return
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
    const profileId = getActiveProfileId()
    const profileFilter = profileId ? `&profile_id=eq.${profileId}` : ''
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${user.id}&movie_id=eq.${movieId}${profileFilter}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${user.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ is_hidden: true }),
        }
      )

      if (res.status === 401 || res.status === 403) {
        const refreshed = await refreshSession()
        if (!refreshed) return

        await fetch(
          `${SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${refreshed.id}&movie_id=eq.${movieId}${profileFilter}`,
          {
            method: 'PATCH',
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${refreshed.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ is_hidden: true }),
          }
        )
      }
    } catch (e) {
      console.error('[Auth] Hide progress error:', e)
    }
  }

  const getUserMylist = async (): Promise<unknown[]> => {
    if (!user?.access_token) return []
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${user.id}`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${user.access_token}`,
          },
        }
      )

      if (res.status === 401 || res.status === 403) {
        const refreshed = await refreshSession()
        if (!refreshed) return []
        const newRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${refreshed.id}`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${refreshed.access_token}`,
            },
          }
        )
        return (await newRes.json()) || []
      }

      return (await res.json()) || []
    } catch (_e) {
      return []
    }
  }

  const addToMylist = async (movieId: number) => {
    if (!user?.access_token) return
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_mylist`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${user.access_token}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates',
          },
          body: JSON.stringify({ user_id: user.id, movie_id: movieId }),
        }
      )

      if (res.status === 401 || res.status === 403) {
        const refreshed = await refreshSession()
        if (!refreshed) return
        await fetch(`${SUPABASE_URL}/rest/v1/user_mylist`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${refreshed.access_token}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates',
          },
          body: JSON.stringify({ user_id: refreshed.id, movie_id: movieId }),
        })
      }
    } catch (_e) {
      // ignore
    }
  }

  const removeFromMylist = async (movieId: number) => {
    if (!user?.access_token) return
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${user.id}&movie_id=eq.${movieId}`,
        {
          method: 'DELETE',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${user.access_token}`,
          },
        }
      )

      if (res.status === 401 || res.status === 403) {
        const refreshed = await refreshSession()
        if (!refreshed) return
        await fetch(
          `${SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${refreshed.id}&movie_id=eq.${movieId}`,
          {
            method: 'DELETE',
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${refreshed.access_token}`,
            },
          }
        )
      }
    } catch (_e) {
      // ignore
    }
  }

  const isInMylist = async (movieId: number): Promise<boolean> => {
    if (!user?.access_token) return false
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${user.id}&movie_id=eq.${movieId}&select=id`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${user.access_token}`,
          },
        }
      )

      if (res.status === 401 || res.status === 403) {
        const refreshed = await refreshSession()
        if (!refreshed) return false
        const newRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${refreshed.id}&movie_id=eq.${movieId}&select=id`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${refreshed.access_token}`,
            },
          }
        )
        const data = await newRes.json()
        return data.length > 0
      }

      const data = await res.json()
      return data.length > 0
    } catch (_e) {
      return false
    }
  }

  const changePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    if (error) throw error
  }

  const updateUserMetadata = async (metadata: Record<string, unknown>) => {
    try {
      await refreshSession()

      const { data, error } = await supabase.auth.updateUser({
        data: metadata,
      })

      if (error) {
        if (
          error.message.includes('session missing') ||
          error.message.includes('not logged in')
        ) {
          throw new Error(
            'Tu sesión ha expirado. Por favor, inicia sesión de nuevo.'
          )
        }
        throw error
      }

      const stored = localStorage.getItem('cinevault_user')
      if (stored) {
        const userData: UserData = JSON.parse(stored)
        const newUserData: UserData = {
          ...userData,
          user_metadata: data.user.user_metadata || {},
        }
        localStorage.setItem('cinevault_user', JSON.stringify(newUserData))
        setUser(newUserData)
      }
      return data.user
    } catch (err) {
      console.error('[Auth] Error al actualizar metadatos:', err)
      throw err
    }
  }

  const value: AuthContextValue = {
    user,
    loading,
    login,
    logout,
    isAdmin,
    isAuthenticated: !!user,
    getUserProgress,
    saveUserProgress,
    hideMovieFromContinue,
    getUserMylist,
    addToMylist,
    removeFromMylist,
    isInMylist,
    refreshSession,
    changePassword,
    updateUserMetadata,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
