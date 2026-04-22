import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [sessionId, setSessionId] = useState(localStorage.getItem('cinevault_session_id'));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkAuth();
        
        const handleSessionExpired = () => {
            console.warn('[Auth] Session expired event received. Logging out...');
            logout();
            window.location.href = '/login?expired=true';
        };
        
        window.addEventListener('session-expired', handleSessionExpired);
        return () => window.removeEventListener('session-expired', handleSessionExpired);
    }, []);

    // Heartbeat & Visibility Session Check
    useEffect(() => {
        if (!user || !sessionId) return;

        const performCheck = async () => {
            try {
                await api.checkSession();
            } catch (err) {
                // api.js backendFetch will auto-trigger 'session-expired' event on 401
                console.warn('[Heartbeat] Session check failed:', err.message);
            }
        };

        // Check every 30 seconds
        const interval = setInterval(performCheck, 30000);

        // Check when tab becomes visible
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                performCheck();
            }
        };

        window.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            window.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [user, sessionId]);

    const checkAuth = async () => {
        try {
            const stored = localStorage.getItem('cinevault_user');
            if (stored) {
                const userData = JSON.parse(stored);
                setUser(userData);
            }
        } catch (e) {
            console.error('[Auth] Error checking auth:', e);
        } finally {
            setLoading(false);
        }
    };

    const login = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw new Error(error.message || 'Login failed');
        }

        const userData = {
            id: data.user.id,
            email: data.user.email,
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            user_metadata: data.user.user_metadata || {}
        };

        // Register session in backend
        try {
            const { sessionId } = await api.registerSession(userData.id, userData.email);
            localStorage.setItem('cinevault_session_id', sessionId);
            setSessionId(sessionId);
        } catch (err) {
            console.error('[Auth] Failed to register backend session:', err);
            // We continue anyway, but backend calls might fail with 401
        }

        localStorage.setItem('cinevault_user', JSON.stringify(userData));
        setUser(userData);
        return userData;
    };

    const logout = async () => {
        const stored = localStorage.getItem('cinevault_user');
        if (stored) {
            try {
                await supabase.auth.signOut();
            } catch (e) {}
        }
        localStorage.removeItem('cinevault_user');
        localStorage.removeItem('cinevault_session_id');
        setUser(null);
        setSessionId(null);
    };

    const isAdmin = () => {
        const adminEmail = import.meta.env.VITE_ADMIN_EMAIL?.trim().toLowerCase();
        const userEmail = user?.email?.trim().toLowerCase();
        const ownerEmail = 'sanwortley@gmail.com';
        
        return userEmail && (
            userEmail === ownerEmail || 
            (adminEmail && userEmail === adminEmail)
        );
    };

    // Refresh token using refresh_token
    const refreshSession = async () => {
        const stored = localStorage.getItem('cinevault_user');
        if (!stored) return null;
        
        try {
            const userData = JSON.parse(stored);
            if (!userData.refresh_token) return null;
            
            const { data, error } = await supabase.auth.refreshSession({
                refresh_token: userData.refresh_token
            });
            
            if (error) {
                console.warn('[Auth] Token refresh failed:', error.message);
                
                // If refresh token is invalid/expired, force logout and redirect
                if (error.message.includes('Invalid Refresh Token') || 
                    error.message.includes('Refresh Token Not Found') ||
                    error.message.includes('invalid_grant')) {
                    localStorage.removeItem('cinevault_user');
                    setUser(null);
                    // Redirect to login with session expired message
                    window.location.href = '/login?expired=true';
                }
                return null;
            }
            
            const newUserData = {
                id: data.user.id,
                email: data.user.email,
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                user_metadata: data.user.user_metadata || {}
            };
            
            localStorage.setItem('cinevault_user', JSON.stringify(newUserData));
            setUser(newUserData);
            return newUserData;
        } catch (e) {
            console.error('[Auth] Refresh error:', e);
            return null;
        }
    };

    // Auto-refresh token on mount if it exists
    useEffect(() => {
        const stored = localStorage.getItem('cinevault_user');
        if (stored) {
            try {
                const userData = JSON.parse(stored);
                if (userData.refresh_token && !userData.access_token) {
                    refreshSession();
                }
            } catch (e) {}
        }
    }, []);

    const getUserProgress = async () => {
        if (!user?.access_token) return [];
        try {
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${user.id}`, {
                headers: {
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${user.access_token}`
                }
            });
            
            if (res.status === 401 || res.status === 403) {
                const refreshed = await refreshSession();
                if (!refreshed) return [];
                const newRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${user.id}`, {
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${refreshed.access_token}`
                    }
                });
                return await newRes.json() || [];
            }
            
            return await res.json() || [];
        } catch (e) {
            console.error('[Auth] Get progress error:', e);
            return [];
        }
    };

    const saveUserProgress = async (movieId, watchedDuration) => {
        if (!user?.access_token) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_movie_progress?on_conflict=user_id,movie_id`, {
                method: 'POST',
                headers: {
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${user.access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify({
                    user_id: user.id,
                    movie_id: movieId,
                    watched_duration: watchedDuration,
                    updated_at: new Date().toISOString()
                    // Note: is_hidden will remain its previous value on conflict merge
                })
            });
            
            if (res.status === 401 || res.status === 403) {
                const refreshed = await refreshSession();
                if (!refreshed) return;
                
                await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_movie_progress?on_conflict=user_id,movie_id`, {
                    method: 'POST',
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${refreshed.access_token}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify({
                        user_id: refreshed.id,
                        movie_id: movieId,
                        watched_duration: watchedDuration,
                        updated_at: new Date().toISOString()
                    })
                });
            }
        } catch (e) {}
    };

    const hideMovieFromContinue = async (movieId) => {
        if (!user?.access_token) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${user.id}&movie_id=eq.${movieId}`, {
                method: 'PATCH',
                headers: {
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${user.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    is_hidden: true
                })
            });
            
            if (res.status === 401 || res.status === 403) {
                const refreshed = await refreshSession();
                if (!refreshed) return;
                
                await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_movie_progress?user_id=eq.${refreshed.id}&movie_id=eq.${movieId}`, {
                    method: 'PATCH',
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${refreshed.access_token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        is_hidden: true
                    })
                });
            }
        } catch (e) {
            console.error('[Auth] Hide progress error:', e);
        }
    };

    const getUserMylist = async () => {
        if (!user?.access_token) return [];
        try {
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${user.id}`, {
                headers: {
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${user.access_token}`
                }
            });
            
            if (res.status === 401 || res.status === 403) {
                const refreshed = await refreshSession();
                if (!refreshed) return [];
                const newRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${refreshed.id}`, {
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${refreshed.access_token}`
                    }
                });
                return await newRes.json() || [];
            }
            
            return await res.json() || [];
        } catch (e) {
            return [];
        }
    };

    const addToMylist = async (movieId) => {
        if (!user?.access_token) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_mylist`, {
                method: 'POST',
                headers: {
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${user.access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=ignore-duplicates'
                },
                body: JSON.stringify({
                    user_id: user.id,
                    movie_id: movieId
                })
            });
            
            if (res.status === 401 || res.status === 403) {
                const refreshed = await refreshSession();
                if (!refreshed) return;
                await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_mylist`, {
                    method: 'POST',
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${refreshed.access_token}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=ignore-duplicates'
                    },
                    body: JSON.stringify({
                        user_id: refreshed.id,
                        movie_id: movieId
                    })
                });
            }
        } catch (e) {}
    };

    const removeFromMylist = async (movieId) => {
        if (!user?.access_token) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${user.id}&movie_id=eq.${movieId}`, {
                method: 'DELETE',
                headers: {
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${user.access_token}`
                }
            });
            
            if (res.status === 401 || res.status === 403) {
                const refreshed = await refreshSession();
                if (!refreshed) return;
                await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${refreshed.id}&movie_id=eq.${movieId}`, {
                    method: 'DELETE',
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${refreshed.access_token}`
                    }
                });
            }
        } catch (e) {}
    };

    const isInMylist = async (movieId) => {
        if (!user?.access_token) return false;
        try {
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${user.id}&movie_id=eq.${movieId}&select=id`, {
                headers: {
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${user.access_token}`
                }
            });
            
            if (res.status === 401 || res.status === 403) {
                const refreshed = await refreshSession();
                if (!refreshed) return false;
                const newRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_mylist?user_id=eq.${refreshed.id}&movie_id=eq.${movieId}&select=id`, {
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${refreshed.access_token}`
                    }
                });
                const data = await newRes.json();
                return data.length > 0;
            }
            
            const data = await res.json();
            return data.length > 0;
        } catch (e) {
            return false;
        }
    };

    const changePassword = async (newPassword) => {
        const { error } = await supabase.auth.updateUser({ 
            password: newPassword 
        });
        if (error) throw error;
    };

    const updateUserMetadata = async (metadata) => {
        try {
            // Ensure we have a fresh session before updating
            await refreshSession();
            
            const { data, error } = await supabase.auth.updateUser({ 
                data: metadata 
            });
            
            if (error) {
                if (error.message.includes('session missing') || error.message.includes('not logged in')) {
                    throw new Error('Tu sesión ha expirado. Por favor, inicia sesión de nuevo.');
                }
                throw error;
            }
            
            // Update local user state with the fresh data from Supabase
            const stored = localStorage.getItem('cinevault_user');
            if (stored) {
                const userData = JSON.parse(stored);
                const newUserData = {
                    ...userData,
                    user_metadata: data.user.user_metadata || {}
                };
                localStorage.setItem('cinevault_user', JSON.stringify(newUserData));
                setUser(newUserData);
            }
            return data.user;
        } catch (err) {
            console.error('[Auth] Error al actualizar metadatos:', err);
            throw err;
        }
    };

    const value = {
        user,
        loading,
        login,
        logout,
        isAdmin,
        isAuthenticated: !!user,
        getUserProgress,
        saveUserProgress,
        hideMovieFromContinue,
        getUserMylist,
        addToMylist,
        removeFromMylist,
        isInMylist,
        refreshSession,
        changePassword,
        updateUserMetadata
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
