import { Request, Response, NextFunction } from 'express'
import db from './db'

const SESSION_TIMEOUT_MINUTES = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '60', 10)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@cinevault.local'

const getSessionId = (req: Request): string | undefined =>
  req.headers['x-session-id'] as string | undefined ||
  req.query.sessionId as string | undefined ||
  req.cookies?.sessionId

const sessionMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const sessionId = getSessionId(req)
  if (!sessionId) {
    res.status(401).json({ error: 'No se encontró sesión activa' })
    return
  }

  try {
    const session = await db.validateSession(sessionId, SESSION_TIMEOUT_MINUTES)
    if (!session) {
      res.status(401).json({ error: 'Sesión expirada o inválida' })
      return
    }
    req.session = session
    next()
  } catch (err: unknown) {
    const error = err as Error
    console.error('[SessionMiddleware] Error:', error.message)
    res.status(500).json({ error: 'Error validando sesión' })
  }
}

const adminMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const adminEmailFromEnv = (
    process.env.ADMIN_EMAIL ||
    process.env.VITE_ADMIN_EMAIL ||
    ''
  ).trim().toLowerCase()
  const ownerEmail = 'sanwortley@gmail.com'

  const headerEmail = req.headers['x-user-email']
  const userEmail = (
    req.session?.email ||
    (typeof headerEmail === 'string' ? headerEmail : undefined)
  )?.trim().toLowerCase()

  const isAuthorized = !!userEmail && (
    userEmail === ownerEmail ||
    (!!adminEmailFromEnv && userEmail === adminEmailFromEnv)
  )

  if (isAuthorized) {
    next()
  } else {
    console.warn(
      `[AdminMiddleware] Access Denied: User(${userEmail}) is not authorized as Admin. Expected: ${ownerEmail} or ${adminEmailFromEnv}`
    )
    res.status(403).json({
      error: 'Acceso restringido a administradores',
      current_user: userEmail || 'No se detectó email en la sesión',
      hint: 'Cierra sesión y vuelve a entrar si el email es incorrecto.',
    })
  }
}

export { sessionMiddleware, adminMiddleware }
