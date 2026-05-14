import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '../api'
import type { Profile } from '../types'

interface ProfileContextValue {
  profiles: Profile[]
  activeProfile: Profile | null
  loading: boolean
  selectProfile: (profile: Profile) => void
  addProfile: (name: string, avatar_url: string | null, is_kid: boolean) => Promise<Profile | null>
  updateProfile: (id: string, data: { name?: string; avatar_url?: string; is_kid?: boolean }) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  refreshProfiles: () => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProfiles = useCallback(async () => {
    try {
      const data = await api.getProfiles()
      setProfiles(data || [])
    } catch (err) {
      console.error('[Profile] Error loading profiles:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshProfiles()
  }, [refreshProfiles])

  useEffect(() => {
    const stored = localStorage.getItem('cinevault_active_profile')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setActiveProfile(parsed)
      } catch (e) {
        localStorage.removeItem('cinevault_active_profile')
      }
    }
  }, [])

  const selectProfile = (profile: Profile) => {
    setActiveProfile(profile)
    localStorage.setItem('cinevault_active_profile', JSON.stringify(profile))
  }

  const addProfile = async (name: string, avatar_url: string | null, is_kid: boolean): Promise<Profile | null> => {
    const profile = await api.createProfile(name, avatar_url, is_kid)
    if (profile) {
      setProfiles(prev => [...prev, profile as Profile])
    }
    return profile as Profile | null
  }

  const updateProfile = async (id: string, data: { name?: string; avatar_url?: string; is_kid?: boolean }) => {
    await api.updateProfile(id, data)
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, ...data } : p))
    if (activeProfile?.id === id) {
      const updated = { ...activeProfile, ...data }
      setActiveProfile(updated)
      localStorage.setItem('cinevault_active_profile', JSON.stringify(updated))
    }
  }

  const deleteProfile = async (id: string) => {
    await api.deleteProfile(id)
    setProfiles(prev => prev.filter(p => p.id !== id))
    if (activeProfile?.id === id) {
      setActiveProfile(null)
      localStorage.removeItem('cinevault_active_profile')
    }
  }

  return (
    <ProfileContext.Provider value={{
      profiles,
      activeProfile,
      loading,
      selectProfile,
      addProfile,
      updateProfile,
      deleteProfile,
      refreshProfiles,
    }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext)
  if (!context) {
    throw new Error('useProfile must be used within ProfileProvider')
  }
  return context
}
