import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Folder, ExternalLink, ShieldCheck, Database, Check, Cloud, CloudOff, Loader, UserPlus, X, Files, Settings, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, BACKEND_URL } from '../api';
import SessionsManager from '../components/SessionsManager';

function SettingsPage({ onClose, onTabChange }) {
    const { isAdmin } = useAuth();
    const [folders, setFolders] = useState([]);
    const [apiKey, setApiKey] = useState('');
    const [isSaved, setIsSaved] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [isDriveConnected, setIsDriveConnected] = useState(false);
    const [rdToken, setRdToken] = useState('');
    const [isRDSaved, setIsRDSaved] = useState(false);

    const fetchConfig = async () => {
        try {
            const foldersData = await api.getFolders();
            setFolders(foldersData.map(f => f.folder_path));

            const key = await api.getTMDBKey();
            if (key) { setApiKey(key); setIsSaved(true); }

            const connected = await api.checkDriveAuth();
            setIsDriveConnected(connected);

            if (isAdmin) {
                const rdData = await api.getRDToken();
                if (rdData.token) setRdToken(rdData.token);
            }
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
    const handleSaveRDToken = async () => {
        try {
            await api.saveRDToken(rdToken);
            setIsRDSaved(true);
            setTimeout(() => setIsRDSaved(false), 3000);
        } catch (error) {
            alert('Error al guardar el Token de Real-Debrid');
        }
    };

    return (
        <div className="p-4 md:p-12 pb-40 max-w-7xl mx-auto animate-fade-in relative z-10 no-drag">
            <header className="mb-12 md:mb-24 text-center md:text-left">
                <div className="flex flex-col md:flex-row items-center gap-2 md:gap-4 mb-6">
                    <div className="w-12 h-[3px] bg-netflix-red rounded-full hidden md:block"></div>
                    <span className="text-[10px] md:text-[12px] font-black uppercase tracking-[0.5em] text-white/90 glow-text">CineVault Control Center</span>
                </div>
                <h1 className="text-5xl md:text-8xl font-black tracking-tighter text-white mb-6 leading-none select-none">
                    <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-200 to-slate-500">Configuración</span>
                </h1>
                <p className="text-slate-500 text-[10px] md:text-base font-bold tracking-widest uppercase opacity-60">Personaliza y potencia tu experiencia cinematográfica de élite.</p>
            </header>

            <div className="grid gap-12">
                {/* 1. Primary Action: Universal Sync */}
                <section className="glass rounded-[3rem] p-8 md:p-16 border border-white/5 shadow-2xl relative overflow-hidden group">
                    <div className="absolute -top-24 -right-24 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-all duration-700 rotate-12 scale-150">
                        <Files size={400} strokeWidth={1} />
                    </div>
                    
                    <div className="flex flex-col lg:flex-row items-center justify-between gap-12 relative z-10">
                        <div className="flex flex-col md:flex-row items-center gap-12 text-center md:text-left">
                            <div className="p-10 bg-white text-black rounded-[2.5rem] shadow-[0_0_50px_rgba(255,255,255,0.2)] hover:scale-110 transition-transform duration-500">
                                <Plus size={48} strokeWidth={3} />
                            </div>
                            <div className="max-w-2xl">
                                <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter mb-4">Sincronización Universal</h2>
                                <p className="text-slate-400 text-sm md:text-lg font-medium opacity-80 leading-relaxed">
                                    Añade tus películas desde cualquier ordenador usando el explorador de Windows clásico. CineVault reconocerá instantáneamente tus archivos y los añadirá a tu bóveda con carátulas y metadatos.
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={() => onTabChange('upload')}
                            className="w-full lg:w-auto px-16 py-8 bg-white text-black text-xs md:text-sm font-black uppercase tracking-[0.3em] rounded-[2rem] hover:bg-netflix-red hover:text-white transition-all duration-500 shadow-2xl active:scale-95 group/btn overflow-hidden relative"
                        >
                            <span className="relative z-10">Ir a Sincronizar</span>
                        </button>
                    </div>
                </section>

                {/* 2. Secondary Settings Grid */}
                <div className="grid grid-cols-1 gap-12">
                    {/* Storage Management (Full Width for list visibility) */}
                    <section className="glass rounded-[3rem] p-8 md:p-12 border border-white/5 flex flex-col min-h-[400px]">
                        <div className="flex items-center gap-6 mb-12">
                            <div className="p-5 bg-netflix-red/10 rounded-3xl border border-netflix-red/20 shadow-inner">
                                <Database className="text-netflix-red" size={32} />
                            </div>
                            <div>
                                <h3 className="text-3xl font-black text-white tracking-tight uppercase italic underline decoration-netflix-red decoration-4 transition-all hover:decoration-white">Vault Storage</h3>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.3em] mt-1">Carpetas locales vinculadas al servidor</p>
                            </div>
                        </div>

                        <div className="flex-1 space-y-4 mb-12 bg-black/40 rounded-[2.5rem] p-8 border border-white/[0.03] shadow-inner">
                            {folders.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-30">
                                    <Folder size={64} strokeWidth={1} className="mb-6" />
                                    <p className="text-sm font-black uppercase tracking-[0.5em]">La bóveda está vacía</p>
                                </div>
                            ) : (
                                folders.map((folder, index) => (
                                    <div key={index} className="flex justify-between items-center p-6 bg-white/[0.02] border border-white/5 rounded-2xl group hover:bg-white/[0.06] transition-all duration-500">
                                        <div className="flex items-center gap-6 min-w-0">
                                            <Folder size={20} className="text-slate-600 group-hover:text-netflix-red transition-colors" />
                                            <span className="text-sm font-bold text-slate-400 group-hover:text-white truncate tracking-tight">{folder}</span>
                                        </div>
                                        <button 
                                            onClick={() => handleDeleteFolder(folder)}
                                            className="p-4 text-slate-600 hover:text-netflix-red hover:bg-netflix-red/10 rounded-xl transition-all"
                                        >
                                            <Trash2 size={24} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <button 
                            onClick={handleAddFolder}
                            disabled={isAdding}
                            className="w-full py-8 bg-white/5 text-white border border-white/10 text-xs md:text-sm font-black uppercase tracking-[0.4em] rounded-[2rem] hover:bg-white/10 active:scale-95 transition-all shadow-[0_0_40px_rgba(0,0,0,0.5)] flex items-center justify-center gap-4"
                        >
                            <Plus size={24} />
                            Añadir Disco o Carpeta Local
                        </button>
                    </section>

                    {/* API & Cloud Dashboard - FULL WIDTH STACKED */}
                    <div className="flex flex-col gap-12">
                        {/* TMDB Metadatos */}
                        <section className="glass rounded-[3rem] p-8 md:p-14 border border-white/5 relative overflow-hidden group">
                           <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity rotate-12">
                                <ShieldCheck size={300} strokeWidth={1} />
                            </div>
                            
                            <div className="relative z-10">
                                <div className="flex items-center gap-8 mb-12">
                                    <div className="p-6 bg-netflix-red/10 rounded-[2rem] border border-netflix-red/20 shadow-inner">
                                        <ShieldCheck className="text-netflix-red" size={40} />
                                    </div>
                                    <div>
                                        <h3 className="text-4xl font-black text-white tracking-tighter uppercase italic">TMDb Engine</h3>
                                        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">Sincronización de Cartelería y Arte</p>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <label className="block text-xs font-black text-slate-500 uppercase tracking-[0.5em] mb-4 ml-2">API ACCESS KEY (V3)</label>
                                    <div className="flex flex-col lg:flex-row gap-6">
                                        <input 
                                            type="password"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder="Introduce tu API Key de TheMovieDB..."
                                            className="flex-1 bg-black/60 border border-white/10 rounded-[2rem] px-10 py-7 text-lg text-white focus:outline-none focus:border-netflix-red transition-all shadow-inner placeholder:text-slate-800 placeholder:uppercase"
                                        />
                                        <button 
                                            onClick={handleSaveKey}
                                            className={`flex items-center justify-center rounded-[2rem] h-[86px] min-w-[240px] font-black uppercase tracking-[0.3em] transition-all duration-500 shadow-2xl ${isSaved ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-slate-200 active:scale-95'}`}
                                        >
                                            {isSaved ? <Check size={32} strokeWidth={4} /> : <span className="text-sm">Guardar Cambios</span>}
                                        </button>
                                    </div>
                                    <p className="text-[11px] text-slate-600 font-bold uppercase tracking-[0.2em] px-4">Necesario para descargar posters y sinopsis automáticamente</p>
                                </div>
                            </div>
                        </section>

                        {/* Real-Debrid / Bóveda Cloud */}
                        {isAdmin() && (
                            <section className="glass rounded-[3rem] p-8 md:p-14 border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity -rotate-12">
                                    <Cloud size={300} strokeWidth={1} />
                                </div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-8 mb-12">
                                        <div className="p-6 bg-netflix-red/10 rounded-[2rem] border border-netflix-red/20 shadow-inner">
                                            <Cloud className="text-netflix-red" size={40} />
                                        </div>
                                        <div>
                                            <h3 className="text-4xl font-black text-white tracking-tighter uppercase italic">Bóveda Cloud</h3>
                                            <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">Real-Debrid Premium Integration</p>
                                        </div>
                                    </div>

                                    <div className="space-y-8">
                                        <div className="space-y-6">
                                            <label className="block text-xs font-black text-slate-500 uppercase tracking-[0.5em] mb-4 ml-2">REAL-DEBRID PRIVATE TOKEN</label>
                                            <div className="flex flex-col lg:flex-row gap-6">
                                                <input 
                                                    type="password"
                                                    value={rdToken}
                                                    onChange={(e) => setRdToken(e.target.value)}
                                                    placeholder="Tu Token Privado (apibay/apitoken)..."
                                                    className="flex-1 bg-black/60 border border-white/10 rounded-[2rem] px-10 py-7 text-lg text-white focus:outline-none focus:border-netflix-red transition-all shadow-inner placeholder:text-slate-800 placeholder:uppercase"
                                                />
                                                <button 
                                                    onClick={handleSaveRDToken}
                                                    className={`flex items-center justify-center rounded-[2rem] h-[86px] min-w-[240px] font-black uppercase tracking-[0.3em] transition-all duration-500 shadow-2xl ${isRDSaved ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-slate-200 active:scale-95'}`}
                                                >
                                                    {isRDSaved ? <Check size={32} strokeWidth={4} /> : <span className="text-sm">Vincular Bóveda</span>}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="bg-white/[0.02] p-8 md:p-10 rounded-[3rem] border border-white/[0.05] shadow-inner">
                                            <p className="text-xs md:text-base text-slate-400 font-medium leading-relaxed mb-6">
                                                Desbloquea el poder del streaming instantáneo. Tus archivos se descargarán de forma privada a 1Gbps directamente a Google Drive sin usar tu conexión local.
                                            </p>
                                            <div className="flex flex-wrap gap-4">
                                                <a href="https://real-debrid.com/apitoken" target="_blank" rel="noreferrer" className="flex items-center gap-3 px-6 py-3 bg-white/5 rounded-xl text-netflix-red font-black uppercase tracking-widest text-xs hover:bg-netflix-red hover:text-white transition-all">
                                                    Obtener Token <ExternalLink size={14} />
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}
                    </div>
                </div>

                {/* 3. Session Management Dashboard */}
                {isAdmin() && (
                    <section className="glass rounded-[3rem] p-8 md:p-16 border border-white/5 shadow-2xl relative overflow-hidden group">
                        <div className="absolute -bottom-12 -left-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity">
                            <Settings size={300} strokeWidth={1} />
                        </div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-6 mb-12">
                                <div className="p-6 bg-white/[0.05] rounded-[2rem] border border-white/10 shadow-inner">
                                    <Settings className="text-white" size={32} />
                                </div>
                                <div>
                                    <h3 className="text-3xl font-black text-white tracking-tighter">Control de Acceso</h3>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Gestión de sesiones activas en el servidor</p>
                                </div>
                            </div>
                            <div className="bg-black/30 rounded-[2rem] border border-white/[0.03] overflow-hidden">
                                <SessionsManager />
                            </div>
                        </div>
                    </section>
                )}

                {/* 4. Google Drive Integration Card */}
                <section className="glass rounded-[3rem] p-8 md:p-16 border border-white/5 shadow-2xl relative overflow-hidden">
                    <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
                        <div className="flex flex-col md:flex-row items-center gap-10">
                            <div className={`p-10 rounded-[2.5rem] shadow-inner transition-all duration-700 ${isDriveConnected ? 'bg-green-500/10 border border-green-500/20' : 'bg-blue-500/10 border border-blue-500/20'}`}>
                                <Cloud className={isDriveConnected ? 'text-green-500' : 'text-blue-500'} size={48} />
                            </div>
                            <div className="text-center md:text-left">
                                <h3 className="text-3xl md:text-5xl font-black text-white tracking-tighter mb-4">Sincronización Cloud</h3>
                                <div className="flex items-center justify-center md:justify-start gap-4 p-3 bg-black/20 rounded-2xl border border-white/[0.03] w-fit mx-auto md:mx-0">
                                    <div className={`w-3 h-3 rounded-full ${isDriveConnected ? 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.8)] animate-pulse' : 'bg-slate-600'}`}></div>
                                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                                        Google Drive: {isDriveConnected ? <span className="text-green-400">Activo</span> : 'Desconectado'}
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
                            className={`w-full lg:w-auto px-16 py-8 font-black uppercase tracking-[0.3em] text-xs md:text-sm rounded-[2rem] transition-all duration-500 shadow-2xl active:scale-95 flex items-center justify-center gap-4 ${isDriveConnected ? 'bg-netflix-red/10 text-netflix-red border border-netflix-red/20 hover:bg-netflix-red hover:text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                        >
                            <Cloud size={24} />
                            {isDriveConnected ? 'Reiniciar Conexión' : 'Vincular Google Drive'}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default SettingsPage;
