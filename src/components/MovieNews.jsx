import React from 'react';
import { motion } from 'framer-motion';
import { Newspaper, Calendar, ArrowRight, Sparkles, Trophy, Ticket, Zap } from 'lucide-react';

const NEWS_ITEMS = [
    {
        id: 1,
        category: 'Exclusiva',
        title: 'The Batman Part II: Revelado el Primer Teaser',
        description: 'Matt Reeves rompe el silencio y muestra las primeras imágenes de Robert Pattinson enfrentándose a la Corte de los Búhos en una Gotham sumida en el caos.',
        date: '22 de Abril, 2026',
        image: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&q=80&w=1000',
        color: 'from-gray-700 to-black',
        icon: <Zap size={16} />
    },
    {
        id: 2,
        category: 'Producción',
        title: 'Avengers: Doomsday inicia Rodaje en Londres',
        description: 'Robert Downey Jr. ha sido visto en el set como Victor Von Doom. La producción promete ser el evento cinematográfico más grande de la década.',
        date: '20 de Abril, 2026',
        image: 'https://images.unsplash.com/photo-1534809027769-b00d750a6bac?auto=format&fit=crop&q=80&w=1000',
        color: 'from-green-600 to-emerald-900',
        icon: <Sparkles size={16} />
    },
    {
        id: 3,
        category: 'Estreno',
        title: 'Avatar: Fire and Ash rompe Récords de Preventa',
        description: 'La tercera entrega de James Cameron se posiciona como la película más esperada del año, con una tecnología de inmersión nunca antes vista.',
        date: 'Abril 2026',
        image: 'https://images.unsplash.com/photo-1460881680858-30d872d5b530?auto=format&fit=crop&q=80&w=1000',
        color: 'from-blue-400 to-cyan-600',
        icon: <Ticket size={16} />
    },
    {
        id: 4,
        category: 'Casting',
        title: 'Spider-Man 4: Tom Holland y el Regreso al Barrio',
        description: 'Marvel y Sony confirman que la nueva entrega será una historia urbana centrada en Peter Parker lidiando con el legado de Kingpin en Nueva York.',
        date: '18 de Abril, 2026',
        image: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?auto=format&fit=crop&q=80&w=1000',
        color: 'from-red-600 to-blue-800',
        icon: <Zap size={16} />
    }
];

export default function MovieNews() {
    return (
        <section className="mb-20">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-netflix-red/10 rounded-2xl border border-netflix-red/20">
                        <Newspaper className="text-netflix-red" size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase italic">Cine News</h2>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.4em] mt-1">Lo más relevante de la semana</p>
                    </div>
                </div>
                <button className="hidden md:flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors group">
                    Ver todas las noticias <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {NEWS_ITEMS.map((item, index) => (
                    <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        whileHover={{ y: -10 }}
                        className="group relative h-[450px] rounded-[2.5rem] overflow-hidden border border-white/5 shadow-2xl cursor-pointer"
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
                                <div className={`px-3 py-1 bg-gradient-to-r ${item.color} rounded-full flex items-center gap-2 shadow-lg shadow-black/50`}>
                                    {item.icon}
                                    <span className="text-[9px] font-black uppercase text-white tracking-widest">{item.category}</span>
                                </div>
                                <div className="flex items-center gap-1.5 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full border border-white/10">
                                    <Calendar size={10} className="text-slate-300" />
                                    <span className="text-[8px] font-bold text-slate-300 uppercase">{item.date}</span>
                                </div>
                            </div>

                            <h3 className="text-xl md:text-2xl font-black text-white leading-tight mb-4 group-hover:text-netflix-red transition-colors duration-300">
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
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
