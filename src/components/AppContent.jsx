import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { 
    Search, RefreshCw, Settings as SettingsIcon, Key, LogOut, 
    Home, Bookmark, Upload, ShieldCheck, Check, Lock, AlertCircle, Loader2, Compass, User, UserCircle, X 
} from 'lucide-react';

// Components
import VideoPlayer from './VideoPlayer';
import MovieDetailsModal from './MovieDetailsModal';
import ActivityCenter from './ActivityCenter';
import Disclaimer from './Disclaimer';
import { groupMoviesByTitle } from '../utils/movieUtils';

// Lazy loaded pages to break dependency chains
const LibraryPage = React.lazy(() => import('../pages/LibraryPage'));
const SettingsPage = React.lazy(() => import('../pages/SettingsPage'));
const UploadPage = React.lazy(() => import('../pages/UploadPage'));
const ExplorePage = React.lazy(() => import('../pages/ExplorePage'));

export default function AppContent() {
    const { user, isAdmin, logout, getUserMylist, getUserProgress, addToMylist, removeFromMylist, isInMylist, hideMovieFromContinue, changePassword, updateUserMetadata } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('library');
    const [playingMovie, setPlayingMovie] = useState(null);
    const [detailMovie, setDetailMovie] = useState(null);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
    const [passwordSuccess, setPasswordSuccess] = useState(false);
    const [passwordError, setPasswordError] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
    const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
    const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
    const [gallerySeed, setGallerySeed] = useState(Math.floor(Math.random() * 1000));
    const [isScanning, setIsScanning] = useState(false);
    const [search, setSearch] = useState('');
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [movies, setMovies] = useState([]);
    const [myList, setMyList] = useState([]);
    const [userProgress, setUserProgress] = useState({});
    const [isLoadingData, setIsLoadingData] = useState(true);
    const [isScrolled, setIsScrolled] = useState(false);

    // ─── Navbar Scroll Effect ───────────────────────────────────────────────
    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // ─── SW Auto-Update Detection ───────────────────────────────────────────
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                console.log('[SW] Nueva versión detectada. Recargando para aplicar cambios...');
                window.location.reload();
            });
        }
    }, []);

    const loadData = async (silent = false) => {
        if (!user) return;
        if (!silent) setIsLoadingData(true);
        
        try {
            const moviesData = await api.getMovies();
            setMovies(moviesData || []);
            
            const mylistData = await getUserMylist();
            if (mylistData && mylistData.length > 0) {
                const mylistMovies = mylistData.map(item => {
                    return (moviesData || []).find(m => String(m.id) === String(item.movie_id));
                }).filter(Boolean);
                setMyList(mylistMovies);
            } else {
                setMyList([]);
            }
            
            const progressData = await getUserProgress();
            const progressMap = {};
            (progressData || []).forEach(p => {
                progressMap[String(p.movie_id)] = {
                    duration: p.watched_duration,
                    updatedAt: p.updated_at,
                    isHidden: p.is_hidden || false
                };
            });
            setUserProgress(progressMap);
        } catch (err) {
            console.error('[App] Load data error:', err);
        } finally {
            setIsLoadingData(false);
        }
    };

    const groupedMovies = React.useMemo(() => groupMoviesByTitle(movies || []), [movies]);

    useEffect(() => {
        if (user) loadData();
        
        // Handle deep linking for tabs and search
        const params = new URLSearchParams(window.location.search);
        const query = params.get('q');
        const path = window.location.pathname;
        
        if (query || path === '/explore') {
            setActiveTab('explore');
        } else if (path === '/upload') {
            setActiveTab('upload');
        } else if (path === '/settings') {
            setActiveTab('settings');
        } else if (path === '/mylist') {
            setActiveTab('mylist');
        }
    }, [user]);

    useEffect(() => {
        const handleLibraryUpdate = () => loadData(true);
        window.addEventListener('library-updated', handleLibraryUpdate);
        return () => window.removeEventListener('library-updated', handleLibraryUpdate);
    }, [user]);

    useEffect(() => {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
        });

        window.addEventListener('appinstalled', () => {
            setDeferredPrompt(null);
            console.log('CineVault instalada correctamente');
        });
    }, []);

    const handlePopState = (e) => {
        if (playingMovie) {
            setPlayingMovie(null);
        } else if (detailMovie) {
            setDetailMovie(null);
        }
    };

    useEffect(() => {
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [playingMovie, detailMovie]);

    useEffect(() => {
        if (playingMovie || detailMovie) {
            window.history.pushState({ modal: true }, '');
        }
    }, [playingMovie, detailMovie]);

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (newPassword.length < 6) {
            setPasswordError('La contraseña debe tener al menos 6 caracteres');
            return;
        }

        setIsUpdatingPassword(true);
        setPasswordError('');
        try {
            await changePassword(newPassword);
            setPasswordSuccess(true);
            setTimeout(() => {
                setIsChangePasswordOpen(false);
                setPasswordSuccess(false);
                setNewPassword('');
            }, 2000);
        } catch (err) {
            setPasswordError('Error al actualizar contraseña. Inténtalo de nuevo.');
        } finally {
            setIsUpdatingPassword(false);
        }
    };

    const toggleMyList = async (movie) => {
        const inList = myList.some(m => m.id === movie.id);
        if (inList) {
            await removeFromMylist(movie.id);
            setMyList(prev => prev.filter(m => m.id !== movie.id));
        } else {
            await addToMylist(movie.id);
            setMyList(prev => [...prev, movie]);
        }
    };

    const handleHideProgress = async (movieId) => {
        await hideMovieFromContinue(movieId);
        setUserProgress(prev => ({
            ...prev,
            [String(movieId)]: {
                ...prev[String(movieId)],
                isHidden: true
            }
        }));
    };

    const handleRefresh = async () => {
        if (isScanning) return;
        setIsScanning(true);
        try {
            await api.refreshLibrary();
            alert("Escaneo iniciado. ¡Las películas nuevas se añadirán y subirán a Drive automáticamente!");
        } catch (err) {
            console.error('Scan error:', err);
            alert("Error al escanear: " + err.message);
        } finally {
            setIsScanning(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white selection:bg-netflix-red/30">
            {playingMovie && (
                <VideoPlayer
                    movie={playingMovie}
                    userProgress={userProgress}
                    onClose={(savedTime) => {
                        setPlayingMovie(null);
                        loadData(true);
                    }}
                    onOpenSettings={() => {
                        setActiveTab('settings');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    onVersionChange={(newVersion) => {
                        setPlayingMovie(newVersion);
                    }}
                />
            )}

            {detailMovie && (
                <MovieDetailsModal
                    movie={detailMovie}
                    onClose={() => setDetailMovie(null)}
                    onPlay={(movie) => setPlayingMovie(movie)}
                    myList={myList}
                    toggleMyList={toggleMyList}
                />
            )}

            {!detailMovie && !playingMovie && (
                <nav className={`fixed top-0 left-0 right-0 w-full px-3 md:px-16 py-4 md:py-5 flex items-center justify-between z-[9999] transform-gpu isolate transition-all duration-500 safe-top ${isScrolled ? 'bg-black/95 backdrop-blur-md shadow-2xl' : 'bg-gradient-to-b from-black/80 via-black/30 to-transparent'}`}>
                    <div className="flex items-center gap-10">
                        <div className="hidden lg:flex items-center gap-10">
                            <button 
                                onClick={() => { setActiveTab('library'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                className={`text-sm font-black uppercase tracking-widest transition-colors hover:text-white ${activeTab === 'library' ? 'text-white' : 'text-slate-400'}`}
                            >
                                Inicio
                            </button>
                            <button 
                                onClick={() => { setActiveTab('explore'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                className={`text-sm font-black uppercase tracking-widest transition-colors hover:text-white ${activeTab === 'explore' ? 'text-white' : 'text-slate-400'}`}
                            >
                                Explorar
                            </button>
                            <button 
                                onClick={() => { setActiveTab('mylist'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                className={`text-sm font-black uppercase tracking-widest transition-colors hover:text-white ${activeTab === 'mylist' ? 'text-white' : 'text-slate-400'}`}
                            >
                                Mi lista
                            </button>
                            {isAdmin() && (
                                <button 
                                    onClick={() => { setActiveTab('upload'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                    className={`text-sm font-black uppercase tracking-widest transition-colors hover:text-white ${activeTab === 'upload' ? 'text-white' : 'text-slate-400'}`}
                                >
                                    Subir
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-1 justify-end min-w-0">
                        <div className="relative group flex-1 md:flex-none max-w-full md:max-w-[400px]">
                            <Search 
                                className={`absolute left-3 md:left-4 top-1/2 -translate-y-1/2 transition-colors ${search ? 'text-netflix-red' : 'text-slate-400 group-focus-within:text-white'}`} 
                                size={18} 
                            />
                            <input
                                type="text"
                                placeholder="Títulos..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full bg-black/40 border border-white/20 rounded-full py-2.5 pl-10 md:pl-14 pr-4 text-xs md:text-sm focus:outline-none focus:bg-black/60 transition-all duration-500 placeholder:text-slate-500 font-medium"
                            />
                        </div>

                        <div className="flex items-center gap-1.5 md:gap-4 shrink-0">
                            {isAdmin() && (
                                <>
                                    <button
                                        onClick={handleRefresh}
                                        disabled={isScanning}
                                        className={`transition-all duration-300 p-2 rounded-full hover:bg-white/10 ${isScanning ? 'opacity-50' : 'text-white hover:text-netflix-red'}`}
                                        title="Sincronizar Biblioteca"
                                    >
                                        <RefreshCw size={20} className={isScanning ? 'animate-spin' : ''} />
                                    </button>

                                    <ActivityCenter />

                                    <button
                                        onClick={() => setActiveTab('settings')}
                                        className={`transition-all duration-300 p-2 rounded-full hover:bg-white/10 hidden md:flex ${activeTab === 'settings' ? 'text-netflix-red' : 'text-white'}`}
                                        title="Ajustes"
                                    >
                                        <SettingsIcon size={20} />
                                    </button>
                                </>
                            )}

                            <div className="relative">
                                <button
                                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                                    className="relative group transition-all duration-300"
                                >
                                    <div className="w-9 h-9 md:w-11 md:h-11 rounded-full border-2 border-white/10 overflow-hidden bg-white/5 transition-all group-hover:border-netflix-red group-active:scale-95 shadow-lg">
                                        <img 
                                            src={user?.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${user?.email || 'default'}`}
                                            alt="Avatar"
                                            className="w-full h-full object-cover animate-in fade-in zoom-in duration-700"
                                        />
                                    </div>
                                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-black rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                                </button>

                                {isProfileOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setIsProfileOpen(false)}></div>
                                        <div className="absolute right-0 mt-3 w-64 glass-card rounded-2xl border border-white/10 shadow-2xl overflow-hidden z-50 animate-in slide-in-from-top-4 fade-in duration-300">
                                            <div className="p-5 border-b border-white/5 bg-white/[0.02]">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Sesión iniciada como</p>
                                                <p className="text-xs font-bold text-white truncate">{user?.email}</p>
                                            </div>
                                            <div className="p-2">
                                                <button 
                                                    onClick={() => { setIsProfileOpen(false); setIsChangePasswordOpen(true); }}
                                                    className="w-full flex items-center gap-3 px-4 py-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-all group"
                                                >
                                                    <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20">
                                                        <Key size={14} className="text-blue-400" />
                                                    </div>
                                                    Cambiar Contraseña
                                                </button>
                                                <button 
                                                    onClick={() => { setIsProfileOpen(false); setIsAvatarPickerOpen(true); }}
                                                    className="w-full flex items-center gap-3 px-4 py-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-all group"
                                                >
                                                    <div className="p-2 bg-purple-500/10 rounded-lg group-hover:bg-purple-500/20">
                                                        <UserCircle size={14} className="text-purple-400" />
                                                    </div>
                                                    Cambiar Avatar
                                                </button>
                                                <button 
                                                    onClick={() => { logout(); navigate('/login'); }}
                                                    className="w-full flex items-center gap-3 px-4 py-3 text-xs font-bold text-netflix-red hover:bg-red-500/10 rounded-xl transition-all group"
                                                >
                                                    <div className="p-2 bg-red-500/10 rounded-lg group-hover:bg-red-500/20">
                                                        <LogOut size={14} />
                                                    </div>
                                                    Cerrar Sesión
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </nav>
            )}

            <main className="relative z-0 -mt-4 pb-20 lg:pb-0">
                <React.Suspense fallback={null}>
                    {activeTab === 'library' && (
                    <LibraryPage 
                        movies={groupedMovies}
                        isLoading={isLoadingData}
                        onPlayMovie={setPlayingMovie} 
                        onInfoMovie={setDetailMovie}
                        search={search}
                        myList={myList}
                        toggleMyList={toggleMyList}
                        userProgress={userProgress}
                        onHideProgress={handleHideProgress}
                    />
                )}
                {activeTab === 'mylist' && (
                    <LibraryPage 
                        movies={movies}
                        isLoading={isLoadingData}
                        onPlayMovie={setPlayingMovie} 
                        onInfoMovie={setDetailMovie}
                        search={search}
                        myList={myList}
                        toggleMyList={toggleMyList}
                        viewOnlyList={true}
                        userProgress={userProgress}
                        onHideProgress={handleHideProgress}
                    />
                )}
                {activeTab === 'explore' && (
                    <div className="pt-24">
                        <ExplorePage />
                    </div>
                )}
                {activeTab === 'upload' && (
                    <UploadPage 
                        onUploadComplete={() => {
                            setTimeout(() => handleRefresh(), 2000);
                        }}
                    />
                )}
                {activeTab === 'settings' && (
                    <div className="pt-24 px-4 md:px-16 pb-24 md:pb-0">
                        <SettingsPage 
                            onClose={() => setActiveTab('library')} 
                            onTabChange={(tab) => {
                                setActiveTab(tab);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                        />
                    </div>
                )}
                </React.Suspense>
            </main>

            {!playingMovie && !detailMovie && <Disclaimer />}

            {isChangePasswordOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={() => !isUpdatingPassword && setIsChangePasswordOpen(false)}></div>
                    <div className="relative w-full max-w-sm glass-card rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-10 text-center">
                            <div className="w-20 h-20 bg-netflix-red/10 rounded-3xl border border-netflix-red/20 flex items-center justify-center mx-auto mb-8 shadow-inner group">
                                <ShieldCheck className="text-netflix-red group-hover:scale-110 transition-transform duration-500" size={40} strokeWidth={2.5} />
                            </div>
                            
                            <h2 className="text-3xl font-black text-white tracking-tighter mb-2">Seguridad</h2>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-10 opacity-60">Actualiza tu clave de acceso</p>

                            {passwordSuccess ? (
                                <div className="space-y-4 py-4 animate-in zoom-in duration-500 text-green-400">
                                    <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
                                        <Check size={24} strokeWidth={4} />
                                    </div>
                                    <p className="text-sm font-black uppercase tracking-widest">¡Contraseña Actualizada!</p>
                                </div>
                            ) : (
                                <form onSubmit={handlePasswordChange} className="space-y-6">
                                    <div className="relative group">
                                        <Lock className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-netflix-red transition-colors" size={18} />
                                        <input
                                            type="password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            placeholder="Nueva Contraseña"
                                            className="w-full bg-black/40 border border-white/10 rounded-2xl pl-16 pr-8 py-5 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-netflix-red/10 focus:border-netflix-red/30 transition-all duration-500 placeholder:text-slate-700"
                                            required
                                            disabled={isUpdatingPassword}
                                        />
                                    </div>

                                    {passwordError && (
                                        <div className="flex items-center gap-2 text-red-400 justify-center animate-in slide-in-from-top-1 duration-300">
                                            <AlertCircle size={14} />
                                            <span className="text-[10px] font-black uppercase tracking-widest">{passwordError}</span>
                                        </div>
                                    )}

                                    <div className="flex gap-4 pt-4">
                                        <button
                                            type="button"
                                            onClick={() => setIsChangePasswordOpen(false)}
                                            className="flex-1 px-4 py-5 bg-white/5 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                                            disabled={isUpdatingPassword}
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={isUpdatingPassword}
                                            className="flex-1 px-4 py-5 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-200 transition-all shadow-xl flex items-center justify-center gap-2"
                                        >
                                            {isUpdatingPassword ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} strokeWidth={3} />}
                                            {isUpdatingPassword ? 'Guardando' : 'Guardar'}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-netflix-red/5 blur-[150px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none -z-10"></div>

            {!detailMovie && !playingMovie && (
                <div className="lg:hidden fixed bottom-6 left-6 right-6 z-[150] safe-bottom animate-in slide-in-from-bottom-6 duration-700">
                    <div className="glass shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 rounded-[2rem] px-6 py-4 flex items-center justify-around gap-2 backdrop-blur-2xl">
                        <button 
                            onClick={() => { setActiveTab('library'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            className={`flex flex-col items-center gap-1 transition-all duration-300 ${activeTab === 'library' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            <Home size={22} strokeWidth={activeTab === 'library' ? 2.5 : 2} />
                            <span className="text-[9px] font-black uppercase tracking-widest">{activeTab === 'library' ? 'Inicio' : ''}</span>
                        </button>
                        
                        <button 
                            onClick={() => { setActiveTab('explore'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            className={`flex flex-col items-center gap-1 transition-all duration-300 ${activeTab === 'explore' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            <Compass size={22} strokeWidth={activeTab === 'explore' ? 2.5 : 2} />
                            <span className="text-[9px] font-black uppercase tracking-widest">{activeTab === 'explore' ? 'Explorar' : ''}</span>
                        </button>

                        <button 
                            onClick={() => { setActiveTab('mylist'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            className={`flex flex-col items-center gap-1 transition-all duration-300 ${activeTab === 'mylist' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            <Bookmark size={22} strokeWidth={activeTab === 'mylist' ? 2.5 : 2} />
                            <span className="text-[9px] font-black uppercase tracking-widest">{activeTab === 'mylist' ? 'Lista' : ''}</span>
                        </button>

                        {isAdmin() && (
                            <>
                                <button 
                                    onClick={() => { setActiveTab('upload'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                    className={`flex flex-col items-center gap-1 transition-all duration-300 ${activeTab === 'upload' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    <Upload size={22} strokeWidth={activeTab === 'upload' ? 2.5 : 2} />
                                    <span className="text-[9px] font-black uppercase tracking-widest">{activeTab === 'upload' ? 'Subir' : ''}</span>
                                </button>

                                <button 
                                    onClick={() => { setActiveTab('settings'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                    className={`flex flex-col items-center gap-1 transition-all duration-300 ${activeTab === 'settings' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    <SettingsIcon size={22} strokeWidth={activeTab === 'settings' ? 2.5 : 2} />
                                    <span className="text-[9px] font-black uppercase tracking-widest">{activeTab === 'settings' ? 'Ajustes' : ''}</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
            {isAvatarPickerOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={() => !isUpdatingAvatar && setIsAvatarPickerOpen(false)}></div>
                    <div className="relative w-full max-w-2xl glass-card rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-5 sm:p-8 md:p-12">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h2 className="text-3xl font-black text-white tracking-tighter mb-1">Tu Avatar</h2>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] opacity-60">Personaliza tu identidad en CineVault</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => setGallerySeed(Math.floor(Math.random() * 10000))}
                                        className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl text-slate-400 hover:text-white transition-all flex items-center gap-2 group"
                                        title="Generar nuevas opciones"
                                    >
                                        <RefreshCw size={18} className="group-active:rotate-180 transition-transform duration-500" />
                                        <span className="text-[9px] font-black uppercase tracking-widest hidden sm:block">Refrescar</span>
                                    </button>
                                    <button 
                                        onClick={() => setIsAvatarPickerOpen(false)}
                                        className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl text-slate-400 hover:text-white transition-all"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 h-[420px] overflow-y-auto no-scrollbar pr-2 p-1">
                                {[
                                    'adventurer', 'avataaars', 'bottts', 'fun-emoji', 
                                    'lorelei', 'miniavs', 'personas', 'pixel-art',
                                    'big-smile', 'croodles', 'notionists', 'notionists-neutral', 
                                    'open-peeps', 'shapes', 'thumbs'
                                ].flatMap(style => [1, 2, 3].map(i => ({ style, i }))).map(({ style, i }) => {
                                    const seed = `${user?.id}-${style}-${i}-${gallerySeed}`;
                                    const url = `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`;
                                    return (
                                        <button
                                            key={`${style}-${i}-${gallerySeed}`}
                                            disabled={isUpdatingAvatar}
                                            onClick={async () => {
                                                setIsUpdatingAvatar(true);
                                                try {
                                                    await updateUserMetadata({ avatar_url: url });
                                                    setIsAvatarPickerOpen(false);
                                                } catch (err) {
                                                    console.error('Error al actualizar avatar:', err);
                                                } finally {
                                                    setIsUpdatingAvatar(false);
                                                }
                                            }}
                                            className="w-full aspect-square rounded-[1.5rem] md:rounded-[2rem] bg-zinc-800/50 border border-white/5 overflow-hidden hover:border-netflix-red hover:bg-white/5 transition-all group relative active:scale-90 shadow-lg flex items-center justify-center p-0"
                                        >
                                            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                            <div className="w-full h-full p-2 md:p-3 overflow-hidden">
                                                <img 
                                                    src={url} 
                                                    alt={style} 
                                                    className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500" 
                                                />
                                            </div>
                                            <div className="absolute inset-0 bg-netflix-red/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                                                <Check size={28} className="text-white drop-shadow-lg" strokeWidth={3} />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {isUpdatingAvatar && (
                                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                                    <Loader2 className="text-netflix-red animate-spin mb-4" size={40} />
                                    <p className="text-xs font-black uppercase tracking-widest text-white">Actualizando...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
