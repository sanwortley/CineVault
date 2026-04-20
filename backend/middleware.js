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
    const adminEmail = process.env.VITE_ADMIN_EMAIL?.trim().toLowerCase() || ADMIN_EMAIL;
    const userEmail = req.session?.email?.trim().toLowerCase() || 
                      req.headers['x-user-email']?.trim().toLowerCase();
                      
    if (adminEmail && userEmail === adminEmail) {
        next();
    } else {
        res.status(403).json({ error: 'Acceso restringido a administradores' });
    }
};

module.exports = { sessionMiddleware, adminMiddleware };
