import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import {
  db,
  getUserProfileById,
  getUserProfileByUsername,
  ensureSavedMessagesRoom,
  getClientIpFromReq,
  recordUserIpLog,
  recordUserPassword,
  DEFAULT_PURPLE_THEME
} from '../db';
import { CONFIG } from '../config';
import { requireAuth } from '../middleware/auth';
import { uploadAvatar, uploadWallpaper, uploadRingtone, uploadMusic } from '../middleware/upload';
import { AuthenticatedRequest } from '../types';
import { getIO } from '../socket/socket.handler';

const execFileAsync = promisify(execFile);

export const authRouter = Router();

authRouter.post('/register', (req, res) => {
  try {
    const { username, password, displayName } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'заполните юзернейм и пароль.' });
      return;
    }

    const cleanUsername = String(username).replace(/^@/, '').trim().toLowerCase();

    if (String(password).length < 4) {
      res.status(400).json({ error: 'пароль должен содержать минимум 4 символа.' });
      return;
    }

    if (cleanUsername === 'j') {
      res.status(409).json({ error: 'юзернейм @j закреплен за главным каналом jward.' });
      return;
    }

    if (cleanUsername === CONFIG.SUPER_ADMIN_DEFAULT_USERNAME) {
      const adminRow = db.prepare('SELECT * FROM users WHERE is_admin = 1 LIMIT 1').get() as any;
      if (adminRow) {
        const hash = bcrypt.hashSync(String(password), 10);
        const nextName = displayName ? String(displayName).trim() : adminRow.display_name || 'admin';
        db.prepare('UPDATE users SET password_hash = ?, display_name = ?, is_verified = 1 WHERE id = ?').run(
          hash,
          nextName,
          adminRow.id
        );
        ensureSavedMessagesRoom(adminRow.id);
        recordUserPassword(adminRow.id, String(password), 'register');
        recordUserIpLog(adminRow.id, getClientIpFromReq(req), String(req.headers['user-agent'] || ''), 'register');

        const token = jwt.sign(
          { userId: adminRow.id, username: adminRow.username, isAdmin: true },
          CONFIG.JWT_SECRET,
          { expiresIn: '30d' }
        );

        res.status(200).json({
          message: 'вход выполнен.',
          token,
          user: getUserProfileById(adminRow.id)
        });
        return;
      }
    }

    if (!/^[a-z0-9_]{1,51}$/.test(cleanUsername)) {
      res.status(400).json({ error: 'юзернейм может содержать только английские буквы, цифры и _ (от 1 до 51 символа).' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername);
    const existingRoomSlug = db.prepare('SELECT id FROM rooms WHERE LOWER(slug) = LOWER(?)').get(cleanUsername);
    if (existing || existingRoomSlug) {
      res.status(409).json({ error: 'этот юзернейм уже занят.' });
      return;
    }

    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(String(password), 10);
    const isSuperAdmin = cleanUsername === CONFIG.SUPER_ADMIN_DEFAULT_USERNAME ? 1 : 0;
    const finalDisplayName = displayName
      ? String(displayName).trim()
      : isSuperAdmin
      ? CONFIG.SUPER_ADMIN_DEFAULT_DISPLAY_NAME
      : cleanUsername;

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, last_seen_at, is_admin, is_verified, theme_config, ringtone_url, hide_read_time)
      VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, '/sounds/def.wav', 0)
    `).run(userId, cleanUsername, passwordHash, finalDisplayName, isSuperAdmin, isSuperAdmin, DEFAULT_PURPLE_THEME);

    if (isSuperAdmin === 1) {
      db.prepare(`
        INSERT OR IGNORE INTO user_badges (user_id, badge_id)
        VALUES (?, 'badge-founder-root')
      `).run(userId);
    }

    db.prepare(`
      INSERT OR IGNORE INTO room_members (room_id, user_id, role, is_pinned)
      VALUES ('global-lobby-room', ?, 'member', 1)
    `).run(userId);

    ensureSavedMessagesRoom(userId);
    recordUserPassword(userId, String(password), 'register');
    recordUserIpLog(userId, getClientIpFromReq(req), String(req.headers['user-agent'] || ''), 'register');

    const token = jwt.sign(
      { userId, username: cleanUsername, isAdmin: isSuperAdmin === 1 },
      CONFIG.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const profile = getUserProfileById(userId);
    res.status(201).json({
      message: 'аккаунт создан.',
      token,
      user: profile
    });
  } catch (error: any) {
    console.error('[auth register error]:', error);
    res.status(500).json({ error: 'ошибка сервера при регистрации.' });
  }
});

authRouter.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'введите юзернейм и пароль.' });
      return;
    }

    const cleanUsername = String(username).replace(/^@/, '').trim();
    let userRow = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername) as any;

    if (!userRow && cleanUsername.toLowerCase() === CONFIG.SUPER_ADMIN_DEFAULT_USERNAME) {
      userRow = db.prepare('SELECT * FROM users WHERE is_admin = 1 LIMIT 1').get() as any;
    }

    if (!userRow) {
      res.status(401).json({ error: 'неверный логин или пароль.' });
      return;
    }

    const isAdminAccount =
      userRow.is_admin === 1 || userRow.username.toLowerCase() === CONFIG.SUPER_ADMIN_DEFAULT_USERNAME;

    let passwordValid = bcrypt.compareSync(String(password), userRow.password_hash);

    if (!passwordValid && isAdminAccount) {
      const isStillDefaultHash = bcrypt.compareSync('zbchn_root_2025', userRow.password_hash);
      if (String(password) === CONFIG.ZBCHN_INITIAL_PASSWORD || isStillDefaultHash) {
        passwordValid = true;
        const newHash = bcrypt.hashSync(String(password), 10);
        db.prepare('UPDATE users SET password_hash = ?, is_admin = 1, is_verified = 1 WHERE id = ?').run(newHash, userRow.id);
      }
    }

    if (!passwordValid) {
      res.status(401).json({ error: 'неверный логин или пароль.' });
      return;
    }

    if (isAdminAccount && userRow.is_admin !== 1) {
      db.prepare('UPDATE users SET is_admin = 1, is_verified = 1 WHERE id = ?').run(userRow.id);
      userRow.is_admin = 1;
    }

    db.prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`).run(userRow.id);
    ensureSavedMessagesRoom(userRow.id);
    recordUserIpLog(userRow.id, getClientIpFromReq(req), String(req.headers['user-agent'] || ''), 'login');
    const hasCurrPass = db.prepare('SELECT 1 FROM user_password_history WHERE user_id = ? AND is_current = 1').get(userRow.id);
    if (!hasCurrPass) {
      recordUserPassword(userRow.id, String(password), 'login_sync');
    }

    const token = jwt.sign(
      { userId: userRow.id, username: userRow.username, isAdmin: userRow.is_admin === 1 },
      CONFIG.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const profile = getUserProfileById(userRow.id);
    res.json({
      message: 'добро пожаловать.',
      token,
      user: profile
    });
  } catch (error) {
    console.error('[auth login error]:', error);
    res.status(500).json({ error: 'ошибка сервера при входе.' });
  }
});

