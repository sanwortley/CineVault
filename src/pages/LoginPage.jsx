import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Film, Mail, Lock, Loader, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

function LoginPage() {
    const { login, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (searchParams.get('expired') === 'true') {
            setError('Tu sesión expiró. Por favor, iniciá sesión nuevamente.');
        }
    }, [searchParams]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            await login(email, password);
            navigate('/');
        } catch (err) {
            setError(err.message || 'Error al iniciar sesión');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 md:p-8 relative overflow-hidden">
            {/* Ambient Background Effects */}
            <div className="fixed top-0 right-0 w-[600px] h-[600px] bg-netflix-red/10 blur-[180px] rounded-full translate-x-1/3 -translate-y-1/3 pointer-events-none"></div>
            <div className="fixed bottom-0 left-0 w-[500px] h-[500px] bg-cyan-500/5 blur-[150px] rounded-full -translate-x-1/3 translate-y-1/3 pointer-events-none"></div>

            {/* Main Card */}
            <div className="w-full max-w-md relative z-10">
                {/* Logo Section */}
                <div className="text-center mb-10 animate-fade-in">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-netflix-red to-red-900 rounded-[2rem] mb-6 shadow-[0_20px_60px_-15px_rgba(229,9,20,0.5)]">
                        <Film size={40} className="text-white" strokeWidth={1.5} />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-3">
                        <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-200 to-netflix-red">CineVault</span>
                    </h1>
                    <p className="text-slate-500 text-sm font-bold tracking-widest uppercase opacity-60">Tu experiencia cinematográfica</p>
                </div>

                {/* Login Form */}
                <div className="glass rounded-[3rem] p-8 md:p-12 shadow-2xl animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                    <h2 className="text-2xl font-black text-white tracking-tight mb-8 text-center">Iniciar Sesión</h2>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Email Input */}
                        <div className="relative group">
                            <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-netflix-red transition-colors" size={20} strokeWidth={2} />
                            <label htmlFor="email" className="sr-only">Correo electrónico</label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Correo electrónico"
                                required
                                autoComplete="email"
                                className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] pl-14 pr-5 py-5 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-netflix-red/10 focus:border-netflix-red/30 transition-all duration-700 placeholder:text-slate-600 text-white"
                            />
                        </div>

                        {/* Password Input */}
                        <div className="relative group">
                            <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-netflix-red transition-colors" size={20} strokeWidth={2} />
                            <label htmlFor="password" className="sr-only">Contraseña</label>
                            <input
                                id="password"
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Contraseña"
                                required
                                autoComplete="current-password"
                                className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] pl-14 pr-14 py-5 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-netflix-red/10 focus:border-netflix-red/30 transition-all duration-700 placeholder:text-slate-600 text-white"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                            >
                                {showPassword ? <EyeOff size={20} strokeWidth={2} /> : <Eye size={20} strokeWidth={2} />}
                            </button>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-[1rem]">
                                <p className="text-red-400 text-xs font-bold text-center">{error}</p>
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading || authLoading}
                            className="w-full py-5 bg-gradient-to-r from-netflix-red to-red-700 text-white font-black rounded-[1.5rem] hover:from-red-600 hover:to-red-800 active:scale-[0.98] transition-all duration-500 shadow-[0_10px_30px_-5px_rgba(229,9,20,0.4)] flex items-center justify-center gap-3 text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <Loader size={20} className="animate-spin" />
                            ) : (
                                <>
                                    <span>Ingresar</span>
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Footer */}
                    <div className="mt-8 text-center">
                        <p className="text-slate-600 text-xs font-bold">
                            ¿Necesitas ayuda? Contacta al administrador
                        </p>
                    </div>
                </div>

                {/* Decorative Elements */}
                <div className="mt-8 flex justify-center gap-2">
                    <div className="w-2 h-2 bg-netflix-red/30 rounded-full"></div>
                    <div className="w-2 h-2 bg-slate-800 rounded-full"></div>
                    <div className="w-2 h-2 bg-slate-800 rounded-full"></div>
                </div>
            </div>
        </div>
    );
}

export default LoginPage;
