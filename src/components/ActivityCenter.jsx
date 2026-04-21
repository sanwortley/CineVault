import React, { useState, useEffect } from 'react';
import { Bell, X, CheckCircle2, AlertCircle, RefreshCw, Trash2, Loader, ChevronRight } from 'lucide-react';
import { useUploadQueue } from '../context/UploadQueueContext';

export default function ActivityCenter() {
    const [isOpen, setIsOpen] = useState(false);
    const { queue, removeFromQueue, retryQueueItem } = useUploadQueue();
    
    const activeCount = queue.filter(j => ['pending', 'uploading', 'fetching', 'downloading', 'converting'].some(s => j.status.includes(s))).length;
    const errorCount = queue.filter(j => j.status === 'error').length;
    const hasActivity = activeCount > 0 || errorCount > 0;

    // Auto-close if clicked outside
    useEffect(() => {
        if (!isOpen) return;
        const handleOutsideClick = () => setIsOpen(false);
        window.addEventListener('click', handleOutsideClick);
        return () => window.removeEventListener('click', handleOutsideClick);
    }, [isOpen]);

    const clearCompleted = () => {
        queue.filter(j => j.status === 'done').forEach(j => removeFromQueue(j.id));
    };

    return (
        <div className="relative" onClick={e => e.stopPropagation()}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`relative p-2.5 rounded-full transition-all duration-500 overflow-hidden group ${isOpen ? 'bg-netflix-red text-white shadow-[0_0_20px_rgba(229,9,20,0.4)]' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
            >
                <Bell size={20} className={`${activeCount > 0 ? 'animate-bounce' : ''}`} />
                {hasActivity && (
                    <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-netflix-red rounded-full border-2 border-black group-hover:scale-110 transition-transform"></span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-4 w-80 md:w-96 glass-card rounded-[2rem] border border-white/10 shadow-2xl overflow-hidden z-[1000] animate-in slide-in-from-top-4 fade-in duration-300">
                    <header className="px-6 py-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-wider text-white">Actividad</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                                {activeCount > 0 ? `${activeCount} en curso` : 'Sin procesos activos'}
                            </p>
                        </div>
                        {queue.some(j => j.status === 'done') && (
                            <button 
                                onClick={clearCompleted}
                                className="text-[9px] font-black uppercase tracking-tighter text-slate-400 hover:text-white transition-colors"
                            >
                                Limpiar Éxitos
                            </button>
                        )}
                    </header>

                    <div className="max-h-[70vh] overflow-y-auto no-scrollbar py-2">
                        {queue.length === 0 ? (
                            <div className="py-12 px-6 text-center">
                                <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4 opacity-20">
                                    <Bell size={20} />
                                </div>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">No hay notificaciones</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {queue.map((job) => (
                                    <div key={job.id} className="p-4 hover:bg-white/[0.02] transition-colors group">
                                        <div className="flex items-start gap-4">
                                            <div className="mt-1">
                                                {job.status === 'done' ? <CheckCircle2 size={16} className="text-green-500" /> :
                                                 job.status === 'error' ? <AlertCircle size={16} className="text-netflix-red" /> :
                                                 <Loader size={16} className="text-cyan-500 animate-spin" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 mb-1">
                                                    <p className="text-xs font-bold text-white truncate">{job.title}</p>
                                                    <span className="text-[9px] font-black text-slate-500 uppercase shrink-0">
                                                        {Math.round(job.progress)}%
                                                    </span>
                                                </div>

                                                <div className="h-1 w-full bg-black/40 rounded-full overflow-hidden mb-2">
                                                    <div 
                                                        className={`h-full transition-all duration-700 ${
                                                            job.status === 'error' ? 'bg-netflix-red' : 
                                                            job.status === 'done' ? 'bg-green-500' : 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                                                        }`}
                                                        style={{ width: `${Math.max(2, job.progress)}%` }}
                                                    ></div>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <p className={`text-[9px] font-bold uppercase tracking-tighter ${
                                                        job.status === 'error' ? 'text-netflix-red' : 'text-slate-500'
                                                    }`}>
                                                        {job.status === 'error' ? (job.errorMsg || 'Falló') :
                                                         job.status === 'done' ? 'Completado' :
                                                         job.status.includes('converting') ? 'Procesando en la nube...' :
                                                         job.status.includes('fetching') || job.status.includes('downloading') ? 'Descargando...' :
                                                         job.status === 'uploading' ? 'Subiendo a Drive...' :
                                                         job.status === 'pending' ? 'En cola...' :
                                                         job.status}
                                                    </p>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {job.status === 'error' && (
                                                            <button 
                                                                onClick={() => retryQueueItem(job.id)}
                                                                className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"
                                                                title="Reintentar"
                                                            >
                                                                <RefreshCw size={12} />
                                                            </button>
                                                        )}
                                                        <button 
                                                            onClick={() => removeFromQueue(job.id)}
                                                            className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-netflix-red"
                                                            title="Eliminar"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <footer className="px-6 py-4 border-t border-white/5 bg-white/[0.01]">
                        <button 
                            onClick={clearCompleted}
                            className="w-full py-3 bg-white/[0.05] hover:bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-all flex items-center justify-center gap-2"
                        >
                            Historial completo en Ajustes
                            <ChevronRight size={12} />
                        </button>
                    </footer>
                </div>
            )}
        </div>
    );
}