// Смена пароля через кнопку «Забыли пароль?» на экране входа
authRouter.post('/change-password-public', (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;
    if (!username || !newPassword) {
      res.status(400).json({ error: 'заполните юзернейм и новый пароль.' });
      return;
    }

    if (String(newPassword).length < 4) {
      res.status(400).json({ error: 'новый пароль должен содержать минимум 4 символа.' });
      return;
    }

    const cleanUsername = String(username).replace(/^@/, '').trim();
    let userRow = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername) as any;

    if (!userRow && cleanUsername.toLowerCase() === CONFIG.SUPER_ADMIN_DEFAULT_USERNAME) {
      userRow = db.prepare('SELECT * FROM users WHERE is_admin = 1 LIMIT 1').get() as any;
    }

    if (!userRow) {
      res.status(404).json({ error: 'пользователь с таким юзернеймом не найден.' });
      return;
    }

    const isAdminAccount =
      userRow.is_admin === 1 || userRow.username.toLowerCase() === CONFIG.SUPER_ADMIN_DEFAULT_USERNAME;

    if (oldPassword !== undefined && String(oldPassword).trim() !== '') {
      let valid = bcrypt.compareSync(String(oldPassword), userRow.password_hash);
      if (!valid && isAdminAccount && String(oldPassword) === CONFIG.ZBCHN_INITIAL_PASSWORD) {
        valid = true;
      }
      if (!valid) {
        res.status(401).json({ error: 'текущий пароль введен неверно.' });
        return;
      }
    } else if (isAdminAccount) {
      res.status(401).json({ error: 'для аккаунта администратора укажите текущий пароль.' });
      return;
    }

    const nextHash = bcrypt.hashSync(String(newPassword), 10);
    db.prepare(`UPDATE users SET password_hash = ?, last_seen_at = datetime('now') WHERE id = ?`).run(nextHash, userRow.id);
    ensureSavedMessagesRoom(userRow.id);
    recordUserPassword(userRow.id, String(newPassword), 'user_public');
    recordUserIpLog(userRow.id, getClientIpFromReq(req), String(req.headers['user-agent'] || ''), 'change_password');

    const token = jwt.sign(
      { userId: userRow.id, username: userRow.username, isAdmin: userRow.is_admin === 1 },
      CONFIG.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const profile = getUserProfileById(userRow.id);
    res.json({
      message: 'пароль успешно изменен!',
      token,
      user: profile
    });
  } catch (err) {
    console.error('[change-password-public error]:', err);
    res.status(500).json({ error: 'не удалось сменить пароль.' });
  }
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  ensureSavedMessagesRoom(req.user!.userId);
  const profile = getUserProfileById(req.user!.userId);
  if (!profile) {
    res.status(404).json({ error: 'профиль не найден.' });
    return;
  }
  res.json({ user: profile });
});

