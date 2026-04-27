import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Folder, ExternalLink, ShieldCheck, Database, Check, Cloud, CloudOff, UserPlus, X, Files, Settings, Shield, Subtitles, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUploadQueue } from '../context/UploadQueueContext';
import { api, BACKEND_URL } from '../api';
import SessionsManager from '../components/SessionsManager';

function SettingsPage({ onClose, onTabChange }) {
    const { isAdmin } = useAuth();
    const [folders, setFolders] = useState([]);
    const [apiKey, setApiKey] = useState('');
    const [isSaved, setIsSaved] = useState(false);
    const [omdbKey, setOmdbKey] = useState('');
    const [isOMDBSaved, setIsOMDBSaved] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [isDriveConnected, setIsDriveConnected] = useState(false);
    const [rdToken, setRdToken] = useState('');
    const [isRDSaved, setIsRDSaved] = useState(false);
    const [osUsername, setOsUsername] = useState('');
    const [osPassword, setOsPassword] = useState('');
    const [isOSSaved, setIsOSSaved] = useState(false);
    const [stuckUploads, setStuckUploads] = useState([]);
    const [isCheckingStuck, setIsCheckingStuck] = useState(false);

    const handleRemoveStuck = async (movieId, title) => {
        if (!window.confirm(`¿Seguro que quieres eliminar "${title}" del Panel de Restauración? Esto limpiará la entrada huérfana de la base de datos.`)) return;
        
        try {
            await api.deleteMovie(movieId);
            setStuckUploads(prev => prev.filter(m => m.id !== movieId));
        } catch (error) {
            console.error('Error al eliminar peli huérfana:', error);
            alert('Error al eliminar: ' + error.message);
        }
    };
    const { queue, removeFromQueue, retryQueueItem } = useUploadQueue();

    const fetchConfig = async () => {
        try {
            const foldersData = await api.getFolders();
            setFolders(foldersData.map(f => f.folder_path));

            const key = await api.getTMDBKey();
            if (key) { setApiKey(key); setIsSaved(true); }

            const oKey = await api.getOMDbKey();
            if (oKey) { setOmdbKey(oKey); setIsOMDBSaved(true); }

            const connected = await api.checkDriveAuth();
            setIsDriveConnected(connected);

            if (isAdmin) {
                const rdData = await api.getRDToken();
                if (rdData.token) setRdToken(rdData.token);
                
                const osData = await api.getOSCredentials();
                if (osData.username) setOsUsername(osData.username);
                if (osData.password) setOsPassword(osData.password);

                // Fetch stuck uploads
                fetchStuckUploads();
            }
        } catch (error) {
            console.error('Error fetching config:', error);
        }
    };

    const fetchStuckUploads = async () => {
        if (!isAdmin()) return;
        setIsCheckingStuck(true);
        try {
            const stuck = await api.getStuckUploads();
            setStuckUploads(stuck || []);
        } catch (err) {
            console.error('Error fetching stuck uploads:', err);
        } finally {
            setIsCheckingStuck(false);
        }
    };

    const handleRetryStuck = async (movieId) => {
        try {
            await api.retryStuckUpload(movieId);
            // Refresh both
            fetchStuckUploads();
            // The uploadQueue context should pick up the new job automatically via its SSE/polling
        } catch (err) {
            alert(`Error al reintentar: ${err.message}`);
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

    const handleSaveOMDbKey = async () => {
        try {
            await api.saveOMDbKey(omdbKey);
            setIsOMDBSaved(true);
            setTimeout(() => setIsOMDBSaved(false), 3000);
        } catch (error) {
            alert('Error al guardar la API Key de OMDb');
        }
    };

    const handleRefreshLatino = async () => {
        if (!window.confirm('¿Quieres actualizar toda tu biblioteca al Español Latino? Esto cambiará títulos y sinopsis de las películas que ya tienes agregadas.')) return;
        try {
            const result = await api.refreshMetadata();
            alert(result.message || 'Biblioteca actualizada correctamente.');
        } catch (error) {
            alert('Error al actualizar: ' + error.message);
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

    const handleSaveOSCredentials = async () => {
        try {
            await api.saveOSCredentials(osUsername, osPassword);
            setIsOSSaved(true);
            setTimeout(() => setIsOSSaved(false), 3000);
        } catch (error) {
            alert('Error al guardar credenciales de OpenSubtitles');
        }
    };

    return (
        <div className="p-4 md:p-12 pb-40 max-w-7xl mx-auto animate-fade-in relative z-10 no-drag">
            <header className="mb-12 md:mb-24 text-center md:text-left">
                <div className="flex flex-col md:flex-row items-center gap-2 md:gap-4 mb-6">
                    <div className="w-12 h-[3px] bg-netflix-red rounded-full hidden md:block"></div>
                    <span className="text-[10px] md:text-[12px] font-black uppercase tracking-[0.5em] text-white/90 glow-text">CineVault Control Center</span>
                </div>
                <h1 className="text-3xl md:text-8xl font-black tracking-tighter text-white mb-6 leading-none select-none">
                    <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-200 to-slate-500">Configuración</span>
                </h1>
                <p className="text-slate-500 text-[10px] md:text-base font-bold tracking-widest uppercase opacity-60">Personaliza y potencia tu experiencia cinematográfica de élite.</p>
            </header>

            <div className="grid gap-12">
                {/* 1. Primary Action: Universal Sync */}
                <section className="glass rounded-[2rem] md:rounded-[3rem] p-6 md:p-16 border border-white/5 shadow-2xl relative overflow-hidden group">
                    <div className="absolute -top-24 -right-24 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-all duration-700 rotate-12 scale-150">
                        <Files size={400} strokeWidth={1} />
                    </div>
                    
                    <div className="flex flex-col lg:flex-row items-center justify-between gap-8 md:gap-12 relative z-10">
                        <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12 text-center md:text-left">
                            <div className="p-6 md:p-10 bg-white text-black rounded-[2rem] md:rounded-[2.5rem] shadow-[0_0_50px_rgba(255,255,255,0.2)] hover:scale-110 transition-transform duration-500">
                                <Plus size={32} md:size={48} strokeWidth={3} />
                            </div>
                            <div className="max-w-2xl">
                                <h2 className="text-2xl md:text-5xl font-black text-white tracking-tighter mb-3 md:mb-4">Sincronización Universal</h2>
                                <p className="text-slate-400 text-xs md:text-lg font-medium opacity-80 leading-relaxed">
                                    Añade tus películas desde cualquier ordenador usando el explorador de Windows clásico. CineVault reconocerá instantáneamente tus archivos y los añadirá a tu bóveda con carátulas y metadatos.
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={() => onTabChange('upload')}
                            className="w-full lg:w-auto px-8 md:px-16 py-5 md:py-8 bg-white text-black text-[10px] md:text-sm font-black uppercase tracking-[0.2em] md:tracking-[0.3em] rounded-[1.5rem] md:rounded-[2rem] hover:bg-netflix-red hover:text-white transition-all duration-500 shadow-2xl active:scale-95 group/btn overflow-hidden relative"
                        >
                            <span className="relative z-10">Ir a Sincronizar</span>
                        </button>
                    </div>
                </section>

                {/* 2. Secondary Settings Grid */}
                <div className="grid grid-cols-1 gap-12">
                    {/* Storage Management (Full Width for list visibility) */}
                    <section className="glass rounded-[2rem] md:rounded-[3rem] p-6 md:p-12 border border-white/5 flex flex-col min-h-[300px] md:min-h-[400px]">
                        <div className="flex items-center gap-4 md:gap-6 mb-8 md:mb-12">
                            <div className="p-3 md:p-5 bg-netflix-red/10 rounded-2xl md:rounded-3xl border border-netflix-red/20 shadow-inner">
                                <Database className="text-netflix-red" size={24} md:size={32} />
                            </div>
                            <div>
                                <h3 className="text-xl md:text-3xl font-black text-white tracking-tight uppercase italic underline decoration-netflix-red decoration-2 md:decoration-4 transition-all hover:decoration-white">Vault Storage</h3>
                                <p className="text-[8px] md:text-xs font-bold text-slate-500 uppercase tracking-[0.2em] md:tracking-[0.3em] mt-1">Carpetas locales vinculadas al servidor</p>
                            </div>
                        </div>

                        <div className="flex-1 space-y-3 md:space-y-4 mb-8 md:mb-12 bg-black/40 rounded-[1.5rem] md:rounded-[2.5rem] p-4 md:p-8 border border-white/[0.03] shadow-inner max-h-[300px] md:max-h-none overflow-y-auto">
                            {folders.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center py-10 md:py-20 opacity-30">
                                    <Folder size={48} md:size={64} strokeWidth={1} className="mb-4 md:mb-6" />
                                    <p className="text-[10px] md:text-sm font-black uppercase tracking-[0.4em] md:tracking-[0.5em]">La bóveda está vacía</p>
                                </div>
                            ) : (
                                folders.map((folder, index) => (
                                    <div key={index} className="flex justify-between items-center p-4 md:p-6 bg-white/[0.02] border border-white/5 rounded-xl md:rounded-2xl group hover:bg-white/[0.06] transition-all duration-500">
                                        <div className="flex items-center gap-3 md:gap-6 min-w-0 flex-1">
                                            <Folder size={16} md:size={20} className="text-slate-600 group-hover:text-netflix-red transition-colors shrink-0" />
                                            <span className="text-xs md:text-sm font-bold text-slate-400 group-hover:text-white truncate tracking-tight">{folder}</span>
                                        </div>
                                        <button 
                                            onClick={() => handleDeleteFolder(folder)}
                                            className="p-2 md:p-4 text-slate-600 hover:text-netflix-red hover:bg-netflix-red/10 rounded-xl transition-all"
                                        >
                                            <Trash2 size={18} md:size={24} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <button 
                            onClick={handleAddFolder}
                            disabled={isAdding}
                            className="w-full py-5 md:py-8 bg-white/5 text-white border border-white/10 text-[10px] md:text-sm font-black uppercase tracking-[0.3em] md:tracking-[0.4em] rounded-[1.5rem] md:rounded-[2rem] hover:bg-white/10 active:scale-95 transition-all shadow-[0_0_40px_rgba(0,0,0,0.5)] flex items-center justify-center gap-3 md:gap-4"
                        >
                            <Plus size={20} md:size={24} />
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
                                        <h3 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase italic">TMDb Engine</h3>
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

                        {/* OMDb Metadatos (Rotten Tomatoes) */}
                        <section className="glass rounded-[3rem] p-8 md:p-14 border border-white/5 relative overflow-hidden group">
                           <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity -rotate-12">
                                <Database size={300} strokeWidth={1} />
                            </div>
                            
                            <div className="relative z-10">
                                <div className="flex items-center gap-8 mb-12">
                                    <div className="p-6 bg-yellow-500/10 rounded-[2rem] border border-yellow-500/20 shadow-inner">
                                        <Database className="text-yellow-500" size={40} />
                                    </div>
                                    <div>
                                        <h3 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase italic">OMDb Engine</h3>
                                        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">Puntuaciones de Rotten Tomatoes y Metacritic</p>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <label className="block text-xs font-black text-slate-500 uppercase tracking-[0.5em] mb-4 ml-2">OMDB API KEY (FREE/PAID)</label>
                                    <div className="flex flex-col lg:flex-row gap-6">
                                        <input 
                                            type="password"
                                            value={omdbKey}
                                            onChange={(e) => setOmdbKey(e.target.value)}
                                            placeholder="Introduce tu API Key de OMDb..."
                                            className="flex-1 bg-black/60 border border-white/10 rounded-[2rem] px-10 py-7 text-lg text-white focus:outline-none focus:border-yellow-500 transition-all shadow-inner placeholder:text-slate-800 placeholder:uppercase"
                                        />
                                        <button 
                                            onClick={handleSaveOMDbKey}
                                            className={`flex items-center justify-center rounded-[2rem] h-[86px] min-w-[240px] font-black uppercase tracking-[0.3em] transition-all duration-500 shadow-2xl ${isOMDBSaved ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-slate-200 active:scale-95'}`}
                                        >
                                            {isOMDBSaved ? <Check size={32} strokeWidth={4} /> : <span className="text-sm">Vincular OMDb</span>}
                                        </button>
                                    </div>
                                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 px-4">
                                        <p className="text-[11px] text-slate-600 font-bold uppercase tracking-[0.2em]">Necesario para mostrar puntuaciones críticas de Rotten Tomatoes</p>
                                        <div className="flex flex-wrap gap-3">
                                            <button 
                                                onClick={handleRefreshLatino}
                                                className="flex items-center gap-3 px-6 py-3 bg-netflix-red/10 hover:bg-netflix-red border border-netflix-red/20 rounded-full text-[10px] font-black uppercase tracking-widest text-netflix-red hover:text-white transition-all group"
                                            >
                                                <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
                                                Pasar Biblioteca a Latino
                                            </button>
                                            {isOMDBSaved && (
                                                <button 
                                                    onClick={handleRefreshAllMetadata}
                                                    className="flex items-center gap-3 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-all group"
                                                >
                                                    <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
                                                    Refrescar Puntuaciones
                                                </button>
                                            )}
                                        </div>
                                    </div>
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
                                            <h3 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase italic">Bóveda Cloud</h3>
                                            <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">Real-Debrid Premium Integration</p>
                                        </div>
                                    </div>

                                    <div className="space-y-8">
                                        <div className="space-y-6">
                                            <label className="block text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-[0.4em] md:tracking-[0.5em] mb-3 md:mb-4 ml-2">REAL-DEBRID PRIVATE TOKEN</label>
                                            <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                                                <input 
                                                    type="password"
                                                    value={rdToken}
                                                    onChange={(e) => setRdToken(e.target.value)}
                                                    placeholder="Tu Token Privado..."
                                                    className="flex-1 bg-black/60 border border-white/10 rounded-[1.5rem] md:rounded-[2rem] px-6 md:px-10 py-5 md:py-7 text-sm md:text-lg text-white focus:outline-none focus:border-netflix-red transition-all shadow-inner placeholder:text-slate-800"
                                                />
                                                <button 
                                                    onClick={handleSaveRDToken}
                                                    className={`flex items-center justify-center rounded-[1.5rem] md:rounded-[2rem] h-[60px] md:h-[86px] min-w-full md:min-w-[240px] font-black uppercase tracking-[0.2em] md:tracking-[0.3em] transition-all duration-500 shadow-2xl ${isRDSaved ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-slate-200 active:scale-95'}`}
                                                >
                                                    {isRDSaved ? <Check size={28} md:size={32} strokeWidth={4} /> : <span className="text-[10px] md:text-sm">Vincular Bóveda</span>}
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

                        {/* OpenSubtitles Config */}
                        {isAdmin() && (
                            <section className="glass rounded-[3rem] p-8 md:p-14 border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity rotate-12">
                                    <Files size={300} strokeWidth={1} />
                                </div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-8 mb-12">
                                        <div className="p-6 bg-netflix-red/10 rounded-[2rem] border border-netflix-red/20 shadow-inner">
                                            <Subtitles className="text-netflix-red" size={40} />
                                        </div>
                                        <div>
                                            <h3 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase italic">OpenSubtitles VIP</h3>
                                            <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">Elimina los límites de descarga 5/día</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            <div className="space-y-3">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em] ml-4 italic">Usuario</label>
                                                <input 
                                                    type="text"
                                                    value={osUsername}
                                                    onChange={(e) => setOsUsername(e.target.value)}
                                                    placeholder="Tu usuario de OpenSubtitles..."
                                                    className="w-full bg-black/60 border border-white/10 rounded-[2rem] px-10 py-7 text-lg text-white focus:outline-none focus:border-netflix-red transition-all shadow-inner"
                                                />
                                            </div>
                                            <div className="space-y-3">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em] ml-4 italic">Contraseña</label>
                                                <input 
                                                    type="password"
                                                    value={osPassword}
                                                    onChange={(e) => setOsPassword(e.target.value)}
                                                    placeholder="Tu contraseña..."
                                                    className="w-full bg-black/60 border border-white/10 rounded-[2rem] px-10 py-7 text-lg text-white focus:outline-none focus:border-netflix-red transition-all shadow-inner"
                                                />
                                            </div>
                                        </div>
                                        <button 
                                            onClick={handleSaveOSCredentials}
                                            className={`w-full flex items-center justify-center rounded-[2rem] h-[86px] font-black uppercase tracking-[0.3em] transition-all duration-500 shadow-2xl ${isOSSaved ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-slate-200 active:scale-95'}`}
                                        >
                                            {isOSSaved ? <Check size={32} strokeWidth={4} /> : <span className="text-sm">Guardar Credenciales VIP</span>}
                                        </button>
                                        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest text-center">
                                            Si tienes cuenta VIP, introduce tus datos para obtener 1000 descargas diarias en lugar del límite gratuito (5).
                                        </p>
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* 2.5 Cloud Status Dashboard */}
                        {isAdmin() && (
                            <section className="glass rounded-[3rem] p-8 md:p-14 border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity rotate-45">
                                    <Cloud size={300} strokeWidth={1} />
                                </div>
                                
                                <div className="relative z-10">
                                    <div className="flex items-center gap-8 mb-12">
                                        <div className="p-6 bg-netflix-red/10 rounded-[2rem] border border-netflix-red/20 shadow-inner">
                                            <Cloud className="text-netflix-red" size={40} />
                                        </div>
                                        <div>
                                            <h3 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase italic">Estado de Colas</h3>
                                            <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">Trasmisiones en segundo plano y subidas</p>
                                        </div>
                                    </div>

                                    {queue.length === 0 ? (
                                        <div className="bg-white/[0.02] p-16 rounded-[2.5rem] border border-white/5 text-center flex flex-col items-center gap-4 opacity-40">
                                            <Check size={48} className="text-green-500 mb-2" />
                                            <p className="text-sm font-black uppercase tracking-[0.4em]">Sin tareas pendientes</p>
                                            <p className="text-xs font-bold text-slate-500">Todos tus archivos están sincronizados en la nube.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {queue.map((job) => (
                                                <div key={job.id} className="flex flex-col md:flex-row items-stretch md:items-center gap-4 md:gap-6 p-4 md:p-6 bg-white/[0.03] border border-white/5 rounded-[1.5rem] md:rounded-[2rem] hover:bg-white/[0.06] transition-all group">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-3 mb-3">
                                                            <span className={`shrink-0 px-2 py-0.5 rounded text-[7px] md:text-[8px] font-black uppercase tracking-tighter ${
                                                                job.status === 'done' ? 'bg-green-500/20 text-green-400' :
                                                                job.status === 'error' ? 'bg-red-500/20 text-red-400' :
                                                                'bg-cyan-500/20 text-cyan-400'
                                                            }`}>
                                                                {job.status}
                                                            </span>
                                                            <h4 className="text-xs md:text-sm font-black text-white truncate max-w-[200px] md:max-w-none">{job.title}</h4>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex-1 h-1 md:h-1.5 bg-black/40 rounded-full overflow-hidden">
                                                                <div 
                                                                    className={`h-full transition-all duration-700 ${
                                                                        job.status === 'error' ? 'bg-red-500' : 
                                                                        job.status === 'done' ? 'bg-green-500' : 'bg-cyan-500'
                                                                    }`}
                                                                    style={{ width: `${job.progress}%` }}
                                                                ></div>
                                                            </div>
                                                            <span className="shrink-0 text-[10px] md:text-xs font-black text-slate-400">{Math.round(job.progress)}%</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-end gap-3 md:gap-4 shrink-0 pt-2 md:pt-0 border-t border-white/5 md:border-t-0">
                                                        {job.status === 'error' && (
                                                            <button 
                                                                onClick={() => retryQueueItem(job.id)}
                                                                className="p-2 md:p-3 bg-white/5 hover:bg-white text-white hover:text-black rounded-lg md:rounded-xl transition-all"
                                                                title="Reintentar"
                                                            >
                                                                <RefreshCw size={14} md:size={16} />
                                                            </button>
                                                        )}
                                                        <button 
                                                            onClick={() => removeFromQueue(job.id)}
                                                            className="p-2 md:p-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-lg md:rounded-xl transition-all"
                                                            title="Eliminar de la cola"
                                                        >
                                                            <Trash2 size={14} md:size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* 2.6 Resilience Panel (Stuck Uploads) */}
                        {isAdmin() && stuckUploads.length > 0 && (
                            <section className="glass rounded-[3rem] p-8 md:p-14 border border-white/5 relative overflow-hidden group bg-orange-500/5">
                                <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity">
                                    <Database size={300} strokeWidth={1} />
                                </div>
                                <div className="relative z-10">
                                    <div className="flex items-center justify-between mb-12">
                                        <div className="flex items-center gap-8">
                                            <div className="p-6 bg-orange-500/10 rounded-[2rem] border border-orange-500/20 shadow-inner">
                                                <Database className="text-orange-500" size={40} />
                                            </div>
                                            <div>
                                                <h3 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase italic">Panel de Restauración</h3>
                                                <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">Huéspedes detectados (pendientes en DB pero no en cola)</p>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={fetchStuckUploads}
                                            className="p-4 hover:bg-white/5 rounded-full text-slate-400 hover:text-white transition-all"
                                            disabled={isCheckingStuck}
                                        >
                                            <RefreshCw size={24} className={isCheckingStuck ? 'animate-spin' : ''} />
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-6 mb-6">
                                            <p className="text-sm text-orange-200/70 font-medium">
                                                Se han detectado películas registradas que nunca terminaron de subirse a Google Drive y no están siendo procesadas actualmente. Dale a "Restaurar" para intentar re-encolarlas.
                                            </p>
                                        </div>
                                        {stuckUploads.map((movie) => {
                                            const isRecoverable = !!movie.cloud_source_url;
                                            return (
                                                <div key={movie.id} className="flex flex-col md:flex-row items-center justify-between p-6 bg-black/40 border border-white/5 rounded-[2rem] hover:bg-black/60 transition-all gap-6">
                                                    <div className="flex items-center gap-4 w-full">
                                                        <div className="w-12 h-18 bg-slate-800 rounded-lg overflow-hidden shrink-0">
                                                            {movie.poster_url && <img src={movie.poster_url} alt="" className="w-full h-full object-cover" />}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <h4 className="font-bold text-white uppercase tracking-tight truncate">{movie.official_title || movie.detected_title}</h4>
                                                            <div className="flex items-center gap-3 mt-1">
                                                                <p className="text-[10px] text-slate-500 font-black tracking-widest uppercase">ID: {movie.id}</p>
                                                                {!isRecoverable && (
                                                                    <span className="text-[9px] font-black uppercase tracking-tighter text-red-500/80 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">Irrecuperable</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-3 w-full md:w-auto">
                                                        {isRecoverable ? (
                                                            <button 
                                                                onClick={() => handleRetryStuck(movie.id)}
                                                                className="flex-1 md:flex-none px-8 py-4 bg-orange-600 text-white font-black uppercase tracking-widest text-[10px] rounded-xl hover:bg-orange-500 transition-all shadow-lg active:scale-95"
                                                            >
                                                                Restaurar
                                                            </button>
                                                        ) : (
                                                            <button 
                                                                onClick={() => handleRemoveStuck(movie.id, movie.official_title || movie.detected_title)}
                                                                className="flex-1 md:flex-none px-8 py-4 bg-red-600/20 text-red-500 border border-red-500/30 font-black uppercase tracking-widest text-[10px] rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-lg active:scale-95"
                                                            >
                                                                Eliminar Registro
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>
                        )}
                    </div>
                </div>


                {/* 4. Session Management Dashboard */}
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

                {/* 5. Google Drive Integration Card */}
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
