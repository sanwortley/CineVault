import React from 'react';
import { motion } from 'framer-motion';
import { Newspaper, Calendar, ArrowRight, Sparkles, Trophy, Ticket } from 'lucide-react';

const NEWS_ITEMS = [
    {
        id: 1,
        category: 'Estreno',
        title: 'The Fall Guy: Acción Pura con Ryan Gosling',
        description: 'La esperada cinta que rinde homenaje a los especialistas de riesgo llega a los cines con una química explosiva entre Gosling y Emily Blunt.',
        date: '25 de Abril, 2024',
        image: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&q=80&w=1000',
        color: 'from-orange-500 to-red-600',
        icon: <Ticket size={16} />
    },
    {
        id: 2,
        category: 'Festival',
        title: 'BAFICI: 25 Años de Cine Independiente',
        description: 'El festival de Buenos Aires celebra su cuarto de siglo con más de 200 películas y una apuesta renovada por el cine de autor.',
        date: '17 - 28 de Abril, 2024',
        image: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=1000',
        color: 'from-blue-500 to-indigo-600',
        icon: <Sparkles size={16} />
    },
    {
        id: 3,
        category: 'Tendencia',
        title: 'Civil War domina la Conversación Global',
        description: 'Lo nuevo de Alex Garland para A24 se convierte en un fenómeno cultural y de taquilla, planteando interrogantes sobre el futuro de EE.UU.',
        date: 'Abril 2024',
        image: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?auto=format&fit=crop&q=80&w=1000',
        color: 'from-slate-700 to-black',
        icon: <Newspaper size={16} />
    },
    {
        id: 4,
        category: 'Premios',
        title: 'Gala de los Premios Platino 2024',
        description: 'La gran fiesta del cine iberoamericano celebró su XI edición en el Caribe mexicano, premiando lo mejor del audiovisual en español y portugués.',
        date: '20 de Abril, 2024',
        image: 'https://images.unsplash.com/photo-1533928298208-27ff66555d8d?auto=format&fit=crop&q=80&w=1000',
        color: 'from-yellow-400 to-amber-600',
        icon: <Trophy size={16} />
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