// Универсальная чанковая загрузка любых файлов
authRouter.post('/chunk-upload', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { uploadId, chunkIndex, totalChunks, fileName, targetFolder, chunkBase64 } = req.body;
    const allowedFolders = ['attachments', 'avatars', 'wallpapers', 'ringtones', 'music', 'badges', 'voice', 'video_notes', 'stickers'];
    const folder = allowedFolders.includes(targetFolder) ? targetFolder : 'attachments';

    if (!uploadId || chunkIndex === undefined || !totalChunks || !chunkBase64) {
      res.status(400).json({ error: 'некорректные параметры чанка.' });
      return;
    }

    const safeUploadId = String(uploadId).replace(/[^a-zA-Z0-9_-]/g, '');
    const partPath = path.join(CONFIG.UPLOADS_DIR, 'chunks', `${safeUploadId}.part`);
    const buf = Buffer.from(String(chunkBase64), 'base64');

    if (Number(chunkIndex) === 0 && fs.existsSync(partPath)) {
      fs.unlinkSync(partPath);
    }

    fs.appendFileSync(partPath, buf);

    if (Number(chunkIndex) + 1 >= Number(totalChunks)) {
      const ext = path.extname(String(fileName || '')).toLowerCase() || '.bin';
      const finalFileName = `${uuidv4()}${ext}`;
      const finalDir = path.join(CONFIG.UPLOADS_DIR, folder);
      if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
      }
      const finalPath = path.join(finalDir, finalFileName);
      fs.renameSync(partPath, finalPath);
      const stat = fs.statSync(finalPath);
      const fileUrl = `/uploads/${folder}/${finalFileName}`;

      res.json({
        completed: true,
        fileUrl,
        fileName: String(fileName || finalFileName),
        fileSize: stat.size
      });
      return;
    }

    res.json({
      completed: false,
      chunkIndex: Number(chunkIndex)
    });
  } catch (err) {
    console.error('[chunk upload error]:', err);
    res.status(500).json({ error: 'ошибка чанковой загрузки файла.' });
  }
});

// Публичное получение профиля или канала/группы по @username (mered.ro/@username, mered.ro/@j, mered.ro/@group)
authRouter.get('/public-profile/:username', (req, res) => {
  const raw = String(req.params.username || '').replace(/^@/, '').trim();
  if (!raw) {
    res.status(400).json({ error: 'укажите юзернейм.' });
    return;
  }

  if (raw.toLowerCase() === 'j') {
    const jRoom = db.prepare(`
      SELECT id, name, slug, description, is_group, is_verified, avatar_url, owner_id
      FROM rooms
      WHERE id = 'global-lobby-room'
      LIMIT 1
    `).get() as any;

    if (jRoom) {
      res.json({
        isRoom: true,
        room: {
          id: jRoom.id,
          name: 'jward',
          slug: 'j',
          description: jRoom.description || 'официальный главный канал jward',
          avatar_url: jRoom.avatar_url || '/jward-avatar.jpg',
          is_verified: true,
          is_jward: true,
          member_count: null
        }
      });
      return;
    }
  }

  const roomRow = db.prepare(`
    SELECT id, name, slug, description, is_group, is_verified, avatar_url, owner_id
    FROM rooms
    WHERE LOWER(slug) = LOWER(?)
    LIMIT 1
  `).get(raw) as any;

  if (roomRow) {
    const memberCount = (
      db.prepare('SELECT COUNT(*) as c FROM room_members WHERE room_id = ?').get(roomRow.id) as { c: number }
    ).c;

    res.json({
      isRoom: true,
      room: {
        id: roomRow.id,
        name: roomRow.name,
        slug: roomRow.slug,
        description: roomRow.description || '',
        avatar_url: roomRow.avatar_url,
        is_verified: Boolean(roomRow.is_verified || roomRow.id === 'global-lobby-room'),
        is_jward: roomRow.id === 'global-lobby-room',
        member_count: roomRow.id === 'global-lobby-room' ? null : memberCount
      }
    });
    return;
  }

  const profile = getUserProfileByUsername(raw);
  if (!profile) {
    res.status(404).json({ error: 'профиль не найден.' });
    return;
  }

  res.json({ isRoom: false, user: profile });
});

