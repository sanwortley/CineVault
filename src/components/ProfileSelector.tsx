import { useState } from 'react'
import { useProfile } from '../context/ProfileContext'
import type { Profile } from '../types'
import ProfileManager from './ProfileManager'
import { Plus } from 'lucide-react'

interface ProfileSelectorProps {
  onSelect: () => void
}

export default function ProfileSelector({ onSelect }: ProfileSelectorProps) {
  const { profiles, loading, selectProfile } = useProfile()
  const [showManager, setShowManager] = useState(false)

  const handleSelect = (profile: Profile) => {
    selectProfile(profile)
    onSelect()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-netflix-red" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-8 select-none">
      <div className="mb-16 text-center">
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter">
          CineVault
        </h1>
        <p className="text-slate-500 text-sm font-bold uppercase tracking-[0.3em] mt-3">
          ¿Quién está viendo?
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-6 md:gap-10 max-w-3xl">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            onClick={() => handleSelect(profile)}
            className="group flex flex-col items-center gap-3 md:gap-4 transition-all duration-300 hover:scale-105 active:scale-95"
          >
            <div className="relative w-24 h-24 md:w-32 md:h-32 rounded-2xl md:rounded-3xl overflow-hidden border-2 border-transparent group-hover:border-netflix-red/50 group-focus-visible:border-netflix-red transition-all duration-300 shadow-xl">
              <img
                src={profile.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${profile.name}`}
                alt={profile.name}
                className="w-full h-full object-cover bg-zinc-800"
              />
              {profile.is_kid && (
                <div className="absolute top-2 right-2 bg-green-500 text-black text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider">
                  KIDS
                </div>
              )}
            </div>
            <span className="text-sm md:text-base font-bold text-slate-400 group-hover:text-white transition-colors">
              {profile.name}
            </span>
          </button>
        ))}

        {profiles.length < 5 && (
          <button
            onClick={() => setShowManager(true)}
            className="group flex flex-col items-center gap-3 md:gap-4 transition-all duration-300 hover:scale-105 active:scale-95"
          >
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-2xl md:rounded-3xl border-2 border-dashed border-slate-600 flex items-center justify-center group-hover:border-white/50 transition-all duration-300 bg-white/[0.02]">
              <Plus size={40} className="text-slate-500 group-hover:text-white transition-colors" strokeWidth={2} />
            </div>
            <span className="text-sm md:text-base font-bold text-slate-500 group-hover:text-white transition-colors">
              Agregar Perfil
            </span>
          </button>
        )}
      </div>

      {showManager && (
        <ProfileManager
          onClose={() => setShowManager(false)}
        />
      )}
    </div>
  )
}
