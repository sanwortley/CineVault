import React from 'react';
import { X, Star, Calendar, Clock, User, Users, Play, Cloud, Plus, Check, Trash2, Edit3 } from 'lucide-react';
import { useUploadQueue } from '../context/UploadQueueContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import EditMovieDialog from './EditMovieDialog';
import { detectVersionInfo } from '../utils/movieUtils';

function MovieDetailsModal({ movie, onClose, onPlay, myList = [], toggleMyList }) {
    if (!movie) return null;

    const {
        official_title,
        detected_title,
        poster_url,
        backdrop_url,
        overview,
        genres,
        runtime,
        director,
        cast,
        rating,
        release_date,
        drive_file_id
    } = movie;

    const { isAdmin } = useAuth();
    const [isDeleting, setIsDeleting] = React.useState(false);
    const [isEditing, setIsEditing] = React.useState(false);
    
    // Versions handling
    const versions = movie.versions || [movie];
    const [selectedVersion, setSelectedVersion] = React.useState(movie);
    
    // Update selected version if the primary movie changes
    React.useEffect(() => {
        setSelectedVersion(movie);
    }, [movie]);

    const title = official_title || detected_title;

    const { queue, addToQueue } = useUploadQueue();
    const isInQueue = queue.some(item => String(item.id) === String(selectedVersion.id));


    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-300">
            {/* Backdrop Blur Overlay */}
            <div 
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
                onClick={onClose}
            ></div>

            {/* Modal Content */}
            <div className="relative w-full md:max-w-5xl h-full md:h-auto md:max-h-[90vh] glass-card overflow-hidden shadow-2xl rounded-none md:rounded-3xl flex flex-col md:flex-row animate-in slide-in-from-bottom-8 duration-500">
                {/* Close Button */}
                <button 
                    onClick={onClose}
                    className="absolute top-6 right-6 z-10 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"
                >
                    <X size={24} />
                </button>

                {/* Left Side: Poster (Hidden on small mobile) */}
                <div className="hidden md:block w-1/3 relative group">
                    {poster_url ? (
                        <img 
                            src={poster_url} 
                            alt={title} 
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full bg-slate-900 flex items-center justify-center">
                            <Calendar size={64} className="text-slate-700" />
                        </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/40"></div>
                </div>

                {/* Right Side: Details */}
                <div className="flex-1 overflow-y-auto bg-slate-950/40 p-6 md:p-12 pb-32 md:pb-12 text-white">
                    {/* Header Info */}
                    <div className="space-y-4 mb-8">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="px-3 py-1 bg-netflix-red/20 text-netflix-red text-xs font-bold tracking-widest rounded-full uppercase">
                                Película
                            </span>
                            <div className="flex items-center gap-1 text-yellow-500">
                                <Star size={16} fill="currentColor" />
                                <span className="text-sm font-bold">{rating ? rating.toFixed(1) : 'N/A'}</span>
                            </div>
                            {movie.rt_rating && (
                                <div className="flex items-center gap-2">
                                    <img src="https://www.rottentomatoes.com/assets/cas/images/favicon.ico" className="w-4 h-4" alt="RT" />
                                    <span className="text-sm font-bold text-white">{movie.rt_rating}</span>
                                </div>
                            )}
                            {movie.metascore && (
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 flex items-center justify-center text-[10px] font-black rounded-sm ${parseInt(movie.metascore) >= 60 ? 'bg-green-600' : parseInt(movie.metascore) >= 40 ? 'bg-yellow-500 text-black' : 'bg-red-600'}`}>
                                        {movie.metascore.replace('/100', '')}
                                    </div>
                                    <span className="text-[10px] font-black uppercase text-slate-400">Metascore</span>
                                </div>
                            )}
                        </div>
                        
                        <h1 className="text-4xl md:text-5xl font-black leading-tight tracking-tight">
                            {title}
                        </h1>

                        <div className="flex flex-wrap gap-6 text-sm text-slate-400 font-medium">
                            <div className="flex items-center gap-2">
                                <Calendar size={16} className="text-netflix-red" />
                                <span>{release_date ? new Date(release_date).getFullYear() : 'Año desconocido'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Clock size={16} className="text-netflix-red" />
                                <span>{runtime ? `${runtime} min` : 'N/A'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] border border-slate-700 px-2 py-0.5 rounded uppercase tracking-tighter">HD</span>
                            </div>
                        </div>
                    </div>

                    {/* Overview */}
                    <div className="mb-10">
                        <h3 className="text-xs uppercase font-black tracking-[0.2em] text-netflix-red/80 mb-4">Sinopsis</h3>
                        <p className="text-slate-300 leading-relaxed text-lg italic">
                            {overview || 'No hay sinopsis disponible para esta película.'}
                        </p>
                    </div>

                    {/* Meta Grid (Director & Cast) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 border-t border-white/5 pt-8">
                        <div>
                            <h3 className="text-xs uppercase font-black tracking-[0.2em] text-white/80 mb-4 flex items-center gap-2">
                                <User size={14} /> Director
                            </h3>
                            <p className="text-slate-100 font-bold text-lg">{director || 'Desconocido'}</p>
                        </div>
                        <div>
                            <h3 className="text-xs uppercase font-black tracking-[0.2em] text-white/80 mb-4 flex items-center gap-2">
                                <Users size={14} /> Reparto Principal
                            </h3>
                            <p className="text-slate-300 text-sm leading-relaxed">{cast || 'No disponible'}</p>
                        </div>
                    </div>

                    {/* Cloud Status Banner */}
                    {!drive_file_id && (
                        <div className="mb-6 p-4 rounded-xl bg-orange-500/10 border border-orange-500/20 flex gap-4 animate-in fade-in duration-500">
                            <Cloud size={24} className="text-orange-500 shrink-0 mt-0.5 animate-pulse" />
                            <div>
                                <p className="text-sm font-black text-orange-400 uppercase tracking-widest">Aún no disponible en la nube</p>
                                <p className="text-sm text-orange-300/80 mt-1">
                                    Esta película se encuentra en la cola de **CineVault** y todavía no se ha subido a Google Drive. 
                                    La reproducción remota podría fallar hasta que tu servidor local termine de procesarla.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Versions Selector */}
                    {versions.length > 1 && (
                        <div className="mb-10">
                            <h3 className="text-xs uppercase font-black tracking-[0.2em] text-white/80 mb-4">Versiones Disponibles</h3>
                            <div className="flex flex-wrap gap-3">
                                {versions.map((ver) => {
                                    const vInfo = detectVersionInfo(ver);
                                    const isSelected = String(ver.id) === String(selectedVersion.id);
                                    return (
                                        <button
                                            key={ver.id}
                                            onClick={() => setSelectedVersion(ver)}
                                            className={`px-5 py-3 rounded-xl border text-xs font-black uppercase tracking-widest transition-all ${
                                                isSelected 
                                                ? 'bg-netflix-red border-netflix-red text-white shadow-[0_0_20px_rgba(229,9,20,0.4)] scale-105' 
                                                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                                            }`}
                                        >
                                            {vInfo.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-4 md:gap-6">
                        {/* Primary Action */}
                        <button 
                            onClick={() => { onPlay(selectedVersion); onClose(); }}
                            className="w-full md:w-auto px-8 py-5 bg-white text-black rounded-[2rem] font-black flex items-center justify-center md:justify-start gap-3 hover:bg-zinc-200 transition-all duration-300 transform hover:scale-[1.02] active:scale-95 shadow-2xl shadow-white/5 group"
                        >
                            <Play size={24} fill="currentColor" className="group-hover:scale-110 transition-transform" /> 
                            <span className="text-lg md:text-xl">REPRODUCIR {versions.length > 1 ? detectVersionInfo(selectedVersion).lang : 'AHORA'}</span>
                        </button>

                        <div className="grid grid-cols-2 md:flex md:flex-wrap gap-3 md:gap-4">
                            <button 
                                onClick={() => toggleMyList(movie)}
                                className={`px-4 md:px-8 py-4 border rounded-2xl font-bold flex items-center justify-center gap-3 transition-all duration-300 transform hover:scale-105 active:scale-95 text-[10px] md:text-sm tracking-tighter md:tracking-normal ${myList.some(m => m.id === movie.id) ? 'bg-netflix-red border-netflix-red text-white' : 'bg-slate-800/50 text-white border-white/10 hover:bg-slate-800'}`}
                            >
                                {myList.some(m => m.id === movie.id) ? <Check size={18} strokeWidth={3} /> : <Plus size={18} strokeWidth={3} />}
                                <span>{myList.some(m => m.id === movie.id) ? 'EN MI LISTA' : 'MI LISTA'}</span>
                            </button>

                            {!drive_file_id && isAdmin() && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); if(!isInQueue) addToQueue(movie); onClose(); }}
                                    disabled={isInQueue}
                                    className={`px-4 md:px-8 py-4 bg-slate-800/50 text-white border border-white/10 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all duration-300 hover:bg-slate-800 hover:border-cyan-500/50 hover:text-cyan-400 transform hover:scale-105 active:scale-95 text-[10px] md:text-sm ${isInQueue ? 'opacity-70 animate-pulse text-cyan-400' : ''}`}
                                >
                                    <Cloud size={18} className="text-cyan-400" /> 
                                    <span>{isInQueue ? 'EN COLA...' : 'SUBIR'}</span>
                                </button>
                            )}
                            
                            {isAdmin() && (
                                <button 
                                    onClick={async () => {
                                        if (window.confirm(`¿Estás seguro de que quieres eliminar "${title}"?`)) {
                                            setIsDeleting(true);
                                            try {
                                                await api.deleteMovie(selectedVersion.id);
                                                window.dispatchEvent(new Event('library-updated'));
                                                onClose();
                                            } catch (err) {
                                                alert('Error al borrar: ' + err.message);
                                                setIsDeleting(false);
                                            }
                                        }
                                    }}
                                    disabled={isDeleting}
                                    className="px-4 md:px-8 py-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all duration-300 hover:bg-red-500 hover:text-white transform hover:scale-105 active:scale-95 disabled:opacity-50 text-[10px] md:text-sm"
                                >
                                    <Trash2 size={18} className={isDeleting ? 'animate-spin' : ''} />
                                    <span>{isDeleting ? 'BORRANDO' : 'ELIMINAR'}</span>
                                </button>
                            )}

                            {isAdmin() && (
                                <button 
                                    onClick={() => setIsEditing(true)}
                                    className="px-4 md:px-8 py-4 bg-white/10 text-white border border-white/20 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all duration-300 hover:bg-white hover:text-black transform hover:scale-105 active:scale-95 text-[10px] md:text-sm"
                                >
                                    <Edit3 size={18} />
                                    <span>EDITAR</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {isEditing && (
                <EditMovieDialog 
                    movie={movie} 
                    onClose={() => setIsEditing(false)} 
                    onUpdate={() => {
                        window.dispatchEvent(new Event('library-updated'));
                    }}
                />
            )}
        </div>
    );
}

export default MovieDetailsModal;