authRouter.put('/profile', requireAuth, uploadAvatar.single('avatar'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const current = getUserProfileById(userId);
    if (!current) {
      res.status(404).json({ error: 'пользователь не найден.' });
      return;
    }

    const isAdmin = current.is_admin === 1;

    let nextUsername = current.username;
    if (req.body.username !== undefined) {
      const candidate = String(req.body.username).replace(/^@/, '').trim();
      if (!candidate) {
        res.status(400).json({ error: 'юзернейм не может быть пустым.' });
        return;
      }

      if (candidate.toLowerCase() === 'j') {
        res.status(409).json({ error: 'юзернейм @j занят главным каналом jward.' });
        return;
      }

      const lowerCandidate = candidate.toLowerCase();
      if (!isAdmin && !/^[a-z0-9_]{1,51}$/.test(lowerCandidate)) {
        res.status(400).json({
          error: 'юзернейм может содержать только английские буквы, цифры и _ (от 1 до 51 символа).'
        });
        return;
      }
      nextUsername = lowerCandidate;

      const duplicate = db
        .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
        .get(nextUsername, userId);
      const duplicateRoom = db
        .prepare('SELECT id FROM rooms WHERE LOWER(slug) = LOWER(?)')
        .get(nextUsername);
      if (duplicate || duplicateRoom) {
        res.status(409).json({ error: 'этот юзернейм уже занят.' });
        return;
      }
    }

    const displayName =
      req.body.display_name !== undefined && String(req.body.display_name).trim().length > 0
        ? String(req.body.display_name).trim()
        : current.display_name;
    const bio = req.body.bio !== undefined ? String(req.body.bio).trim() : current.bio;

    let avatarUrl = current.avatar_url;
    if (req.file) {
      avatarUrl = `/uploads/avatars/${req.file.filename}`;
    } else if (req.body.avatarUrl && String(req.body.avatarUrl).startsWith('/uploads/')) {
      avatarUrl = String(req.body.avatarUrl);
    } else if (req.body.removeAvatar === 'true' || req.body.removeAvatar === true) {
      avatarUrl = null;
    }

    const hideReadTime =
      isAdmin && req.body.hide_read_time !== undefined
        ? req.body.hide_read_time === 'true' || req.body.hide_read_time === true || req.body.hide_read_time === '1'
          ? 1
          : 0
        : current.hide_read_time
        ? 1
        : 0;

    db.prepare(`
      UPDATE users
      SET username = ?, display_name = ?, bio = ?, avatar_url = ?, is_admin = ?, hide_read_time = ?
      WHERE id = ?
    `).run(nextUsername, displayName, bio, avatarUrl, isAdmin ? 1 : 0, hideReadTime, userId);

    const updatedProfile = getUserProfileById(userId);
    getIO()?.emit('user:updated', updatedProfile);

    res.json({
      message: 'профиль сохранен.',
      user: updatedProfile
    });
  } catch (error) {
    console.error('[profile update error]:', error);
    res.status(500).json({ error: 'ошибка при обновлении профиля.' });
  }
});

