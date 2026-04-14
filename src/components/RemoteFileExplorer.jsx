import React, { useState, useEffect } from 'react';
import { Folder, ChevronRight, HardDrive, Search, X, Home, Monitor, Download, Files, Film, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api';

const SYSTEM_FOLDERS = [
    '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/var'
];

const FolderIcon = ({ name }) => {
    const n = name.toLowerCase();
    if (n.includes('desktop') || n.includes('escritorio')) return <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg"><Monitor size={14} /></div>;
    if (n.includes('download') || n.includes('descargas')) return <div className="p-2 bg-green-500/10 text-green-400 rounded-lg"><Download size={14} /></div>;
    if (n.includes('video') || n.includes('pelicula')) return <div className="p-2 bg-netflix-red/10 text-netflix-red rounded-lg"><Film size={14} /></div>;
    if (n.includes('document')) return <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg"><Files size={14} /></div>;
    return <div className="p-2 bg-white/5 text-slate-500 rounded-lg"><Folder size={14} /></div>;
};

export default function RemoteFileExplorer({ onSelect, onClose }) {
    const [path, setPath] = useState('/');
    const [items, setItems] = useState([]);
    const [drives, setDrives] = useState([]);
    const [homeInfo, setHomeInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [statusMsg, setStatusMsg] = useState('');

    useEffect(() => {
        const init = async () => {
            try {
                const [drivesData, homeData] = await Promise.all([
                    api.getDrives(),
                    api.getHomeFolders()
                ]);
                setDrives(drivesData);
                setHomeInfo(homeData);
                
                if (homeData && homeData.home) {
                    await navigateTo(homeData.home);
                } else if (drivesData.length > 0) {
                    await navigateTo(drivesData[0]);
                } else {
                    await navigateTo('/');
                }
            } catch (err) {
                console.error('Error initializing explorer:', err);
                setLoading(false);
            }
        };
        init();
    }, []);

    const navigateTo = async (newPath) => {
        setLoading(true);
        setStatusMsg('Escaneando servidor...');
        try {
            const content = await api.ls(newPath);
            // Filter system folders & hidden files
            const filtered = content.filter(item => 
                !SYSTEM_FOLDERS.some(sys => item.path === sys) && 
                !item.name.startsWith('.')
            );
            setItems(filtered);
            setPath(newPath);
        } catch (err) {
            console.error('Error navigating:', err);
            setStatusMsg('Error al acceder a esta ruta');
        } finally {
            setLoading(false);
        }
    };

    const breadcrumbs = path.split(/[/\\]/).filter(Boolean);

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300" onClick={onClose}></div>
            
            <div className="relative w-full max-w-4xl bg-black/90 border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col h-[600px]">
                {/* Header */}
                <div className="p-6 bg-white/[0.03] border-b border-white/5 flex items-center justify-between no-drag">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-netflix-red/10 rounded-2xl">
                            <Home className="text-netflix-red" size={20} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-white tracking-tight">Sincronización Instantánea</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1 italic">Vincular carpeta del servidor (sin subir datos)</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={24} className="text-slate-500" />
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar: Shortcuts */}
                    <div className="w-56 border-r border-white/5 bg-black/40 p-4 flex flex-col gap-1 overflow-y-auto no-scrollbar">
                        <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest ml-4 mb-2">Favoritos</span>
                        {homeInfo?.commonFolders.map(folder => (
                            <button 
                                key={folder.path}
                                onClick={() => navigateTo(folder.path)}
                                className={`flex items-center gap-3 p-3 rounded-xl transition-all ${path === folder.path ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                            >
                                <FolderIcon name={folder.name} />
                                <span className="text-xs font-bold truncate">{folder.name}</span>
                            </button>
                        ))}

                        <div className="h-px bg-white/5 my-4" />
                        
                        <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest ml-4 mb-2">Unidades</span>
                        {drives.map(drive => (
                            <button 
                                key={drive}
                                onClick={() => navigateTo(drive)}
                                className={`flex items-center gap-3 p-3 rounded-xl transition-all ${path === drive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                            >
                                <HardDrive size={16} className="text-slate-500" />
                                <span className="text-xs font-bold">{drive}</span>
                            </button>
                        ))}
                    </div>

                    {/* Main Content: Files */}
                    <div className="flex-1 flex flex-col bg-white/[0.01]">
                        {/* Navigation Bar */}
                        <div className="p-4 bg-black/40 border-b border-white/5 flex items-center gap-2 overflow-x-auto custom-scrollbar no-drag">
                            <button onClick={() => navigateTo('/')} className="p-2 text-slate-500 hover:text-white shrink-0"><Home size={14} /></button>
                            {breadcrumbs.map((part, i) => (
                                <React.Fragment key={i}>
                                    <ChevronRight size={10} className="text-slate-700 shrink-0" />
                                    <button 
                                        onClick={() => {
                                            const parts = breadcrumbs.slice(0, i + 1);
                                            const newPath = path.includes('\\') ? parts.join('\\') : '/' + parts.join('/');
                                            navigateTo(newPath);
                                        }}
                                        className="px-2 py-1 text-xs font-bold text-slate-400 hover:text-white whitespace-nowrap"
                                    >
                                        {part}
                                    </button>
                                </React.Fragment>
                            ))}
                        </div>

                        {/* Folder List */}
                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center h-full gap-4 animate-pulse">
                                    <div className="w-8 h-8 border-2 border-white/10 border-t-netflix-red rounded-full animate-spin" />
                                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">{statusMsg}</span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {items.length === 0 && (
                                        <div className="col-span-full flex flex-col items-center justify-center py-20 opacity-40">
                                            <Folder size={48} strokeWidth={1} />
                                            <p className="text-[10px] font-black uppercase tracking-widest mt-4">Carpeta vacía</p>
                                        </div>
                                    )}
                                    {items.map((item, i) => (
                                        <button
                                            key={i}
                                            onClick={() => navigateTo(item.path)}
                                            className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all text-left group"
                                        >
                                            <div className="p-3 bg-white/5 rounded-xl group-hover:bg-netflix-red/10 group-hover:text-netflix-red transition-all">
                                                <Folder size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-black text-white truncate mb-0.5">{item.name}</p>
                                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Carpeta</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer Actions */}
                        <div className="p-8 bg-black/60 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
                            <div className="flex-1 min-w-0 w-full">
                                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 opacity-60">Ruta de Origen seleccionada</p>
                                <div className="bg-white/5 p-3 rounded-xl border border-white/5 truncate font-mono text-[10px] text-slate-300">
                                    {path}
                                </div>
                            </div>
                            <button
                                onClick={() => onSelect(path)}
                                className="w-full md:w-auto px-12 py-5 bg-white text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-neutral-200 active:scale-95 transition-all shadow-[0_20px_40px_rgba(0,0,0,0.4)] whitespace-nowrap"
                            >
                                Vincular ahora
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
