import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config';
import { db } from '../db';
import { AuthenticatedRequest, JwtPayload } from '../types';

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'требуется авторизация.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as JwtPayload;
    const dbUser = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(decoded.userId) as {
      id: string;
      username: string;
      is_admin: number;
    } | undefined;

    if (!dbUser) {
      res.status(401).json({ error: 'аккаунт не найден.' });
      return;
    }

    req.user = {
      userId: dbUser.id,
      username: dbUser.username,
      isAdmin: dbUser.is_admin === 1
    };

    next();
  } catch {
    res.status(401).json({ error: 'недействительный токен авторизации.' });
  }
}

export function requireSuperAdminZbchn(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'необходима авторизация.' });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'доступ ограничен.' });
    return;
  }

  next();
}
