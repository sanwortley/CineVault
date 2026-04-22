import React from 'react';
import { ShieldAlert, Scale, Copyright } from 'lucide-react';

const Disclaimer = () => {
    return (
        <footer className="relative w-full py-12 px-6 md:px-16 mt-20 border-t border-white/5 bg-black">
            {/* Minimalist Top Border Accent */}
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>

            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col items-center text-center space-y-10">
                    
                    {/* Brand Identifier */}
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2 opacity-40 hover:opacity-100 transition-opacity duration-500">
                            <Scale className="text-white" size={16} />
                            <h3 className="text-sm font-black text-white tracking-[0.3em] uppercase">
                                CineVault
                            </h3>
                        </div>
                        <div className="h-8 w-[1px] bg-gradient-to-b from-white/20 to-transparent"></div>
                    </div>

                    {/* Compact Legal Content */}
                    <div className="max-w-3xl space-y-6">
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-[10px] font-black text-netflix-red uppercase tracking-[0.4em]">Aviso de Uso Educativo</span>
                            <div className="w-10 h-[2px] bg-netflix-red/30 rounded-full"></div>
                        </div>
                        
                        <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-2xl mx-auto">
                            CineVault es un proyecto de código abierto desarrollado exclusivamente con fines <span className="text-slate-300">educativos y de aprendizaje</span>. 
                            Este espacio experimental no busca beneficios económicos ni lucro. Todo el material audiovisual es propiedad de sus respectivos autores. 
                            Se ampara bajo el concepto de <span className="text-slate-300 italic">Fair Use</span> (Uso Legítimo) para fines académicos y de investigación técnica.
                        </p>
                    </div>

                    {/* Minimalist Footer Bar */}
                    <div className="w-full pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                            <Copyright size={10} />
                            <span>{new Date().getFullYear()} CineVault Open Source &bull; Academic License</span>
                        </div>
                        
                        <div className="flex gap-6">
                            {['Preservación Digital', 'Sin Fines de Lucro', 'Código Abierto'].map((tag) => (
                                <span key={tag} className="text-[8px] font-black text-slate-700 uppercase tracking-[0.2em] hover:text-slate-400 transition-colors cursor-default">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Disclaimer;
