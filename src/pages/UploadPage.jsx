import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileVideo, CheckCircle2, AlertCircle, Loader2, FolderOpen, ChevronRight, X, Files } from 'lucide-react';
import { api } from '../api';

export default function UploadPage({ onUploadComplete }) {
    const [dragActive, setDragActive] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);

    const [uploadStates, setUploadStates] = useState({}); // { fileName: { status: 'pending'|'uploading'|'done'|'error', progress: 0 } }
    const [existingMovies, setExistingMovies] = useState([]);
    const [skippedCount, setSkippedCount] = useState(0);

    const fetchConfig = async () => {
        try {
            // Fetch existing movies to perform deduplication
            const moviesData = await api.getMovies();
            setExistingMovies(moviesData);
        } catch (err) {
            console.error('Error fetching movies for deduplication:', err);
        }
    };

    useEffect(() => {
        fetchConfig();
    }, []);

    // Initialize states when files are selected
    useEffect(() => {
        const newStates = {};
        selectedFiles.forEach(file => {
            newStates[file.name] = uploadStates[file.name] || { status: 'pending', progress: 0 };
        });
        setUploadStates(newStates);
    }, [selectedFiles]);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const scanEntry = async (entry) => {
        const files = [];
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve));
            if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mkv|avi|mov|wmv)$/i)) {
                files.push(file);
            }
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const entries = await new Promise((resolve) => {
                const allEntries = [];
                const readBatch = () => {
                    reader.readEntries((batch) => {
                        if (batch.length === 0) resolve(allEntries);
                        else {
                            allEntries.push(...batch);
                            readBatch();
                        }
                    });
                };
                readBatch();
            });
            for (const subEntry of entries) {
                const subFiles = await scanEntry(subEntry);
                files.push(...subFiles);
            }
        }
        return files;
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        
        const items = Array.from(e.dataTransfer.items);
        if (items && items.length > 0) {
            const allFiles = [];
            for (const item of items) {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    const files = await scanEntry(entry);
                    allFiles.push(...files);
                }
            }
            handleFiles(allFiles);
        }
    };

    const handleFiles = (files) => {
        // Filter for video files only
        const videos = files.filter(file => file.name.match(/\.(mp4|mkv|avi|mov|wmv)$/i));
        if (videos.length === 0) {
            setError('No se encontraron películas válidas en la selección.');
            return;
        }

        // --- Smart Deduplication ---
        const serverFiles = new Set(existingMovies.map(m => `${m.file_name}-${m.file_size}`));
        
        let skipped = 0;
        const novelVideos = videos.filter(v => {
            if (serverFiles.has(`${v.name}-${v.size}`)) {
                skipped++;
                return false;
            }
            return true;
        });

        setSkippedCount(skipped);
        setError('');

        if (novelVideos.length === 0 && skipped > 0) {
            setError(`Todas las películas ya están en tu Bóveda (${skipped} omitidas).`);
            return;
        }

        setSelectedFiles(prev => {
            const existingPaths = new Set(prev.map(f => `${f.name}-${f.size}`));
            const uniqueNewVideos = novelVideos.filter(v => !existingPaths.has(`${v.name}-${v.size}`));
            return [...prev, ...uniqueNewVideos];
        });
    };

    const removeFile = (index) => {
        const file = selectedFiles[index];
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
        setUploadStates(prev => {
            const next = { ...prev };
            delete next[file.name];
            return next;
        });
    };

    const handleUpload = async () => {
        if (selectedFiles.length === 0) return;

        setIsUploading(true);
        setError('');
        setSuccess(false);

        try {
            const CONCURRENCY = 3;
            const queue = [...selectedFiles];
            const activeExports = [];
            let completedCount = 0;

            const processQueue = async () => {
                while (queue.length > 0) {
                    const file = queue.shift();
                    if (uploadStates[file.name]?.status === 'done') {
                        completedCount++;
                        continue;
                    }

                    const uploadPromise = (async () => {
                        setUploadStates(prev => ({
                            ...prev,
                            [file.name]: { status: 'uploading', progress: 0 }
                        }));

                        try {
                            await api.uploadToLibrary([file], '', (p) => {
                                setUploadStates(prev => ({
                                    ...prev,
                                    [file.name]: { status: 'uploading', progress: p }
                                }));
                                
                                // Overall progress calculation logic
                                // (Rough estimate: each file counts for 1/total)
                                const totalProgress = (completedCount * 100 + p) / selectedFiles.length;
                                setProgress(Math.min(99, Math.round(totalProgress)));
                            });

                            setUploadStates(prev => ({
                                ...prev,
                                [file.name]: { status: 'done', progress: 100 }
                            }));
                            completedCount++;
                            setProgress(Math.round((completedCount / selectedFiles.length) * 100));
                        } catch (fileErr) {
                            setUploadStates(prev => ({
                                ...prev,
                                [file.name]: { status: 'error', progress: 0 }
                            }));
                            console.error(`Fallo en "${file.name}":`, fileErr);
                        }
                    })();

                    activeExports.push(uploadPromise);
                    if (activeExports.length >= CONCURRENCY) {
                        await Promise.race(activeExports);
                        // Clean up finished promises
                        // This is a bit simplified, but works for the queue
                    }
                }
                await Promise.all(activeExports);
            };

            await processQueue();
            
            setSuccess(true);
            setSelectedFiles([]);
            if (onUploadComplete) onUploadComplete();
            // Refresh DB
            api.refreshLibrary();
        } catch (err) {
            setError(err.message || 'Error en la sincronización turbo');
        } finally {
            setIsUploading(false);
            setProgress(0);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-4 md:p-12 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="mb-12 text-center">
                <div className="flex items-center gap-3 mb-4 justify-center">
                    <div className="w-12 h-[2px] bg-netflix-red/60 rounded-full"></div>
                    <span className="text-[11px] font-black uppercase tracking-[0.5em] text-white/90">Sincronización Universal</span>
                    <div className="w-12 h-[2px] bg-netflix-red/60 rounded-full"></div>
                </div>
                <h1 className="text-4xl md:text-7xl font-black tracking-tighter text-white mb-4">
                    Tus películas, <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-netflix-red">en cualquier PC</span>
                </h1>
                <p className="text-slate-500 text-xs md:text-sm font-bold tracking-widest uppercase opacity-60">Sincroniza tus carpetas locales con tu Bóveda Central al instante.</p>
            </header>

            <div className="grid gap-8">
                {/* Simplified Dropzone */}
                <div 
                    className={`glass rounded-[3rem] border-2 border-dashed p-12 md:p-24 transition-all duration-700 relative overflow-hidden flex flex-col items-center text-center ${dragActive ? 'border-netflix-red bg-netflix-red/5 scale-[0.98]' : 'border-white/10 hover:border-white/20'}`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                >
                    <div className="w-full max-w-xl mx-auto mb-10">
                        <div className="glass p-8 rounded-[2rem] border border-netflix-red/30 bg-netflix-red/5 relative group hover:bg-netflix-red/10 transition-colors shadow-2xl">
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-netflix-red rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-white whitespace-nowrap shadow-lg">
                                Método Recomendado
                            </div>
                            <h3 className="text-2xl font-black text-white mb-2 tracking-tight">Sincronización Mágica Local</h3>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 leading-relaxed">
                                Pega la ruta de tu carpeta de películas para leerlas al instante SIN duplicarlas ni ocupar espacio extra.
                            </p>
                            
                            <div className="flex w-full gap-3">
                                <input 
                                    id="sync-path-input"
                                    type="text"
                                    placeholder="Ej: C:\Users\sanwo\Videos\Peliculas"
                                    className="flex-1 bg-black/60 border border-white/10 group-hover:border-netflix-red/50 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-netflix-red transition-all shadow-inner"
                                    onKeyDown={async (e) => {
                                        if (e.key === 'Enter') {
                                            const path = e.target.value.trim();
                                            if (!path) return;
                                            try {
                                                await api.addFolder(path);
                                                setSuccess(true);
                                                e.target.value = '';
                                                alert('¡Vinculación completada! El escáner puede tardar unos 30-45 segundos en bajar las portadas. Visita Inicio en un momento.');
                                            } catch (err) {
                                                alert(`Error: ${err.message}`);
                                            }
                                        }
                                    }}
                                />
                                <button 
                                    onClick={async () => {
                                        const input = document.getElementById('sync-path-input');
                                        const path = input.value.trim();
                                        if (!path) return;
                                        try {
                                            await api.addFolder(path);
                                            setSuccess(true);
                                            input.value = '';
                                            alert('¡Vinculación completada! El escáner puede tardar unos 30-45 segundos en bajar las portadas. Visita Inicio en un momento.');
                                        } catch (err) {
                                            alert(`Error: ${err.message}`);
                                        }
                                    }}
                                    className="px-8 py-4 bg-white text-black hover:bg-netflix-red hover:text-white text-[11px] font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl active:scale-95"
                                >
                                    Vincular
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="border border-dashed border-white/10 rounded-[3rem] p-10 mt-8 relative opacity-60 hover:opacity-100 transition-opacity">
                        <div className="absolute -top-3 left-8 px-4 py-1 bg-white/10 rounded-full text-[9px] font-black uppercase tracking-[0.2em] text-white">
                            Método Alternativo: Copiar Archivos
                        </div>
                        <h4 className="text-lg font-black text-white mb-4">Solo si necesitas hacer una copia</h4>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 max-w-sm mx-auto mb-6">Arrastra o selecciona archivos para COPIARLOS literalmente a la bóveda (Tarda bastante y consume espacio).</p>
                        
                        <input 
                            className="hidden" 
                            ref={folderInputRef} 
                            type="file" 
                            webkitdirectory="true"
                            directory="true"
                            multiple
                            onChange={(e) => handleFiles(Array.from(e.target.files))} 
                        />
                        <button 
                            onClick={() => folderInputRef.current.click()}
                            className="px-8 py-4 bg-white/5 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-white/10 active:scale-95 transition-all border border-white/10"
                        >
                            Seleccionar Archivos para Copiar
                        </button>
                    </div>
                    
                    {dragActive && <div className="absolute inset-0 bg-netflix-red/5 backdrop-blur-[2px] animate-in fade-in duration-300 pointer-events-none"></div>}
                </div>

                {/* File List & Smart Deduplication Feedback */}
                {selectedFiles.length > 0 && (
                    <div className="glass rounded-[2rem] border border-white/5 overflow-hidden animate-in slide-in-from-top-4 duration-500 shadow-2xl">
                        <div className="p-8 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-netflix-red animate-pulse"></span>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{selectedFiles.length} películas detectadas</span>
                                </div>
                                {skippedCount > 0 && (
                                    <div className="px-4 py-1 bg-netflix-red/10 border border-netflix-red/20 rounded-full">
                                        <span className="text-[8px] font-black uppercase tracking-widest text-netflix-red">{skippedCount} ya están en la Bóveda</span>
                                    </div>
                                )}
                            </div>
                            <button onClick={() => { setSelectedFiles([]); setSkippedCount(0); }} className="text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-400">Cancelar todo</button>
                        </div>

                        <div className="max-h-96 overflow-y-auto divide-y divide-white/5 custom-scrollbar bg-black/40">
                            {selectedFiles.map((file, i) => {
                                const state = uploadStates[file.name] || { status: 'pending', progress: 0 };
                                return (
                                    <div key={i} className={`p-6 transition-all ${state.status === 'uploading' ? 'bg-white/[0.03]' : ''}`}>
                                        <div className="flex items-center justify-between group">
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className={`p-3 rounded-xl ${state.status === 'done' ? 'bg-green-500/10 text-green-500' : state.status === 'error' ? 'bg-red-500/10 text-red-500' : 'bg-white/5 text-slate-500'}`}>
                                                    {state.status === 'done' ? <CheckCircle2 size={16} /> : state.status === 'error' ? <AlertCircle size={16} /> : <FileVideo size={16} />}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className={`text-sm font-black truncate tracking-tight transition-colors ${state.status === 'done' ? 'text-green-500/80' : state.status === 'error' ? 'text-red-500' : 'text-slate-200'}`}>
                                                        {file.name}
                                                    </p>
                                                    <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-0.5">{(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB</p>
                                                </div>
                                            </div>
                                            {!isUploading && state.status !== 'done' && (
                                                <button onClick={() => removeFile(i)} className="p-2 text-slate-600 hover:text-red-500 transition-colors">
                                                    <X size={16} />
                                                </button>
                                            )}
                                            {state.status === 'uploading' && (
                                                <div className="flex items-center gap-2">
                                                    <Loader2 size={12} className="text-netflix-red animate-spin" />
                                                    <span className="text-[10px] font-black text-netflix-red animate-pulse">SINCRONIZANDO</span>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {(state.status === 'uploading' || state.status === 'done') && (
                                            <div className="mt-4 pl-14 h-1.5 w-full flex items-center gap-4">
                                                <div className="flex-1 h-full bg-white/5 rounded-full overflow-hidden">
                                                    <div 
                                                        className={`h-full transition-all duration-500 ease-out ${state.status === 'done' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]' : 'bg-netflix-red shadow-[0_0_12px_rgba(229,9,20,0.5)]'}`}
                                                        style={{ width: `${state.progress}%` }}
                                                    />
                                                </div>
                                                <span className="text-[10px] font-black text-slate-500 w-8 text-right font-mono">{state.progress}%</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="p-10 bg-black/60 border-t border-white/5">
                            {isUploading ? (
                                <div className="space-y-6">
                                    <div className="flex justify-between items-end mb-2">
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Sincronización Maestra</span>
                                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">No cierres esta pestaña</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-2xl font-black text-netflix-red">{progress}%</span>
                                        </div>
                                    </div>
                                    <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                        <div 
                                            className="h-full bg-gradient-to-r from-netflix-red to-red-600 shadow-[0_0_30px_rgba(229,9,20,0.4)] transition-all duration-700 ease-out"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={handleUpload}
                                    className="w-full py-6 bg-netflix-red text-white text-[11px] font-black uppercase tracking-[0.4em] rounded-2xl hover:bg-red-700 hover:scale-[1.01] active:scale-[0.99] shadow-[0_20px_50px_rgba(229,9,20,0.3)] transition-all flex items-center justify-center gap-3"
                                >
                                    <Upload size={18} strokeWidth={3} />
                                    Sincronizar Bóveda Ahora
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Master Status Messages */}
                {success && (
                    <div className="p-10 bg-green-500/10 border border-green-500/20 rounded-[3rem] flex items-center gap-8 animate-in zoom-in duration-500 shadow-2xl shadow-green-500/5">
                        <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center shrink-0 border border-green-500/30">
                            <CheckCircle2 className="text-green-500" size={40} strokeWidth={3} />
                        </div>
                        <div>
                            <h4 className="text-3xl font-black text-white tracking-tighter">¡Bóveda Actualizada!</h4>
                            <p className="text-sm font-bold text-green-500/80 uppercase tracking-widest mt-2 leading-relaxed">Tus películas ya están seguras en el servidor. El escáner automático las añadirá a tu biblioteca en unos segundos.</p>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="p-8 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center gap-6 animate-in slide-in-from-top-4 duration-500">
                        <div className="p-3 bg-red-500/20 rounded-full">
                            <AlertCircle className="text-red-500" size={24} />
                        </div>
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-widest text-red-500 mb-1">Error de Sincronización</p>
                            <span className="text-xs font-bold text-red-400 leading-relaxed">{error}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
