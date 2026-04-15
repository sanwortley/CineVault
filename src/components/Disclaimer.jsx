import React from 'react';
import { ShieldAlert, Info, Scale } from 'lucide-react';

const Disclaimer = () => {
    return (
        <footer className="relative w-full py-20 px-4 md:px-16 mt-20 overflow-hidden border-t border-white/5 bg-gradient-to-b from-black to-zinc-950">
            {/* Ambient Background Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-px bg-gradient-to-r from-transparent via-netflix-red/30 to-transparent"></div>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-netflix-red/5 blur-[120px] rounded-full -translate-y-1/2"></div>

            <div className="max-w-5xl mx-auto relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                    
                    {/* Brand & Mission */}
                    <div className="lg:col-span-4 space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-netflix-red/10 rounded-xl border border-netflix-red/20 shadow-inner">
                                <Scale className="text-netflix-red" size={20} />
                            </div>
                            <h3 className="text-xl font-black text-white tracking-tighter uppercase italic">
                                Cine<span className="text-netflix-red">Vault</span>
                            </h3>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed max-w-xs">
                            Un espacio experimental para la preservación y organización de medios digitales personales.
                        </p>
                    </div>

                    {/* Legal Notice Box */}
                    <div className="lg:col-span-8">
                        <div className="glass-card relative rounded-3xl p-8 md:p-10 border border-white/10 shadow-2xl overflow-hidden group">
                            {/* Decorative background element */}
                            <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-700 pointer-events-none">
                                <ShieldAlert size={120} />
                            </div>

                            <div className="flex flex-col md:flex-row gap-8 items-start">
                                <div className="p-4 bg-white/5 rounded-2xl border border-white/10 shrink-0">
                                    <Info className="text-white/60" size={24} />
                                </div>
                                
                                <div className="space-y-4">
                                    <h4 className="text-xs font-black text-white uppercase tracking-[0.2em] flex items-center gap-2">
                                        <span className="w-8 h-px bg-netflix-red"></span>
                                        Aviso de Uso Educativo
                                    </h4>
                                    <p className="text-sm md:text-base font-medium text-slate-400 leading-relaxed italic">
                                        CineVault es un proyecto de código abierto desarrollado exclusivamente con fines educativos y de aprendizaje. 
                                        <span className="text-white font-semibold"> No se busca obtener beneficios económicos ni lucrar con el contenido mostrado.</span>
                                    </p>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest leading-loose">
                                        Todo el material visual y audiovisual es propiedad de sus respectivos autores y marcas. 
                                        Este sitio se ampara bajo el concepto de <span className="text-slate-300">Uso Legítimo (Fair Use)</span> para fines académicos.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom Bar */}
                <div className="mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
                    <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em]">
                        &copy; {new Date().getFullYear()} CineVault Project &bull; Academic License
                    </p>
                    <div className="flex gap-8">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors cursor-default">Open Source</span>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors cursor-default">No Commercial Use</span>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Disclaimer;
