import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { UploadQueueProvider } from './context/UploadQueueContext';

// Components
import ProtectedRoute from './components/ProtectedRoute';
import AppContent from './components/AppContent';

// Lazy loaded pages for performance and to break circular dependencies
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));

// Loading Fallback
const LoadingFallback = () => (
    <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-netflix-red"></div>
    </div>
);

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Suspense fallback={<LoadingFallback />}>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/register" element={<RegisterPage />} />
                        <Route path="/*" element={
                            <ProtectedRoute>
                                <UploadQueueProvider>
                                    <AppContent />
                                </UploadQueueProvider>
                            </ProtectedRoute>
                        } />
                    </Routes>
                </Suspense>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