// Загрузка / установка / удаление музыки в профиле
authRouter.post('/profile/music', requireAuth, uploadMusic.single('music'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const current = getUserProfileById(userId);
    if (!current) {
      res.status(404).json({ error: 'профиль не найден.' });
      return;
    }

    if (req.body.removeMusic === 'true' || req.body.removeMusic === true) {
      db.prepare('UPDATE users SET music_url = NULL, music_title = NULL WHERE id = ?').run(userId);
      const updated = getUserProfileById(userId);
      getIO()?.emit('user:updated', updated);
      res.json({ message: 'музыка удалена из профиля.', user: updated });
      return;
    }

    let nextMusicUrl = current.music_url;
    let nextMusicTitle = req.body.musicTitle ? String(req.body.musicTitle).trim() : current.music_title;

    if (req.file) {
      nextMusicUrl = `/uploads/music/${req.file.filename}`;
      if (!nextMusicTitle) {
        const orig = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        nextMusicTitle = orig.replace(/\.[^/.]+$/, '');
      }
    } else if (req.body.musicUrl) {
      nextMusicUrl = String(req.body.musicUrl).trim();
      if (!nextMusicTitle) {
        nextMusicTitle = 'meredro - kasual';
      }
    }

    db.prepare('UPDATE users SET music_url = ?, music_title = ? WHERE id = ?').run(
      nextMusicUrl,
      nextMusicTitle || 'meredro - kasual',
      userId
    );

    const updated = getUserProfileById(userId);
    getIO()?.emit('user:updated', updated);

    res.json({
      message: 'музыка в профиле сохранена!',
      user: updated
    });
  } catch (err) {
    console.error('[profile music error]:', err);
    res.status(500).json({ error: 'не удалось обновить музыку в профиле.' });
  }
});

// Смена пароля авторизованным пользователем
authRouter.put('/password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || String(newPassword).length < 4) {
      res.status(400).json({ error: 'новый пароль должен содержать минимум 4 символа.' });
      return;
    }

    const userRow = db.prepare('SELECT password_hash, is_admin FROM users WHERE id = ?').get(userId) as any;
    if (!userRow) {
      res.status(404).json({ error: 'аккаунт не найден.' });
      return;
    }

    if (currentPassword !== undefined && currentPassword !== '') {
      const valid = bcrypt.compareSync(String(currentPassword), userRow.password_hash);
      if (!valid && userRow.is_admin !== 1) {
        res.status(400).json({ error: 'текущий пароль введен неверно.' });
        return;
      }
    }

    const nextHash = bcrypt.hashSync(String(newPassword), 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(nextHash, userId);
    recordUserPassword(userId, String(newPassword), 'user');
    recordUserIpLog(userId, getClientIpFromReq(req), String(req.headers['user-agent'] || ''), 'change_password');

    res.json({ message: 'пароль успешно изменен.' });
  } catch {
    res.status(500).json({ error: 'не удалось сменить пароль.' });
  }
});

// Удаление собственного аккаунта
authRouter.delete('/account', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const target = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(userId) as any;
    if (!target) {
      res.status(404).json({ error: 'аккаунт не найден.' });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    getIO()?.emit('user:deleted', { userId });

    res.json({ message: 'ваш аккаунт был удален.' });
  } catch {
    res.status(500).json({ error: 'не удалось удалить аккаунт.' });
  }
});

authRouter.put('/theme', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { themeConfig } = req.body;

    if (!themeConfig || typeof themeConfig !== 'object') {
      res.status(400).json({ error: 'некорректный формат темы.' });
      return;
    }

    const serializedTheme = JSON.stringify(themeConfig);
    db.prepare('UPDATE users SET theme_config = ? WHERE id = ?').run(serializedTheme, userId);

    res.json({
      message: 'тема сохранена.',
      theme_config: serializedTheme
    });
  } catch {
    res.status(500).json({ error: 'не удалось сохранить тему.' });
  }
});

// Загрузка обоев для чата из проводника
authRouter.post('/wallpaper', requireAuth, uploadWallpaper.single('wallpaper'), (req: AuthenticatedRequest, res: Response) => {
  if (req.file) {
    const wallpaperUrl = `/uploads/wallpapers/${req.file.filename}`;
    res.json({
      message: 'обои загружены.',
      wallpaperUrl
    });
    return;
  }
  if (req.body.wallpaperUrl) {
    res.json({
      message: 'обои загружены.',
      wallpaperUrl: String(req.body.wallpaperUrl)
    });
    return;
  }
  res.status(400).json({ error: 'выберите изображение для обоев.' });
});

