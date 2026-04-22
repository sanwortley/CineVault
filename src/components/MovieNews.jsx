import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Newspaper, Calendar, ArrowRight, Sparkles, Trophy, Ticket, Zap, Loader } from 'lucide-react';
import { api } from '../api';

export default function MovieNews() {
    const [news, setNews] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadNews = async () => {
            try {
                const data = await api.fetchMovieNews();
                setNews(data);
            } catch (err) {
                console.error('Error loading news:', err);
            } finally {
                setIsLoading(false);
            }
        };
        loadNews();
    }, []);

    if (isLoading) {
        return (
            <div className="py-20 flex flex-col items-center justify-center opacity-30">
                <Loader className="animate-spin mb-4" size={32} />
                <p className="text-[10px] font-black uppercase tracking-[0.4em]">Sincronizando Cine News...</p>
            </div>
        );
    }

    if (news.length === 0) return null;

    return (
        <section className="mb-12">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-netflix-red/10 rounded-xl border border-netflix-red/20">
                        <Newspaper className="text-netflix-red" size={18} />
                    </div>
                    <div>
                        <h2 className="text-xl md:text-3xl font-black text-white tracking-tighter uppercase italic leading-none">Cine News</h2>
                        <p className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.3em] mt-0.5">Lo más relevante de la semana</p>
                    </div>
                </div>
                <button className="hidden md:flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors group">
                    Ver todas las noticias <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {news.map((item, index) => (
                    <motion.a
                        key={item.id}
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        whileHover={{ y: -10 }}
                        className="group relative h-[450px] rounded-[2.5rem] overflow-hidden border border-white/5 shadow-2xl cursor-pointer block"
                    >
                        {/* Background Image */}
                        <div className="absolute inset-0">
                            <img 
                                src={item.image} 
                                alt={item.title} 
                                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-60 group-hover:opacity-80"
                            />
                            <div className={`absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-80 group-hover:opacity-90 transition-opacity`}></div>
                        </div>

                        {/* Content */}
                        <div className="absolute inset-0 p-8 flex flex-col justify-end">
                            <div className="flex items-center gap-2 mb-4">
                                <div className={`px-3 py-1 bg-netflix-red rounded-full flex items-center gap-2 shadow-lg shadow-black/50`}>
                                    <Sparkles size={12} className="text-white" />
                                    <span className="text-[9px] font-black uppercase text-white tracking-widest">{item.category}</span>
                                </div>
                                <div className="flex items-center gap-1.5 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full border border-white/10">
                                    <Calendar size={10} className="text-slate-300" />
                                    <span className="text-[8px] font-bold text-slate-300 uppercase">{item.date}</span>
                                </div>
                            </div>

                            <h3 className="text-xl md:text-2xl font-black text-white leading-tight mb-4 group-hover:text-netflix-red transition-colors duration-300 line-clamp-3">
                                {item.title}
                            </h3>

                            <p className="text-sm text-slate-400 font-medium leading-relaxed opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-4 group-hover:translate-y-0 line-clamp-3">
                                {item.description}
                            </p>

                            <div className="mt-6 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/40 group-hover:text-white transition-colors">
                                Leer más <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 transition-all" />
                            </div>
                        </div>

                        {/* Hover Overlay Light */}
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent scale-x-0 group-hover:scale-x-100 transition-transform duration-700"></div>
                    </motion.a>
                ))}
            </div>
        </section>
    );
}
