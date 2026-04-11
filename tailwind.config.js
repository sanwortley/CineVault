/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                dark: {
                    DEFAULT: '#000000', // Pure black
                    lighter: '#141414', // Netflix black
                    card: 'rgba(20, 20, 20, 0.7)',
                    accent: '#E50914', // Netflix Red
                    border: 'rgba(255, 255, 255, 0.1)',
                },
                netflix: {
                    red: '#E50914',
                    black: '#141414',
                    dark: '#000000',
                },
                crimson: {
                    DEFAULT: '#991B1B',
                    light: '#DC2626',
                    dark: '#7F1D1D',
                }
            },
            animation: {
                'glow': 'glow 3s ease-in-out infinite alternate',
                'premium-glow': 'premiumGlow 4s ease-in-out infinite alternate',
                'fade-in': 'fadeIn 0.5s ease-out forwards',
                'fade-in-up': 'fadeInUp 0.6s ease-out forwards',
            },
            keyframes: {
                glow: {
                    '0%': { boxShadow: '0 0 5px rgba(234, 179, 8, 0.1)' },
                    '100%': { boxShadow: '0 0 15px rgba(234, 179, 8, 0.4)' },
                },
                premiumGlow: {
                    '0%': { boxShadow: '0 0 10px rgba(234, 179, 8, 0.1), 0 0 20px rgba(153, 27, 27, 0.05)' },
                    '100%': { boxShadow: '0 0 20px rgba(234, 179, 8, 0.3), 0 0 40px rgba(153, 27, 27, 0.15)' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                fadeInUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                }
            },
            backdropBlur: {
                xs: '2px',
            }
        },
    },
    plugins: [],
}
