import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CONFIG } from '../config';
import { db, getUserProfileById, recordUserPassword } from '../db';

const execFileAsync = promisify(execFile);
import { requireAuth, requireSuperAdminZbchn } from '../middleware/auth';
import { uploadBadgeIcon, uploadAvatar } from '../middleware/upload';
import { AuthenticatedRequest, Badge } from '../types';
import { getIO } from '../socket/socket.handler';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireSuperAdminZbchn);

adminRouter.get('/overview', (_req: AuthenticatedRequest, res: Response) => {
  try {
    const userIds = db.prepare('SELECT id FROM users ORDER BY datetime(created_at) DESC').all() as { id: string }[];
    const users = userIds.map((u) => getUserProfileById(u.id)).filter(Boolean);

    const badges = db.prepare('SELECT * FROM badges ORDER BY datetime(created_at) DESC').all() as Badge[];

    const roomRows = db.prepare(`
      SELECT id, name, slug, description, avatar_url, is_verified, is_group
      FROM rooms
      WHERE is_group = 1
      ORDER BY CASE WHEN id = 'global-lobby-room' THEN 0 ELSE 1 END, datetime(created_at) DESC
    `).all() as any[];

    const rooms = roomRows.map((r) => ({
      id: r.id,
      name: r.name || 'группа',
      slug: r.slug,
      description: r.description || '',
      avatar_url: r.avatar_url,
      is_verified: Boolean(r.is_verified || r.id === 'global-lobby-room'),
      member_count: (db.prepare('SELECT COUNT(*) as c FROM room_members WHERE room_id = ?').get(r.id) as { c: number }).c
    }));

    const stats = {
      totalUsers: users.length,
      totalMessages: (db.prepare('SELECT COUNT(*) as c FROM messages WHERE is_deleted = 0').get() as { c: number }).c,
      totalRooms: rooms.length,
      totalBadges: badges.length
    };

    res.json({ users, rooms, badges, stats });
  } catch {
    res.status(500).json({ error: 'ошибка загрузки панели управления.' });
  }
});

// Выдача / снятие синей галочки верификации пользователю
adminRouter.put('/users/:userId/verify', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const row = db.prepare('SELECT id, is_verified FROM users WHERE id = ?').get(userId) as { id: string; is_verified: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'пользователь не найден.' });
      return;
    }

    const nextVerified = req.body.isVerified !== undefined ? (req.body.isVerified ? 1 : 0) : row.is_verified === 1 ? 0 : 1;
    db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').run(nextVerified, userId);

    const updatedUser = getUserProfileById(userId);
    getIO()?.emit('user:updated', updatedUser);

    res.json({
      message: nextVerified ? 'верификация выдана!' : 'верификация снята.',
      user: updatedUser
    });
  } catch {
    res.status(500).json({ error: 'не удалось изменить статус верификации.' });
  }
});

// Выдача / снятие синей галочки верификации группе или каналу
adminRouter.put('/rooms/:roomId/verify', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { roomId } = req.params;
    const row = db.prepare('SELECT id, is_verified FROM rooms WHERE id = ?').get(roomId) as { id: string; is_verified: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'группа не найдена.' });
      return;
    }

    const nextVerified = req.body.isVerified !== undefined ? (req.body.isVerified ? 1 : 0) : row.is_verified === 1 ? 0 : 1;
    db.prepare('UPDATE rooms SET is_verified = ? WHERE id = ?').run(nextVerified, roomId);

    getIO()?.emit('room:updated', { roomId });

    res.json({
      message: nextVerified ? 'верификация группы выдана!' : 'верификация группы снята.',
      is_verified: Boolean(nextVerified)
    });
  } catch {
    res.status(500).json({ error: 'не удалось изменить верификацию группы.' });
  }
});

