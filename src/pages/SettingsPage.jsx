import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Folder, ExternalLink, ShieldCheck, Database, Check } from 'lucide-react';

function SettingsPage() {
    const [folders, setFolders] = useState([]);
    const [apiKey, setApiKey] = useState('');
    const [isSaved, setIsSaved] = useState(false);
    const [isAdding, setIsAdding] = useState(false);

    const fetchConfig = async () => {
        try {
            if (window.electronAPI) {
                const foldersData = await window.electronAPI.getFolders();
                setFolders(foldersData.map(f => f.folder_path));

                const key = await window.electronAPI.getTMDBKey();
                if (key) {
                    setApiKey(key);
                    setIsSaved(true);
                }
            }
        } catch (error) {
            console.error('Error fetching config:', error);
        }
    };

    useEffect(() => {
        fetchConfig();
    }, []);

    const handleAddFolder = async () => {
        if (!window.electronAPI) {
            alert('Error: Electron API no detectada. ¿Estás ejecutando la app en un navegador?');
            return;
        }

        setIsAdding(true);
        try {
            console.log('Solicitando apertura de diálogo...');
            const paths = await window.electronAPI.openDirectory();
            console.log('Caminos recibidos:', paths);

            if (paths && paths.length > 0) {
                await fetchConfig();
            }
        } catch (error) {
            console.error('Error en handleAddFolder:', error);
            alert(`Error al agregar carpeta: ${error.message}`);
        } finally {
            setIsAdding(false);
        }
    };

    const handleDeleteFolder = async (path) => {
        if (window.electronAPI) {
            await window.electronAPI.removeFolder(path);
            fetchConfig();
        }
    };

    return (
        <div className="p-12 pb-40 max-w-5xl mx-auto animate-fade-in relative z-10 no-drag">
            <header className="mb-20">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-[2px] bg-netflix-red/60 rounded-full"></div>
                    <span className="text-[11px] font-black uppercase tracking-[0.6em] text-white/90 glow-text">CineVault Experience</span>
                </div>
                <h1 className="text-7xl font-black tracking-tighter text-white mb-6 leading-none drop-shadow-2xl">
                    <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-300 to-netflix-red">Ajustes</span>
                </h1>
                <p className="text-slate-500 text-sm font-bold tracking-widest uppercase opacity-60">Configura tu centro de control cinematográfico.</p>
            </header>

            <div className="grid gap-12">
                {/* Library Folders Section */}
                <section className="glass rounded-[3rem] overflow-hidden animate-fade-in-up shadow-2xl">
                    <div className="p-10 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                        <div className="flex items-center gap-6">
                            <div className="p-5 bg-netflix-red/10 rounded-3xl border border-netflix-red/20 shadow-inner">
                                <Folder className="text-netflix-red" size={32} strokeWidth={2.5} />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black text-white tracking-tight">Carpetas de Origen</h2>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1 opacity-60">Gestiona tus directorios locales</p>
                            </div>
                        </div>
                        <button
                            onClick={handleAddFolder}
                            disabled={isAdding}
                            className={`flex items-center gap-3 px-8 py-4 bg-white text-black font-black rounded-[1.5rem] hover:bg-neutral-200 active:scale-95 transition-all duration-700 shadow-[0_20px_45px_-10px_rgba(255,255,255,0.2)] ${isAdding ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <Plus size={22} strokeWidth={4} className={isAdding ? 'animate-spin' : ''} />
                            <span className="uppercase tracking-widest text-xs">{isAdding ? 'Cargando' : 'Agregar'}</span>
                        </button>
                    </div>

                    <div className="divide-y divide-white/5">
                        {folders.length === 0 ? (
                            <div className="p-24 text-center">
                                <div className="inline-block p-6 bg-white/5 rounded-[2rem] mb-6 text-slate-700">
                                    <Folder size={48} strokeWidth={1} />
                                </div>
                                <p className="text-slate-500 text-sm font-bold uppercase tracking-[0.2em] opacity-40">No hay rutas configuradas</p>
                            </div>
                        ) : (
                            folders.map((folder, index) => (
                                <div key={index} className="p-8 flex justify-between items-center hover:bg-white/[0.02] transition-all group">
                                    <div className="flex items-center gap-6">
                                        <div className="w-2.5 h-2.5 bg-netflix-red/20 rounded-full group-hover:bg-netflix-red group-hover:shadow-[0_0_10px_rgba(229,9,20,0.8)] transition-all duration-500"></div>
                                        <span className="text-sm font-bold text-slate-400 group-hover:text-slate-200 transition-colors truncate max-w-xl tracking-tight">{folder}</span>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteFolder(folder)}
                                        className="p-4 text-slate-600 hover:text-red-500 hover:bg-red-500/10 rounded-2xl transition-all duration-500"
                                    >
                                        <Trash2 size={20} strokeWidth={2.5} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                {/* API & Metadata Section */}
                <section className="glass rounded-[3rem] p-10 animate-fade-in-up shadow-2xl" style={{ animationDelay: '100ms' }}>
                    <div className="flex items-center gap-6 mb-12">
                        <div className="p-5 bg-cyan-500/10 rounded-3xl border border-cyan-500/20 shadow-inner">
                            <Database className="text-cyan-500" size={32} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-white tracking-tight">API & Conectividad</h2>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1 opacity-60">Sincronización de metadatos globales</p>
                        </div>
                    </div>

                    <div className="space-y-8">
                        <div className="p-10 bg-white/[0.01] border border-white/10 rounded-[2.5rem] shadow-inner">
                            <div className="flex justify-between items-center mb-6">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.3em] opacity-60">The Movie Database (TMDb)</label>
                                {isSaved && (
                                    <div className="flex items-center gap-2 text-gold-500 animate-fade-in">
                                        <Check size={14} strokeWidth={4} />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white">Configurado Correctamente</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col md:flex-row gap-5">
                                <div className="relative flex-1 group">
                                    <ShieldCheck className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-netflix-red transition-colors" size={20} />
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => {
                                            setApiKey(e.target.value);
                                            setIsSaved(false);
                                        }}
                                        placeholder="API Key Maestra"
                                        className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] pl-16 pr-8 py-5 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-netflix-red/10 focus:border-netflix-red/30 transition-all duration-700 placeholder:text-slate-700"
                                    />
                                </div>
                                <button
                                    className={`px-10 py-5 glass-card rounded-[1.5rem] text-white font-black uppercase tracking-widest text-[10px] hover:text-netflix-red transition-all duration-500 ${isSaved ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    onClick={() => {
                                        if (apiKey) setIsSaved(true);
                                    }}
                                >
                                    {isSaved ? 'Guardado' : 'Guardar'}
                                </button>
                            </div>
                            <div className="mt-8 flex items-center justify-between">
                                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest leading-loose max-w-md">
                                    Detectado automáticamente desde tu configuración .env. Puedes sobrescribirla si es necesario.
                                </p>
                                <a
                                    href="https://www.themoviedb.org/documentation/api"
                                    target="_blank"
                                    className="text-[10px] text-netflix-red font-black uppercase tracking-widest hover:underline hover:glow-text transition-all flex items-center gap-2"
                                >
                                    Solicitar Acceso <ExternalLink size={14} strokeWidth={3} />
                                </a>
                            </div>
                        </div>

                        {/* Google Drive Auth Section */}
                        <div className="p-10 bg-white/[0.01] border border-white/10 rounded-[2.5rem] shadow-inner">
                             <div className="flex justify-between items-center mb-6">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.3em] opacity-60">Google Drive Cloud</label>
                            </div>
                            <div className="flex flex-col md:flex-row gap-5 items-center justify-between">
                                <p className="text-xs font-bold text-slate-500 max-w-lg leading-loose">
                                    Conecta tu cuenta de Google Drive para subir tus películas pesadas a la nube. Esto te permitirá borrarlas de tu disco duro y transmitirlas directamente.
                                </p>
                                <button
                                    onClick={async () => {
                                        try {
                                            await window.electronAPI.authenticateDrive();
                                            alert('¡Google Drive Conectado Exitosamente!');
                                        } catch (e) {
                                            alert('Error conectando Drive: ' + e.message);
                                        }
                                    }}
                                    className="px-10 py-5 bg-green-500/10 text-green-500 border border-green-500/20 rounded-[1.5rem] font-black uppercase tracking-widest text-[10px] hover:bg-green-500 hover:text-white transition-all duration-500 shadow-xl whitespace-nowrap"
                                >
                                    Conectar Drive
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Danger Zone */}
                <section className="glass rounded-[3rem] p-10 border border-red-500/10 shadow-2xl" style={{ animationDelay: '200ms' }}>
                    <div className="flex items-center gap-6 mb-8">
                        <div className="p-5 bg-red-500/10 rounded-3xl border border-red-500/20">
                            <Trash2 className="text-red-500" size={32} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-white tracking-tight">Zona de Peligro</h2>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1 opacity-60">Acciones irreversibles de mantenimiento</p>
                        </div>
                    </div>

                    <div className="p-8 bg-black/20 border border-white/5 rounded-[2rem] flex flex-col md:flex-row items-center justify-between gap-6">
                        <div>
                            <h3 className="text-lg font-black text-white mb-2 uppercase tracking-tighter">Limpiar Bóveda Completa</h3>
                            <p className="text-xs text-slate-500 font-bold max-w-sm">Elimina permanentemente todas las películas indexadas y las carpetas de origen. Útil si quieres empezar desde cero.</p>
                        </div>
                        <button
                            onClick={async () => {
                                if (confirm('¿Estás seguro de que quieres borrar TODA tu biblioteca? Esta acción no se puede deshacer.')) {
                                    await window.electronAPI.clearLibrary();
                                    fetchConfig();
                                    alert('Bóveda limpiada correctamente.');
                                }
                            }}
                            className="px-10 py-5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-[1.5rem] font-black uppercase tracking-widest text-[10px] hover:bg-red-500 hover:text-white transition-all duration-500 shadow-xl"
                        >
                            Limpiar Biblioteca
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default SettingsPage;
