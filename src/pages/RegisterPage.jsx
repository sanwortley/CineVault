import React, { useState } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { Film, Mail, Lock, Loader, Eye, EyeOff, User, ArrowLeft, Check, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

function RegisterPage() {
    const { user, isAdmin } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (password !== confirmPassword) {
            setError('Las contraseñas no coinciden');
            return;
        }

        if (password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }

        setIsLoading(true);

        try {
            const { data, error: err } = await supabase.auth.signUp({
                email,
                password
            });

            if (err) {
                throw new Error(err.message || 'Error al registrar usuario');
            }

            setSuccess('Usuario creado correctamente. Podrá iniciar sesión.');
            setEmail('');
            setPassword('');
            setConfirmPassword('');
        } catch (err) {
            setError(err.message || 'Error al crear usuario');
        } finally {
            setIsLoading(false);
        }
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
                <div className="text-center">
                    <p className="text-slate-500 mb-4">Debes iniciar sesión para acceder a esta página</p>
                    <Link to="/login" className="text-netflix-red hover:underline">Ir a Login</Link>
                </div>
            </div>
        );
    }

    if (!isAdmin()) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
                <div className="text-center">
                    <p className="text-slate-500 mb-4">No tienes permiso para crear usuarios</p>
                    <button onClick={() => navigate('/')} className="text-netflix-red hover:underline">Volver a la Biblioteca</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 md:p-8 relative overflow-hidden">
            {/* Ambient Background Effects */}
            <div className="fixed top-0 right-0 w-[600px] h-[600px] bg-netflix-red/10 blur-[180px] rounded-full translate-x-1/3 -translate-y-1/3 pointer-events-none"></div>
            <div className="fixed bottom-0 left-0 w-[500px] h-[500px] bg-cyan-500/5 blur-[150px] rounded-full -translate-x-1/3 translate-y-1/3 pointer-events-none"></div>

            {/* Back Button */}
            <Link to="/" className="absolute top-6 left-6 flex items-center gap-2 text-slate-400 hover:text-white transition-colors z-20">
                <ArrowLeft size={20} />
                <span className="font-bold text-sm uppercase tracking-widest">Volver</span>
            </Link>

            {/* Main Card */}
            <div className="w-full max-w-md relative z-10">
                {/* Logo Section */}
                <div className="text-center mb-10 animate-fade-in">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-[2rem] mb-6 shadow-[0_20px_60px_-15px_rgba(6,182,212,0.5)]">
                        <User size={40} className="text-white" strokeWidth={1.5} />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-3">
                        <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-200 to-cyan-500">Nuevo Usuario</span>
                    </h1>
                    <p className="text-slate-500 text-sm font-bold tracking-widest uppercase opacity-60">Panel de Administración</p>
                </div>

                {/* Register Form */}
                <div className="glass rounded-[3rem] p-8 md:p-12 shadow-2xl animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                    <h2 className="text-2xl font-black text-white tracking-tight mb-8 text-center">Crear Cuenta</h2>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Email Input */}
                        <div className="relative group">
                            <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-cyan-500 transition-colors" size={20} strokeWidth={2} />
                            <label htmlFor="register-email" className="sr-only">Correo electrónico del nuevo usuario</label>
                            <input
                                id="register-email"
                                name="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Correo electrónico del nuevo usuario"
                                required
                                autoComplete="email"
                                className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] pl-14 pr-5 py-5 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-cyan-500/10 focus:border-cyan-500/30 transition-all duration-700 placeholder:text-slate-600 text-white"
                            />
                        </div>

                        {/* Password Input */}
                        <div className="relative group">
                            <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-cyan-500 transition-colors" size={20} strokeWidth={2} />
                            <label htmlFor="register-password" className="sr-only">Contraseña</label>
                            <input
                                id="register-password"
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Contraseña"
                                required
                                autoComplete="new-password"
                                className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] pl-14 pr-14 py-5 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-cyan-500/10 focus:border-cyan-500/30 transition-all duration-700 placeholder:text-slate-600 text-white"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                            >
                                {showPassword ? <EyeOff size={20} strokeWidth={2} /> : <Eye size={20} strokeWidth={2} />}
                            </button>
                        </div>

                        {/* Confirm Password Input */}
                        <div className="relative group">
                            <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-cyan-500 transition-colors" size={20} strokeWidth={2} />
                            <label htmlFor="register-confirm-password" className="sr-only">Confirmar contraseña</label>
                            <input
                                id="register-confirm-password"
                                name="confirmPassword"
                                type={showPassword ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirmar contraseña"
                                required
                                autoComplete="new-password"
                                className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] pl-14 pr-14 py-5 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-cyan-500/10 focus:border-cyan-500/30 transition-all duration-700 placeholder:text-slate-600 text-white"
                            />
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-[1rem] flex items-center gap-3">
                                <X size={18} className="text-red-500 shrink-0" />
                                <p className="text-red-400 text-xs font-bold">{error}</p>
                            </div>
                        )}

                        {/* Success Message */}
                        {success && (
                            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-[1rem] flex items-center gap-3">
                                <Check size={18} className="text-green-500 shrink-0" />
                                <p className="text-green-400 text-xs font-bold">{success}</p>
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black rounded-[1.5rem] hover:from-cyan-400 hover:to-blue-500 active:scale-[0.98] transition-all duration-500 shadow-[0_10px_30px_-5px_rgba(6,182,212,0.4)] flex items-center justify-center gap-3 text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <Loader size={20} className="animate-spin" />
                            ) : (
                                'Crear Usuario'
                            )}
                        </button>
                    </form>

                    {/* Admin Info */}
                    <div className="mt-8 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-[1rem]">
                        <p className="text-cyan-400 text-xs font-bold text-center">
                            Administración: {user?.email}
                        </p>
                    </div>
                </div>

                {/* Decorative Elements */}
                <div className="mt-8 flex justify-center gap-2">
                    <div className="w-2 h-2 bg-cyan-500/30 rounded-full"></div>
                    <div className="w-2 h-2 bg-slate-800 rounded-full"></div>
                    <div className="w-2 h-2 bg-slate-800 rounded-full"></div>
                </div>
            </div>
        </div>
    );
}

export default RegisterPage;
