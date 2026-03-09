import React, { useState } from 'react';
import LibraryPage from './pages/LibraryPage';
import SettingsPage from './pages/SettingsPage';
import VideoPlayer from './components/VideoPlayer';
import { Layout, Library, Settings as SettingsIcon, Film } from 'lucide-react';

function App() {
    const [activeTab, setActiveTab] = useState('library');
    const [playingMovie, setPlayingMovie] = useState(null);

    return (
        <div className="flex h-screen overflow-hidden bg-[#020617] text-slate-200 selection:bg-cyan-500/20">
            {playingMovie && (
                <VideoPlayer
                    movie={playingMovie}
                    onClose={() => setPlayingMovie(null)}
                />
            )}

            {/* Ambient Background Glows */}
            <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-cyan-500/5 blur-[120px] rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
            <div className="fixed bottom-0 right-0 w-[400px] h-[400px] bg-purple-500/5 blur-[100px] rounded-full translate-x-1/3 translate-y-1/3 pointer-events-none"></div>

            {/* Sidebar */}
            <nav className="w-24 glass border-r border-white/5 flex flex-col items-center py-12 gap-12 z-50 relative">
                <div className="relative group cursor-pointer mb-4">
                    <div className="absolute -inset-4 bg-cyan-500/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-all duration-700"></div>
                    <div className="relative p-3 bg-white/[0.03] rounded-2xl border border-white/5 group-hover:border-cyan-500/30 transition-all duration-300 animate-float">
                        <Film className="text-cyan-500 group-hover:scale-110 transition-transform" size={28} strokeWidth={2.5} />
                    </div>
                </div>

                <div className="flex flex-col gap-8">
                    <button
                        onClick={() => setActiveTab('library')}
                        className={`p-4 rounded-2xl transition-all duration-500 relative group ${activeTab === 'library' ? 'bg-cyan-500 text-black glow-accent' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}
                    >
                        <Library size={24} strokeWidth={activeTab === 'library' ? 2.5 : 2} />
                        {activeTab === 'library' && (
                            <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-1.5 h-10 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>
                        )}
                        <span className="absolute left-full ml-6 px-3 py-1.5 bg-[#0f172a] border border-white/10 rounded-xl text-[10px] uppercase font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none whitespace-nowrap z-50 shadow-2xl translate-x-[-10px] group-hover:translate-x-0">
                            Biblioteca
                        </span>
                    </button>

                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`p-4 rounded-2xl transition-all duration-500 relative group ${activeTab === 'settings' ? 'bg-cyan-500 text-black glow-accent' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}
                    >
                        <SettingsIcon size={24} strokeWidth={activeTab === 'settings' ? 2.5 : 2} />
                        {activeTab === 'settings' && (
                            <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-1.5 h-10 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>
                        )}
                        <span className="absolute left-full ml-6 px-3 py-1.5 bg-[#0f172a] border border-white/10 rounded-xl text-[10px] uppercase font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none whitespace-nowrap z-50 shadow-2xl translate-x-[-10px] group-hover:translate-x-0">
                            Ajustes
                        </span>
                    </button>
                </div>

                <div className="mt-auto opacity-20 hover:opacity-100 transition-opacity p-2">
                    <div className="w-1 h-12 bg-white/10 rounded-full mx-auto"></div>
                </div>
            </nav>

            {/* Main Content */}
            <main className="flex-1 overflow-auto relative z-10 scroll-smooth">
                <div className="h-full relative overflow-y-auto">
                    {activeTab === 'library' && <LibraryPage onPlayMovie={setPlayingMovie} />}
                    {activeTab === 'settings' && <SettingsPage />}
                </div>
            </main>
        </div>
    );
}

export default App;
