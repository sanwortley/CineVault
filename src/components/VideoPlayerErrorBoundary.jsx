import React from 'react';

/**
 * ErrorBoundary specifically for the VideoPlayer.
 * Catches any uncaught errors inside the player and calls onClose
 * to cleanly unmount it, preventing the entire app layout from breaking.
 */
class VideoPlayerErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        console.error('[VideoPlayer] Fatal crash caught by ErrorBoundary:', error, info);
    }

    handleClose = () => {
        this.setState({ hasError: false, error: null });
        if (this.props.onClose) this.props.onClose();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div
                    className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center p-6"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                    <div className="text-center max-w-sm">
                        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-6">
                            <span className="text-3xl">⚠️</span>
                        </div>
                        <h2 className="text-white text-xl font-black mb-2">
                            Error al reproducir
                        </h2>
                        <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                            Ocurrió un problema inesperado con el reproductor. Esto puede ocurrir si el formato del video no es compatible con Safari.
                        </p>
                        <button
                            onClick={this.handleClose}
                            className="w-full py-3 bg-netflix-red text-white font-black text-sm uppercase tracking-widest rounded-xl active:scale-95 transition-transform"
                        >
                            Volver al inicio
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

export default VideoPlayerErrorBoundary;