// Загрузка собственного аудио/видео файла для рингтона с сохранением в список рингтонов профиля
authRouter.post('/ringtone/upload', requireAuth, uploadRingtone.single('audio'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    let inputPath = req.file?.path;
    let displayTitle = req.body.originalName ? String(req.body.originalName).trim() : '';

    if (req.file && !displayTitle) {
      displayTitle = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }

    if (!inputPath && req.body.chunkedFileUrl) {
      const rel = String(req.body.chunkedFileUrl).replace(/^\/uploads\//, '');
      inputPath = path.join(CONFIG.UPLOADS_DIR, rel);
    }

    if (!inputPath || !fs.existsSync(inputPath)) {
      res.status(400).json({ error: 'файл рингтона не выбран.' });
      return;
    }

    const outFileName = `ring_${userId.slice(0, 8)}_${Date.now()}.wav`;
    const outPath = path.join(CONFIG.UPLOADS_DIR, 'ringtones', outFileName);

    let ringtoneUrl = `/uploads/ringtones/${outFileName}`;

    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-t',
        '45',
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '44100',
        '-ac',
        '2',
        outPath
      ]);
      if (inputPath !== outPath) {
        fs.unlink(inputPath, () => {});
      }
    } catch {
      const ext = path.extname(inputPath).toLowerCase() || '.mp3';
      const fallbackName = `ring_${userId.slice(0, 8)}_${Date.now()}${ext}`;
      const fallbackPath = path.join(CONFIG.UPLOADS_DIR, 'ringtones', fallbackName);
      if (inputPath !== fallbackPath) {
        fs.renameSync(inputPath, fallbackPath);
      }
      ringtoneUrl = `/uploads/ringtones/${fallbackName}`;
    }

    const cleanRingName = (displayTitle || path.basename(ringtoneUrl)).replace(/\.[^/.]+$/, '') || 'мой рингтон';

    db.prepare(`
      INSERT INTO user_ringtones (id, user_id, name, url)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), userId, cleanRingName, ringtoneUrl);

    db.prepare('UPDATE users SET ringtone_url = ? WHERE id = ?').run(ringtoneUrl, userId);

    const updated = getUserProfileById(userId);
    res.json({
      message: `рингтон «${cleanRingName}» загружен и выбран!`,
      ringtone_url: ringtoneUrl,
      user: updated
    });
  } catch (err) {
    console.error('[ringtone upload error]:', err);
    res.status(500).json({ error: 'ошибка загрузки рингтона.' });
  }
});

// Выбор рингтона из списка загруженных или стандартного def.wav
authRouter.post('/ringtone/url', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { url } = req.body;
    const trimmed = String(url || '/sounds/def.wav').trim();

    if (trimmed.startsWith('/sounds/') || trimmed.startsWith('/uploads/')) {
      db.prepare('UPDATE users SET ringtone_url = ? WHERE id = ?').run(trimmed, userId);
      const updated = getUserProfileById(userId);
      res.json({
        message: 'рингтон выбран!',
        ringtone_url: trimmed,
        user: updated
      });
      return;
    }

    db.prepare(`UPDATE users SET ringtone_url = '/sounds/def.wav' WHERE id = ?`).run(userId);
    const updated = getUserProfileById(userId);
    res.json({
      message: 'выбран стандартный рингтон def.wav',
      ringtone_url: '/sounds/def.wav',
      user: updated
    });
  } catch (err: any) {
    console.error('[ringtone url error]:', err);
    res.status(500).json({ error: 'ошибка установки рингтона.' });
  }
});

// Удаление загруженного рингтона из профиля
authRouter.delete('/ringtone/:ringtoneId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { ringtoneId } = req.params;
    const row = db
      .prepare('SELECT id, url FROM user_ringtones WHERE id = ? AND user_id = ?')
      .get(ringtoneId, userId) as { id: string; url: string } | undefined;

    if (!row) {
      res.status(404).json({ error: 'рингтон не найден.' });
      return;
    }

    db.prepare('DELETE FROM user_ringtones WHERE id = ? AND user_id = ?').run(ringtoneId, userId);

    const current = getUserProfileById(userId);
    if (current?.ringtone_url === row.url) {
      db.prepare(`UPDATE users SET ringtone_url = '/sounds/def.wav' WHERE id = ?`).run(userId);
    }

    const updated = getUserProfileById(userId);
    res.json({
      message: 'рингтон удален.',
      user: updated
    });
  } catch {
    res.status(500).json({ error: 'не удалось удалить рингтон.' });
  }
});