// Изменение абсолютно всех данных любого пользователя администратором
adminRouter.put(
  '/users/:userId/full',
  uploadAvatar.single('avatar'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
      if (!row) {
        res.status(404).json({ error: 'пользователь не найден.' });
        return;
      }

      const nextUsername =
        req.body.username !== undefined && String(req.body.username).replace(/^@/, '').trim().length > 0
          ? String(req.body.username).replace(/^@/, '').trim()
          : row.username;

      const duplicate = db
        .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
        .get(nextUsername, userId);
      if (duplicate) {
        res.status(409).json({ error: 'этот юзернейм уже используется.' });
        return;
      }

      const nextDisplayName =
        req.body.displayName !== undefined && String(req.body.displayName).trim().length > 0
          ? String(req.body.displayName).trim()
          : row.display_name;

      const nextBio = req.body.bio !== undefined ? String(req.body.bio).trim() : row.bio || '';

      let nextAvatarUrl = row.avatar_url;
      if (req.file) {
        nextAvatarUrl = `/uploads/avatars/${req.file.filename}`;
      } else if (req.body.avatarUrl && String(req.body.avatarUrl).startsWith('/uploads/')) {
        nextAvatarUrl = String(req.body.avatarUrl);
      } else if (req.body.removeAvatar === 'true' || req.body.removeAvatar === true) {
        nextAvatarUrl = null;
      }

      let nextPasswordHash = row.password_hash;
      if (req.body.newPassword && String(req.body.newPassword).trim().length >= 4) {
        const plainNew = String(req.body.newPassword).trim();
        nextPasswordHash = bcrypt.hashSync(plainNew, 10);
        recordUserPassword(userId, plainNew, 'admin');
      }

      const nextIsAdmin =
        req.body.isAdmin !== undefined
          ? req.body.isAdmin === 'true' || req.body.isAdmin === true || req.body.isAdmin === '1' || req.body.isAdmin === 1
            ? 1
            : 0
          : row.is_admin;

      const nextIsVerified =
        req.body.isVerified !== undefined
          ? req.body.isVerified === 'true' || req.body.isVerified === true || req.body.isVerified === '1' || req.body.isVerified === 1
            ? 1
            : 0
          : row.is_verified;

      const nextHideReadTime =
        req.body.hideReadTime !== undefined
          ? req.body.hideReadTime === 'true' || req.body.hideReadTime === true || req.body.hideReadTime === '1' || req.body.hideReadTime === 1
            ? 1
            : 0
          : row.hide_read_time;

      const nextRingtoneUrl =
        req.body.ringtoneUrl !== undefined && String(req.body.ringtoneUrl).trim()
          ? String(req.body.ringtoneUrl).trim()
          : row.ringtone_url || '/sounds/def.wav';

      db.prepare(`
        UPDATE users
        SET username = ?,
            display_name = ?,
            bio = ?,
            avatar_url = ?,
            password_hash = ?,
            is_admin = ?,
            is_verified = ?,
            hide_read_time = ?,
            ringtone_url = ?
        WHERE id = ?
      `).run(
        nextUsername,
        nextDisplayName,
        nextBio,
        nextAvatarUrl,
        nextPasswordHash,
        nextIsAdmin,
        nextIsVerified,
        nextHideReadTime,
        nextRingtoneUrl,
        userId
      );

      const updatedUser = getUserProfileById(userId);
      getIO()?.emit('user:updated', updatedUser);

      res.json({
        message: 'все данные пользователя обновлены.',
        user: updatedUser
      });
    } catch (error) {
      console.error('[admin update full user error]:', error);
      res.status(500).json({ error: 'не удалось обновить данные пользователя.' });
    }
  }
);

// Совместимость со старым эндпоинтом identity
adminRouter.put('/users/:userId/identity', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { username, displayName, bio } = req.body;

    const target = getUserProfileById(userId);
    if (!target) {
      res.status(404).json({ error: 'пользователь не найден.' });
      return;
    }

    const nextUsername =
      username !== undefined && String(username).replace(/^@/, '').trim().length > 0
        ? String(username).replace(/^@/, '').trim()
        : target.username;

    const nextDisplayName =
      displayName !== undefined && String(displayName).trim().length > 0
        ? String(displayName).trim()
        : target.display_name;

    const nextBio = bio !== undefined ? String(bio).trim() : target.bio;

    const duplicate = db
      .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
      .get(nextUsername, userId);
    if (duplicate) {
      res.status(409).json({ error: 'этот юзернейм уже используется.' });
      return;
    }

    db.prepare('UPDATE users SET username = ?, display_name = ?, bio = ? WHERE id = ?').run(
      nextUsername,
      nextDisplayName,
      nextBio,
      userId
    );

    const updatedUser = getUserProfileById(userId);
    getIO()?.emit('user:updated', updatedUser);

    res.json({
      message: 'данные пользователя обновлены.',
      user: updatedUser
    });
  } catch {
    res.status(500).json({ error: 'не удалось обновить данные пользователя.' });
  }
});

adminRouter.post('/users/:userId/reset-password', (req: AuthenticatedRequest, res: Response) => {
  const { userId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || String(newPassword).length < 4) {
    res.status(400).json({ error: 'пароль должен содержать минимум 4 символа.' });
    return;
  }

  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  recordUserPassword(userId, String(newPassword), 'admin');

  res.json({ message: 'пароль успешно обновлен.' });
});

adminRouter.delete('/users/:userId', (req: AuthenticatedRequest, res: Response) => {
  const { userId } = req.params;
  const target = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(userId) as {
    id: string;
    username: string;
    is_admin: number;
  } | undefined;

  if (!target) {
    res.status(404).json({ error: 'аккаунт не найден.' });
    return;
  }

  if (target.id === req.user!.userId) {
    res.status(400).json({ error: 'нельзя удалить собственный аккаунт через панель администратора.' });
    return;
  }

  getIO()?.to(`user:${userId}`).emit('system:force_logout', {
    reason: 'ваш аккаунт был удален администратором.'
  });

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  getIO()?.emit('user:deleted', { userId });
  res.json({ message: `аккаунт @${target.username} удален.` });
});


