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
                    DEFAULT: '#020617', // Slate 950
                    lighter: '#0f172a', // Slate 900
                    card: 'rgba(15, 23, 42, 0.4)',
                    accent: '#06b6d4', // Cyan 500
                    border: 'rgba(255, 255, 255, 0.05)',
                }
            },
            animation: {
                'glow': 'glow 3s ease-in-out infinite alternate',
                'fade-in': 'fadeIn 0.5s ease-out forwards',
                'fade-in-up': 'fadeInUp 0.6s ease-out forwards',
            },
            keyframes: {
                glow: {
                    '0%': { boxShadow: '0 0 5px rgba(6, 182, 212, 0.1)' },
                    '100%': { boxShadow: '0 0 15px rgba(6, 182, 212, 0.4)' },
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
