import React, { useState, useEffect } from 'react';
import { Folder, ChevronRight, Search, X, Home, Cloud, FileText, CheckCircle2 } from 'lucide-react';
import { api } from '../api';

const GOOGLE_DRIVE_MIME_FOLDER = 'application/vnd.google-apps.folder';

export default function DriveExplorer({ onSelect, onClose }) {
    const [path, setPath] = useState([{ id: 'root', name: 'Mi Unidad' }]);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const currentFolderId = path[path.length - 1].id;

    useEffect(() => {
        loadFolderContent(currentFolderId);
    }, [currentFolderId]);

    const loadFolderContent = async (folderId) => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.listDriveFiles(folderId);
            if (res.files) {
                // Filter to show only folders and subtitle files
                const filtered = res.files.filter(item => {
                    const isFolder = item.mimeType === GOOGLE_DRIVE_MIME_FOLDER;
                    const isSubtitle = item.name.toLowerCase().endsWith('.srt') || 
                                     item.name.toLowerCase().endsWith('.vtt') ||
                                     item.name.toLowerCase().endsWith('.sbv');
                    return isFolder || isSubtitle;
                });
                setItems(filtered);
            }
        } catch (err) {
            console.error('[DriveExplorer] Error loading content:', err);
            setError('Error al conectar con Google Drive. Verifica tu conexión.');
        } finally {
            setLoading(false);
        }
    };

    const handleItemClick = (item) => {
        if (item.mimeType === GOOGLE_DRIVE_MIME_FOLDER) {
            setPath([...path, { id: item.id, name: item.name }]);
        } else {
            // It's a file
            onSelect(item);
        }
    };

    const navigateBack = (index) => {
        setPath(path.slice(0, index + 1));
    };

    return (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300" onClick={onClose}></div>
            
            <div className="relative w-full max-w-2xl bg-slate-900/90 border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col h-[500px]">
                {/* Header */}
                <div className="p-6 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-cyan-500/10 rounded-2xl">
                            <Cloud className="text-cyan-400" size={20} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-white tracking-tight">Google Drive</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1 italic">Selecciona un archivo de subtítulos</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={24} className="text-slate-500" />
                    </button>
                </div>

                {/* Breadcrumbs */}
                <div className="px-6 py-3 bg-black/40 border-b border-white/5 flex items-center gap-2 overflow-x-auto custom-scrollbar">
                    <button onClick={() => navigateBack(0)} className="text-slate-500 hover:text-white shrink-0">
                        <Home size={14} />
                    </button>
                    {path.map((folder, i) => i > 0 && (
                        <React.Fragment key={folder.id}>
                            <ChevronRight size={10} className="text-slate-700 shrink-0" />
                            <button 
                                onClick={() => navigateBack(i)}
                                className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-colors ${i === path.length - 1 ? 'text-cyan-400' : 'text-slate-500 hover:text-white'}`}
                            >
                                {folder.name}
                            </button>
                        </React.Fragment>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-4">
                            <div className="w-8 h-8 border-2 border-white/10 border-t-cyan-500 rounded-full animate-spin" />
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Cargando Drive...</span>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-center gap-4 px-10">
                            <p className="text-xs font-bold text-red-400">{error}</p>
                            <button onClick={() => loadFolderContent(currentFolderId)} className="text-[10px] font-black uppercase text-cyan-400 border border-cyan-400/20 px-4 py-2 rounded-lg hover:bg-cyan-400/10 transition-all">Reintentar</button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {items.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-20 opacity-40">
                                    <Search size={48} strokeWidth={1} />
                                    <p className="text-[10px] font-black uppercase tracking-widest mt-4 text-center">No se encontraron subtítulos<br/>en esta carpeta</p>
                                </div>
                            )}
                            {items.map((item) => {
                                const isFolder = item.mimeType === GOOGLE_DRIVE_MIME_FOLDER;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => handleItemClick(item)}
                                        className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all text-left group"
                                    >
                                        <div className={`p-3 rounded-xl transition-all ${isFolder ? 'bg-cyan-500/10 text-cyan-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                            {isFolder ? <Folder size={18} /> : <FileText size={18} />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-black text-white truncate mb-0.5">{item.name}</p>
                                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{isFolder ? 'Carpeta' : 'Subtítulo'}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
