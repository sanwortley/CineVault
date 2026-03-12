import React, { useState } from 'react';
import LibraryPage from './pages/LibraryPage';
import SettingsPage from './pages/SettingsPage';
import VideoPlayer from './components/VideoPlayer';
import MovieDetailsModal from './components/MovieDetailsModal';
import { Layout, Library, Settings as SettingsIcon, Film, Search, RefreshCw } from 'lucide-react';

function App() {
    const [activeTab, setActiveTab] = useState('library');
    const [playingMovie, setPlayingMovie] = useState(null);
    const [detailMovie, setDetailMovie] = useState(null);
    const [isScanning, setIsScanning] = useState(false);
    const [search, setSearch] = useState('');
    const [myList, setMyList] = useState(() => {
        try {
            const saved = localStorage.getItem('cinevault_mylist');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Error parsing myList:", e);
            return [];
        }
    });

    // Save My List to localStorage
    React.useEffect(() => {
        localStorage.setItem('cinevault_mylist', JSON.stringify(myList));
    }, [myList]);

    const toggleMyList = (movie) => {
        setMyList(prev => {
            const exists = prev.some(m => m.id === movie.id);
            if (exists) return prev.filter(m => m.id !== movie.id);
            return [...prev, movie];
        });
    };

    const handleRefresh = async () => {
        if (isScanning) return;
        setIsScanning(true);
        try {
            if (window.electronAPI) {
                await window.electronAPI.refreshLibrary();
                window.location.reload(); 
            }
        } catch (err) {
            console.error('Scan error:', err);
        } finally {
            setIsScanning(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white selection:bg-netflix-red/30">
            {playingMovie && (
                <VideoPlayer
                    movie={playingMovie}
                    onClose={(savedTime) => {
                        // Immediately update local state to reflect progress without full refresh
                        if (savedTime !== undefined && savedTime > 5) {
                           setPlayingMovie(null);
                           const updateLibrary = async () => {
                                if (window.electronAPI) {
                                  // Update the movie list locally by fetching the latest from DB
                                  // This is faster than a full refreshLibrary scan
                                  const data = await window.electronAPI.getMovies();
                                  // Emitting a custom event so LibraryPage can re-fetch
                                  window.dispatchEvent(new Event('library-updated'));
                                }
                           };
                           updateLibrary();
                        } else {
                            setPlayingMovie(null);
                        }
                    }}
                />
            )}

            {detailMovie && (
                <MovieDetailsModal
                    movie={detailMovie}
                    onClose={() => setDetailMovie(null)}
                    onPlay={(movie) => setPlayingMovie(movie)}
                    onUpload={() => {
                        alert("Para subir, usa el icono de la nube en la tarjeta de la película.");
                    }}
                />
            )}

            {/* Sticky Top Navigation Bar - Hidden when modal or player is active */}
            {!detailMovie && !playingMovie && (
                <nav className="sticky-nav px-8 md:px-16 py-5 flex items-center justify-between z-50 animate-in fade-in duration-500">
                    <div className="flex items-center gap-20">
                        {/* Logo */}
                        <div 
                            className="cursor-pointer transition-transform hover:scale-110 active:scale-95 py-1"
                            onClick={() => setActiveTab('library')}
                        >
                            <img 
                                src="/assets/logo.png" 
                                alt="CineVault" 
                                className="h-14 w-auto object-contain drop-shadow-[0_0_15px_rgba(229,9,20,0.6)]"
                            />
                        </div>

                        {/* Nav Links */}
                        <div className="hidden lg:flex items-center gap-10">
                            <button 
                                onClick={() => setActiveTab('library')}
                                className={`text-sm font-bold transition-colors hover:text-slate-300 ${activeTab === 'library' ? 'text-white' : 'text-slate-400'}`}
                            >
                                Inicio
                            </button>
                            <button 
                                onClick={() => setActiveTab('mylist')}
                                className={`text-sm font-bold transition-colors hover:text-slate-300 ${activeTab === 'mylist' ? 'text-white' : 'text-slate-400'}`}
                            >
                                Mi lista
                            </button>
                        </div>
                    </div>

                    {/* Search & Actions Area */}
                    <div className="flex items-center gap-8">
                        {/* Search Bar */}
                        <div className="relative group">
                            <Search 
                                className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${search ? 'text-netflix-red' : 'text-slate-400 group-focus-within:text-white'}`} 
                                size={18} 
                            />
                            <input
                                type="text"
                                placeholder="Títulos, personas, géneros"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="bg-black border border-white/20 rounded py-2 pl-12 pr-4 text-xs focus:outline-none focus:w-64 w-40 transition-all duration-500 placeholder:text-slate-500 font-medium"
                            />
                        </div>

                        {/* Replaced sidebar sync button with a visible top-bar action */}
                        <button
                            onClick={handleRefresh}
                            disabled={isScanning}
                            className={`transition-all duration-300 p-2 rounded-full hover:bg-white/10 ${isScanning ? 'opacity-50' : 'text-white hover:text-netflix-red'}`}
                            title="Sincronizar Biblioteca"
                        >
                            <RefreshCw size={20} className={isScanning ? 'animate-spin' : ''} />
                        </button>

                        <button
                            onClick={() => setActiveTab('settings')}
                            className={`transition-all duration-300 p-2 rounded-full hover:bg-white/10 ${activeTab === 'settings' ? 'text-netflix-red' : 'text-white'}`}
                            title="Ajustes"
                        >
                            <SettingsIcon size={20} />
                        </button>
                    </div>
                </nav>
            )}

            {/* Main Content Area - Reduced negative margin to prevent overlap issues */}
            <main className="relative z-0 -mt-4">
                {activeTab === 'library' && (
                    <LibraryPage 
                        onPlayMovie={setPlayingMovie} 
                        onInfoMovie={setDetailMovie}
                        search={search}
                        myList={myList}
                        toggleMyList={toggleMyList}
                    />
                )}
                {activeTab === 'mylist' && (
                    <LibraryPage 
                        onPlayMovie={setPlayingMovie} 
                        onInfoMovie={setDetailMovie}
                        search={search}
                        myList={myList}
                        toggleMyList={toggleMyList}
                        viewOnlyList={true}
                    />
                )}
                {activeTab === 'settings' && (
                    <div className="pt-24 px-16">
                        <SettingsPage />
                    </div>
                )}
            </main>

            {/* Global Ambient Glows */}
            <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-netflix-red/5 blur-[150px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none -z-10"></div>
        </div>
    );
}

export default App;
