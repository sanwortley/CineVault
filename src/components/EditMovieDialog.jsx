import React, { useState } from 'react';
import { X, Save, RefreshCw, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { api } from '../api';

export default function EditMovieDialog({ movie, onClose, onUpdate }) {
    const [formData, setFormData] = useState({
        official_title: movie.official_title || '',
        detected_year: movie.detected_year || '',
        overview: movie.overview || '',
        poster_url: movie.poster_url || '',
        genres: movie.genres || ''
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isReidentifying, setIsReidentifying] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');
        setSuccess('');
        try {
            await api.updateMovie(movie.id, formData);
            setSuccess('¡Datos guardados con éxito!');
            if (onUpdate) onUpdate();
            setTimeout(onClose, 1500);
        } catch (err) {
            setError('Error al guardar: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleReidentify = async () => {
        if (!formData.official_title) return setError('Escribe un título para buscar');
        setIsReidentifying(true);
        setError('');
        setSuccess('');
        try {
            const res = await api.reIdentifyMovie(movie.id, formData.official_title, formData.detected_year);
            if (res.success) {
                setFormData({
                    official_title: res.details.official_title,
                    detected_year: res.details.release_date ? res.details.release_date.substring(0, 4) : '',
                    overview: res.details.overview,
                    poster_url: res.details.poster_url,
                    genres: res.details.genres
                });
                setSuccess('¡Película re-identificada correctamente!');
                if (onUpdate) onUpdate();
            }
        } catch (err) {
            setError('No se encontró match: ' + err.message);
        } finally {
            setIsReidentifying(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-12 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-black/90 backdrop-blur-xl" onClick={onClose}></div>
            
            <div className="relative w-full max-w-2xl glass-card rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                <header className="p-8 border-b border-white/5 flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic">Editar Información</h2>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">ID Película: {movie.id}</p>
                    </div>
                    <button onClick={onClose} className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all text-slate-400 hover:text-white">
                        <X size={20} />
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
                    {error && (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 animate-in slide-in-from-top-2">
                            <AlertCircle size={18} />
                            <span className="text-xs font-bold uppercase tracking-widest">{error}</span>
                        </div>
                    )}
                    {success && (
                        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center gap-3 text-green-400 animate-in slide-in-from-top-2">
                            <CheckCircle2 size={18} />
                            <span className="text-xs font-bold uppercase tracking-widest">{success}</span>
                        </div>
                    )}

                    <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2 space-y-6">
                            <div className="flex flex-col gap-3">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-3">Título Sugerido / Oficial</label>
                                <div className="flex flex-col md:flex-row gap-3">
                                    <input 
                                        type="text" 
                                        name="official_title"
                                        value={formData.official_title}
                                        onChange={handleChange}
                                        className="flex-1 bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm font-bold focus:outline-none focus:border-netflix-red transition-all"
                                        placeholder="Ej: First Blood"
                                    />
                                    <button 
                                        type="button"
                                        onClick={handleReidentify}
                                        disabled={isReidentifying}
                                        className="w-full md:w-auto px-6 py-4 bg-netflix-red text-white rounded-2xl hover:bg-white hover:text-netflix-red transition-all flex items-center justify-center gap-2 group shadow-lg active:scale-95 disabled:opacity-50"
                                        title="Buscar en TMDB con este título"
                                    >
                                        {isReidentifying ? <RefreshCw className="animate-spin" size={18} /> : <Search size={18} className="group-hover:scale-110 transition-transform" />}
                                        <span className="text-[10px] font-black uppercase tracking-widest">Re-Identificar</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-3">Año</label>
                            <input 
                                type="text"
                                name="detected_year"
                                value={formData.detected_year}
                                onChange={handleChange}
                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm font-bold focus:outline-none focus:border-netflix-red transition-all"
                                placeholder="2024"
                            />
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-3">Géneros</label>
                            <input 
                                type="text"
                                name="genres"
                                value={formData.genres}
                                onChange={handleChange}
                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm font-bold focus:outline-none focus:border-netflix-red transition-all"
                                placeholder="Acción, Drama"
                            />
                        </div>

                        <div className="md:col-span-2 space-y-3">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-3">URL del Poster</label>
                            <input 
                                type="text"
                                name="poster_url"
                                value={formData.poster_url}
                                onChange={handleChange}
                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm font-bold focus:outline-none focus:border-netflix-red transition-all italic text-slate-500"
                                placeholder="https://..."
                            />
                        </div>

                        <div className="md:col-span-2 space-y-3">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-3">Sinopsis / Overview</label>
                            <textarea 
                                name="overview"
                                value={formData.overview}
                                onChange={handleChange}
                                rows="4"
                                className="w-full bg-black/40 border border-white/10 rounded-3xl px-6 py-4 text-sm font-medium leading-relaxed focus:outline-none focus:border-netflix-red transition-all resize-none no-scrollbar"
                                placeholder="Escribe aquí la sinopsis..."
                            ></textarea>
                        </div>
                    </form>
                </div>

                <footer className="p-6 md:p-8 border-t border-white/5 bg-white/[0.02] flex flex-col md:flex-row gap-3 md:gap-4">
                    <button 
                        onClick={onClose}
                        className="w-full md:flex-1 py-4 md:py-5 bg-white/5 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full md:flex-1 py-4 md:py-5 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-neutral-200 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                        {isSaving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} strokeWidth={2.5} />}
                        <span>{isSaving ? 'Guardando...' : 'Guardar Cambios'}</span>
                    </button>
                </footer>
            </div>
        </div>
    );
}