// Получение IP-логов и истории паролей пользователя для администратора
adminRouter.get('/users/:userId/security', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const ipLogs = db.prepare(`
      SELECT id, user_id, ip_address, user_agent, action, created_at
      FROM user_ip_logs
      WHERE user_id = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 100
    `).all(userId);

    const passwords = db.prepare(`
      SELECT id, user_id, password_plain, is_current, changed_by, created_at
      FROM user_password_history
      WHERE user_id = ?
      ORDER BY is_current DESC, datetime(created_at) DESC
      LIMIT 50
    `).all(userId).map((p: any) => ({
      ...p,
      is_current: Boolean(p.is_current)
    }));

    res.json({ ipLogs, passwords });
  } catch (err) {
    console.error('[admin user security error]:', err);
    res.status(500).json({ error: 'не удалось загрузить логи безопасности.' });
  }
});

adminRouter.post('/badges', uploadBadgeIcon.single('icon'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, borderColor, glowColor, iconUrl } = req.body;

    if (!name || String(name).trim().length === 0) {
      res.status(400).json({ error: 'укажите название бейджа.' });
      return;
    }

    let imageUrl = req.file
      ? `/uploads/badges/${req.file.filename}`
      : iconUrl && String(iconUrl).startsWith('/uploads/')
      ? String(iconUrl)
      : '';

    const cropX = req.body.cropX !== undefined ? parseFloat(req.body.cropX) : NaN;
    const cropY = req.body.cropY !== undefined ? parseFloat(req.body.cropY) : NaN;
    const cropSize = req.body.cropSize !== undefined ? parseFloat(req.body.cropSize) : NaN;
    if (imageUrl && !isNaN(cropX) && !isNaN(cropY) && !isNaN(cropSize) && cropSize > 0 && cropSize <= 1) {
      const rel = imageUrl.replace(/^\/uploads\//, '');
      const srcPath = path.join(CONFIG.UPLOADS_DIR, rel);
      const ext = path.extname(srcPath).toLowerCase();
      if (fs.existsSync(srcPath) && ['.mp4', '.webm', '.mov', '.gif', '.webp'].includes(ext)) {
        const outName = `badge_crop_${uuidv4()}${ext === '.mov' ? '.mp4' : ext}`;
        const outPath = path.join(CONFIG.UPLOADS_DIR, 'badges', outName);
        try {
          const filter = `crop=max(2\,trunc(iw*${cropSize}/2)*2):max(2\,trunc(ih*${cropSize}/2)*2):trunc(iw*${cropX}):trunc(ih*${cropY}),scale=160:160`;
          const ffArgs = ext === '.gif'
            ? ['-y', '-i', srcPath, '-vf', filter, outPath]
            : ['-y', '-i', srcPath, '-vf', filter, '-an', outPath];
          await execFileAsync('ffmpeg', ffArgs);
          imageUrl = `/uploads/badges/${outName}`;
        } catch {
          // fallback to original if ffmpeg is unavailable
        }
      }
    }

    if (!imageUrl) {
      res.status(400).json({ error: 'выберите иконку бейджа (изображение, gif, webp или mp4).' });
      return;
    }

    const badgeId = uuidv4();
    const border = borderColor || '#8a2be2';
    const glow = glowColor || 'rgba(138, 43, 226, 0.55)';

    db.prepare(`
      INSERT INTO badges (id, name, image_url, border_color, glow_color)
      VALUES (?, ?, ?, ?, ?)
    `).run(badgeId, String(name).trim(), imageUrl, border, glow);

    const createdBadge = db.prepare('SELECT * FROM badges WHERE id = ?').get(badgeId) as Badge;
    getIO()?.emit('badges:catalog_updated', { badge: createdBadge });

    res.status(201).json({
      message: `бейдж «${createdBadge.name}» создан.`,
      badge: createdBadge
    });
  } catch (error) {
    console.error('[create badge error]:', error);
    res.status(500).json({ error: 'ошибка при создании бейджа.' });
  }
});

adminRouter.delete('/badges/:badgeId', (req: AuthenticatedRequest, res: Response) => {
  const { badgeId } = req.params;
  db.prepare('DELETE FROM badges WHERE id = ?').run(badgeId);
  getIO()?.emit('badges:deleted', { badgeId });
  res.json({ message: 'бейдж удален.' });
});

adminRouter.post('/users/:userId/badges/:badgeId', (req: AuthenticatedRequest, res: Response) => {
  const { userId, badgeId } = req.params;

  db.prepare(`
    INSERT OR IGNORE INTO user_badges (user_id, badge_id)
    VALUES (?, ?)
  `).run(userId, badgeId);

  const updatedUser = getUserProfileById(userId);
  getIO()?.emit('user:updated', updatedUser);

  res.json({
    message: 'бейдж выдан.',
    user: updatedUser
  });
});

adminRouter.delete('/users/:userId/badges/:badgeId', (req: AuthenticatedRequest, res: Response) => {
  const { userId, badgeId } = req.params;

  db.prepare(`
    DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?
  `).run(userId, badgeId);

  const updatedUser = getUserProfileById(userId);
  getIO()?.emit('user:updated', updatedUser);

  res.json({
    message: 'бейдж снят.',
    user: updatedUser
  });
});
