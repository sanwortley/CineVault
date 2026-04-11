import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Folder, ExternalLink, ShieldCheck, Database, Check, Cloud, CloudOff, Loader, UserPlus, X, Files } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, BACKEND_URL } from '../api';

function SettingsPage({ onClose, onTabChange }) {
    const { isAdmin } = useAuth();
    const [folders, setFolders] = useState([]);
    const [apiKey, setApiKey] = useState('');
    const [isSaved, setIsSaved] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [isDriveConnected, setIsDriveConnected] = useState(false);

    const fetchConfig = async () => {
        try {
            const foldersData = await api.getFolders();
            setFolders(foldersData.map(f => f.folder_path));

            const key = await api.getTMDBKey();
            if (key) { setApiKey(key); setIsSaved(true); }

            const connected = await api.checkDriveAuth();
            setIsDriveConnected(connected);
        } catch (error) {
            console.error('Error fetching config:', error);
        }
    };

    useEffect(() => { fetchConfig(); }, []);

    const handleAddFolder = async () => {
        setIsAdding(true);
        try {
            if (api.isElectron()) {
                const paths = await api.openDirectory();
                if (paths && paths.length > 0) await fetchConfig();
            } else {
                // Redirect to the Universal Sync tab which is the browser-native way
                if (onTabChange) onTabChange('upload');
            }
        } catch (error) {
            alert(`Error al agregar carpeta: ${error.message}`);
        } finally {
            setIsAdding(false);
        }
    };

    const handleDeleteFolder = async (path) => {
        await api.removeFolder(path);
        fetchConfig();
    };

    const handleSaveKey = async () => {
        try {
            await api.saveTMDBKey(apiKey);
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 3000);
        } catch (error) {
            alert('Error al guardar la API Key');
        }
    };

    return (
        <div className="p-4 md:p-12 pb-40 max-w-5xl mx-auto animate-fade-in relative z-10 no-drag">
            <header className="mb-8 md:mb-20 text-center md:text-left">
                <div className="flex flex-col md:flex-row items-center gap-2 md:gap-3 mb-4 md:mb-6">
                    <div className="w-8 md:w-12 h-[2px] bg-netflix-red/60 rounded-full hidden md:block"></div>
                    <span className="text-[9px] md:text-[11px] font-black uppercase tracking-[0.3em] md:tracking-[0.6em] text-white/90 glow-text">CineVault Experience</span>
                </div>
                <h1 className="text-4xl md:text-7xl font-black tracking-tighter text-white mb-3 md:mb-6 leading-none drop-shadow-2xl">
                    <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-300 to-netflix-red">Ajustes</span>
                </h1>
                <p className="text-slate-500 text-[9px] md:text-sm font-bold tracking-widest uppercase opacity-60">Configura tu centro de control cinematográfico.</p>
            </header>

            <div className="grid gap-6 md:gap-12">
                {/* Universal Sync Section - PRIMARY ACTION */}
                <section className="glass rounded-[1.5rem] md:rounded-[3rem] p-5 md:p-12 border border-white/5 shadow-2xl overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Files size={150} strokeWidth={1} />
                    </div>
                    <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
                        <div className="flex flex-col md:flex-row items-center gap-8 text-center md:text-left">
                            <div className="p-6 bg-white text-black rounded-[2rem] shadow-2xl scale-110">
                                <Plus size={32} strokeWidth={3} />
                            </div>
                            <div>
                                <h2 className="text-2xl md:text-4xl font-black text-white tracking-tighter mb-2">Sincronización Universal</h2>
                                <p className="text-slate-400 text-xs md:text-base font-bold opacity-80 max-w-lg leading-relaxed">
                                    Añade tus películas desde cualquier ordenador usando el explorador de Windows clásico. ¡Es instantáneo y fácil!
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={() => onTabChange('upload')}
                            className="w-full md:w-auto px-12 py-6 bg-white text-black text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-netflix-red hover:text-white transition-all shadow-2xl whitespace-nowrap active:scale-95"
                        >
                            Ir a Sincronizar
                        </button>
                    </div>
                </section>

                <div className="grid md:grid-cols-2 gap-6 md:gap-12">
                    {/* Vault Administration */}
                    <section className="glass rounded-[1.5rem] md:rounded-[3rem] p-5 md:p-10 border border-white/5 flex flex-col">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="p-4 bg-netflix-red/10 rounded-2xl">
                                <Database className="text-netflix-red" size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-white tracking-tight">CineVault Storage</h3>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Carpetas activas en la bóveda</p>
                            </div>
                        </div>

                        <div className="flex-1 space-y-3 mb-8">
                            {folders.length === 0 ? (
                                <div className="p-10 border-2 border-dashed border-white/5 rounded-[2rem] flex flex-col items-center justify-center text-center opacity-40">
                                    <Folder size={32} strokeWidth={1} className="mb-4" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">Sin carpetas vinculadas</p>
                                </div>
                            ) : (
                                folders.map((folder, index) => (
                                    <div key={index} className="flex justify-between items-center p-4 bg-white/[0.03] border border-white/5 rounded-2xl group hover:bg-white/5 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <Folder size={14} className="text-slate-600 shrink-0" />
                                            <span className="text-[11px] font-bold text-slate-400 truncate tracking-tight">{folder}</span>
                                        </div>
                                        <button 
                                            onClick={() => handleDeleteFolder(folder)}
                                            className="p-2 text-slate-600 hover:text-red-500 transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <button 
                            onClick={handleAddFolder}
                            disabled={isAdding}
                            className="w-full py-5 bg-white/5 text-white border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-white/10 active:scale-95 transition-all shadow-xl flex items-center justify-center gap-2"
                        >
                            <Plus size={16} />
                            Añadir Manualmente
                        </button>
                    </section>

                    {/* Metadata Engine */}
                    <section className="glass rounded-[1.5rem] md:rounded-[3rem] p-5 md:p-10 border border-white/5">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="p-4 bg-netflix-red/10 rounded-2xl">
                                <ShieldCheck className="text-netflix-red" size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-white tracking-tight">Motor de Metadatos</h3>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Conexión con TMDB</p>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3 ml-1">TMDB API KEY</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="Tu clave de API..."
                                        className="flex-1 bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-netflix-red transition-colors min-w-0"
                                    />
                                    <button 
                                        onClick={handleSaveKey}
                                        className={`flex items-center justify-center rounded-2xl font-black uppercase tracking-widest transition-all shrink-0 ${isSaved ? 'bg-green-500 text-white w-14' : 'bg-white text-black hover:bg-neutral-200 px-8'}`}
                                    >
                                        {isSaved ? <Check size={18} strokeWidth={3} /> : <span className="text-[10px]">Guardar</span>}
                                    </button>
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-600 leading-relaxed px-1">
                                Necesaria para obtener pósters, tráilers y descripciones automáticamente. Consigue una en <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" className="text-netflix-red hover:underline">themoviedb.org</a>.
                            </p>
                        </div>
                    </section>
                </div>

                {/* Cloud Sync - Google Drive */}
                <section className="glass rounded-[1.5rem] md:rounded-[3rem] p-5 md:p-12 border border-white/5 shadow-2xl">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                        <div className="flex items-center gap-6">
                            <div className={`p-6 rounded-[2rem] shadow-inner ${isDriveConnected ? 'bg-green-500/10' : 'bg-blue-500/10'}`}>
                                <Cloud className={isDriveConnected ? 'text-green-500' : 'text-blue-500'} size={32} />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black text-white tracking-tighter">Sincronización Cloud</h3>
                                <div className="flex items-center gap-2 mt-2">
                                    <div className={`w-2 h-2 rounded-full ${isDriveConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-slate-600'}`}></div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                        Google Drive: {isDriveConnected ? 'Conectado' : 'Desconectado'}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <button 
                            onClick={async () => {
                                try {
                                    await api.authenticateDrive();
                                    setIsDriveConnected(true);
                                } catch (error) {
                                    console.error('Error al conectar Drive:', error);
                                }
                            }}
                            className={`w-full md:w-auto px-10 py-5 font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-xl active:scale-95 flex items-center justify-center gap-3 ${isDriveConnected ? 'bg-netflix-red/10 text-netflix-red hover:bg-netflix-red hover:text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                        >
                            <Cloud size={16} />
                            <span className="text-[10px]">{isDriveConnected ? 'Reconectar Drive' : 'Vincular Google Drive'}</span>
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default SettingsPage;
