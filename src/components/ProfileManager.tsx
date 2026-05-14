import { useState } from 'react'
import { useProfile } from '../context/ProfileContext'
import type { Profile } from '../types'
import { X, Check, Loader2, AlertCircle, Trash2 } from 'lucide-react'

const DICEBEAR_STYLES = [
  'adventurer', 'avataaars', 'bottts', 'fun-emoji',
  'lorelei', 'miniavs', 'personas', 'pixel-art',
  'big-smile', 'croodles', 'notionists', 'notionists-neutral',
  'open-peeps', 'shapes', 'thumbs',
]

interface ProfileManagerProps {
  onClose: () => void
  editProfile?: Profile | null
}

export default function ProfileManager({ onClose, editProfile }: ProfileManagerProps) {
  const { addProfile, updateProfile, deleteProfile, profiles, activeProfile } = useProfile()
  const [name, setName] = useState(editProfile?.name || '')
  const [isKid, setIsKid] = useState(editProfile?.is_kid || false)
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(editProfile?.avatar_url || undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isEditing = !!editProfile

  const handleAvatarSelect = (url: string) => {
    setAvatarUrl(url)
  }

  const generateAvatarUrl = (style: string, seed: string): string => {
    return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Escribe un nombre para el perfil')
      return
    }

    setSaving(true)
    setError('')

    try {
      if (isEditing && editProfile) {
        await updateProfile(editProfile.id, { name: name.trim(), avatar_url: avatarUrl, is_kid: isKid })
      } else {
        await addProfile(name.trim(), avatarUrl || null, isKid)
      }
      onClose()
    } catch (err) {
      setError('Error al guardar el perfil')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editProfile) return
    setDeleting(true)
    try {
      await deleteProfile(editProfile.id)
      onClose()
    } catch (err) {
      setError('Error al eliminar el perfil')
    } finally {
      setDeleting(false)
    }
  }

  const avatars = DICEBEAR_STYLES.flatMap(style =>
    [1, 2, 3].map(i => ({
      id: `${style}-${i}`,
      url: generateAvatarUrl(style, `${editProfile?.id || activeProfile?.id || 'new'}-${style}-${i}`),
    }))
  )

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={() => !saving && onClose()}></div>
      <div className="relative w-full max-w-lg glass-card rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="p-6 md:p-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl md:text-3xl font-black text-white tracking-tighter">
                {isEditing ? 'Editar Perfil' : 'Nuevo Perfil'}
              </h2>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mt-1">
                {isEditing ? 'Cambia el nombre o avatar' : 'Crea un perfil para alguien más'}
              </p>
            </div>
            <button onClick={onClose} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-all">
              <X size={20} />
            </button>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Nombre</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Nicolás"
                maxLength={30}
                className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-netflix-red/10 focus:border-netflix-red/30 transition-all duration-500 placeholder:text-slate-700"
                autoFocus
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 block">Avatar</label>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto no-scrollbar">
                {avatars.map((av) => (
                  <button
                    key={av.id}
                    onClick={() => handleAvatarSelect(av.url)}
                    className={`relative w-[calc(20%-0.5rem)] aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                      avatarUrl === av.url
                        ? 'border-netflix-red ring-2 ring-netflix-red/30'
                        : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <img src={av.url} alt="avatar" className="w-full h-full object-cover bg-zinc-800" />
                    {avatarUrl === av.url && (
                      <div className="absolute inset-0 bg-netflix-red/20 flex items-center justify-center">
                        <Check size={16} className="text-white" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between bg-white/5 rounded-2xl px-5 py-4">
              <div>
                <p className="text-sm font-bold text-white">Modo niños</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                  Solo películas aptas para menores
                </p>
              </div>
              <button
                onClick={() => setIsKid(!isKid)}
                className={`relative w-12 h-6 rounded-full transition-all ${
                  isKid ? 'bg-green-500' : 'bg-white/20'
                }`}
              >
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                  isKid ? 'left-6' : 'left-0.5'
                }`} />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest">
                <AlertCircle size={12} />
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              {isEditing && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-4 bg-red-500/10 text-red-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                onClick={onClose}
                className="flex-1 px-4 py-4 bg-white/5 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex-1 px-4 py-4 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-200 transition-all shadow-xl flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
                {saving ? 'Guardando' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDeleteConfirm && editProfile && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/90" onClick={() => setShowDeleteConfirm(false)}></div>
          <div className="relative w-full max-w-sm glass-card rounded-[2.5rem] border border-white/10 shadow-2xl p-8 text-center">
            <Trash2 size={32} className="text-red-400 mx-auto mb-4" />
            <h3 className="text-xl font-black text-white mb-2">Eliminar perfil</h3>
            <p className="text-sm text-slate-400 mb-6">
              Se eliminará el perfil de <strong className="text-white">{editProfile.name}</strong> y todo su progreso.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-4 bg-white/5 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-4 bg-red-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-all flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
