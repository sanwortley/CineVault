import React from 'react';
import { Cloud, CheckCircle, AlertCircle, X, Loader } from 'lucide-react';
import { useUploadQueue } from '../context/UploadQueueContext';

export default function UploadQueuePanel() {
    const { queue, removeFromQueue, retryQueueItem } = useUploadQueue();

    if (queue.length === 0) return null;

    const uploadingItem = queue.find(j => j.status === 'uploading' || j.status === 'fetching' || j.status.includes('converting'));
    const activeCount = queue.filter(j => ['pending', 'uploading', 'fetching', 'downloading'].some(s => j.status.includes(s))).length;
    const errorItems = queue.filter(j => j.status === 'error');

    // Hide if nothing is actively uploading or pending, except if there are errors to show
    if (activeCount === 0 && errorItems.length === 0) return null;

    return (
        <div className="fixed bottom-8 right-8 z-[200] max-w-sm animate-fade-in group hover:opacity-100 opacity-90 transition-opacity">
            <div className="glass-card rounded-2xl border border-white/10 shadow-xl overflow-hidden backdrop-blur-xl bg-black/60">
                {/* Header / Global Status */}
                <div className="flex items-center gap-3 px-4 py-3 bg-white/5">
                    {uploadingItem ? (
                        <div className="relative">
                            <Cloud size={16} className="text-cyan-400 relative z-10" />
                            <div className="absolute inset-0 bg-cyan-400 blur-md opacity-30 animate-pulse"></div>
                        </div>
                    ) : errorItems.length > 0 ? (
                        <AlertCircle size={16} className="text-red-400" />
                    ) : (
                        <Cloud size={16} className="text-slate-400" />
                    )}
                    
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.1em] text-white/90 truncate">
                            {uploadingItem 
                                ? (uploadingItem.status === 'fetching' ? `Cloud Fetching (${activeCount})` : 
                                   uploadingItem.status.includes('converting') ? `Cloud Converting (${activeCount})` :
                                   `Syncing Drive (${activeCount} left)`)
                                : errorItems.length > 0 
                                    ? `${errorItems.length} Sync Errors` 
                                    : 'Subiendo Biblioteca...'}
                        </p>
                        {uploadingItem && (
                            <p className="text-xs font-semibold text-cyan-200/80 truncate mt-0.5">
                                {uploadingItem.title}
                            </p>
                        )}
                    </div>

                    {uploadingItem && (
                        <div className="text-[10px] font-bold text-cyan-400 ml-2 w-8 text-right shrink-0">
                            {Math.round(uploadingItem.progress)}%
                        </div>
                    )}
                </div>

                {/* Progress Bar for active item */}
                {uploadingItem && (
                    <div className="h-1 w-full bg-black/40">
                        <div 
                            className={`h-full bg-gradient-to-r from-cyan-500 to-blue-500 shadow-[0_0_10px_rgba(6,182,212,0.6)] transition-all duration-300 ${uploadingItem.isOptimizing ? 'animate-pulse' : ''}`}
                            style={{ width: `${Math.max(2, uploadingItem.progress)}%` }}
                        />
                    </div>
                )}
                
                {/* Tiny error indicator if there are errors but something else is uploading */}
                {errorItems.length > 0 && !uploadingItem && (
                    <div className="px-4 py-3 bg-red-500/10 border-t border-red-500/20">
                        <p className="text-[10px] text-red-300 font-medium">Alguna película falló al subir. Revisa tu Drive más tarde.</p>
                        <button 
                            onClick={() => errorItems.forEach(i => removeFromQueue(i.id))}
                            className="mt-2 text-[10px] font-bold text-red-400 hover:text-white uppercase tracking-wider transition-colors"
                        >
                            Borrar Alertas
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
