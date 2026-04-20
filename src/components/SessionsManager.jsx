import React, { useState, useEffect } from 'react';
import { Shield, Trash2, Smartphone, Monitor, Globe, Clock, User, XCircle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function SessionsManager() {
    const { user } = useAuth();
    const [sessions, setSessions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchSessions = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await api.listSessions();
            setSessions(data || []);
        } catch (err) {
            console.error('[SessionsManager] Error:', err);
            setError('No se pudieron cargar las sesiones activas');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, []);

    const handleKillSession = async (sessionId) => {
        if (!window.confirm('¿Estás seguro de que quieres cerrar esta sesión? El usuario será desconectado inmediatamente.')) {
            return;
        }

        try {
            await api.deleteSession(sessionId);
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch (err) {
            alert('Error al cerrar la sesión');
        }
    };

    const getDeviceIcon = (userAgent) => {
        const ua = userAgent?.toLowerCase() || '';
        if (ua.includes('mobi') || ua.includes('android') || ua.includes('iphone')) return <Smartphone size={18} />;
        if (ua.includes('electron')) return <Shield size={18} />;
        return <Monitor size={18} />;
    };

    const formatTimestamp = (ts) => {
        if (!ts) return 'Ahora';
        const date = new Date(ts);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'Hace un momento';
        if (diffMins < 60) return `Hace ${diffMins} min`;
        return date.toLocaleString();
    };

    if (isLoading && sessions.length === 0) {
        return (
            <div className="p-12 flex flex-col items-center justify-center opacity-40">
                <RefreshCw size={32} className="animate-spin mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cargando sesiones...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <div className="p-4 bg-orange-500/10 rounded-2xl">
                        <Shield className="text-orange-500" size={24} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white tracking-tight">Control de Acceso</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Sesiones activas en tiempo real</p>
                    </div>
                </div>
                <button 
                    onClick={fetchSessions}
                    className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
                    title="Actualizar lista"
                >
                    <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400">
                    <XCircle size={16} />
                    <span className="text-xs font-bold">{error}</span>
                </div>
            )}

            <div className="space-y-3">
                {sessions.length === 0 ? (
                    <div className="p-10 border-2 border-dashed border-white/5 rounded-[2rem] flex flex-col items-center justify-center text-center opacity-40">
                        <User size={32} strokeWidth={1} className="mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No hay sesiones activas registradas</p>
                    </div>
                ) : (
                    sessions.map((session) => {
                        const isCurrent = localStorage.getItem('cinevault_session_id') === session.id;
                        
                        return (
                            <div key={session.id} className={`flex flex-col md:flex-row justify-between items-start md:items-center p-5 bg-white/[0.03] border rounded-[1.5rem] group hover:bg-white/5 transition-all duration-300 ${isCurrent ? 'border-orange-500/30 bg-orange-500/[0.02]' : 'border-white/5'}`}>
                                <div className="flex items-center gap-5 w-full md:w-auto">
                                    <div className={`p-4 rounded-2xl ${isCurrent ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-400'}`}>
                                        {getDeviceIcon(session.user_agent)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-black text-white truncate max-w-[150px]">{session.email}</span>
                                            {isCurrent && (
                                                <span className="px-2 py-0.5 bg-orange-500 text-[8px] font-black uppercase text-black rounded-full">Esta sesión</span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-500">
                                            <div className="flex items-center gap-1.5 min-w-[100px]">
                                                <Globe size={12} className="opacity-50" />
                                                <span className="text-[10px] font-bold tracking-tight">{session.ip_address || 'IP Oculta'}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Clock size={12} className="opacity-50" />
                                                <span className="text-[10px] font-bold tracking-tight">{formatTimestamp(session.last_active)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {!isCurrent && (
                                    <button 
                                        onClick={() => handleKillSession(session.id)}
                                        className="mt-4 md:mt-0 w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all md:opacity-0 group-hover:opacity-100"
                                    >
                                        <Trash2 size={14} />
                                        Mata Sesión
                                    </button>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            <div className="mt-8 p-6 bg-yellow-500/5 border border-yellow-500/10 rounded-2xl">
                <div className="flex gap-4">
                    <Clock className="text-yellow-500 shrink-0" size={20} />
                    <div>
                        <p className="text-[11px] font-black text-yellow-500/80 uppercase tracking-widest mb-1">Cierre por Inactividad</p>
                        <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                            Las sesiones inactivas se cierran automáticamente después de 60 minutos. Puedes ajustar este tiempo en el archivo .env del servidor.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
