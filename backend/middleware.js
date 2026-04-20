const db = require('./db');
const SESSION_TIMEOUT_MINUTES = parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 60;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@cinevault.local';

const getSessionId = (req) => req.headers['x-session-id'] || req.query.sessionId || req.cookies?.sessionId;

const sessionMiddleware = async (req, res, next) => {
    const sessionId = getSessionId(req);
    if (!sessionId) {
        return res.status(401).json({ error: 'No se encontró sesión activa' });
    }

    try {
        const session = await db.validateSession(sessionId, SESSION_TIMEOUT_MINUTES);
        if (!session) {
            return res.status(401).json({ error: 'Sesión expirada o inválida' });
        }
        req.session = session;
        next();
    } catch (err) {
        console.error('[SessionMiddleware] Error:', err.message);
        res.status(500).json({ error: 'Error validando sesión' });
    }
};

const adminMiddleware = (req, res, next) => {
    // 1. Resolve Admin Email (Priority: ENV > Frontend ENV > Repo Default)
    const adminEmail = (
        process.env.ADMIN_EMAIL || 
        process.env.VITE_ADMIN_EMAIL || 
        'sanwortley@gmail.com'
    ).trim().toLowerCase();

    // 2. Resolve User Email from session
    const userEmail = req.session?.email?.trim().toLowerCase();
                       
    if (userEmail && userEmail === adminEmail) {
        next();
    } else {
        console.warn(`[AdminMiddleware] Access Denied: User(${userEmail}) is not Admin(${adminEmail})`);
        res.status(403).json({ 
            error: 'Acceso restringido a administradores',
            debug: process.env.NODE_ENV === 'development' ? { userEmail, adminEmail } : undefined
        });
    }
};

module.exports = { sessionMiddleware, adminMiddleware };
