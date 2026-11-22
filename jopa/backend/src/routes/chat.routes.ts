import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../config';

const execFileAsync = promisify(execFile);
import {
  db,
  getMessageByIdDTO,
  getUserProfileById,
  getNextMsgNumber,
  markRoomMessagesRead,
  ensureSavedMessagesRoom,
  ensureDirectRoom
} from '../db';
import { requireAuth } from '../middleware/auth';
import {
  uploadAttachment,
  uploadVoice,
  uploadAvatar,
  uploadVideoNote,
  uploadWallpaper,
  uploadSticker
} from '../middleware/upload';
import { AuthenticatedRequest, UserProfile } from '../types';
import { getIO, broadcastMessageUpdateToRoom } from '../socket/socket.handler';

export const chatRouter = Router();

chatRouter.use(requireAuth);


function emitGroupJoinSystemMessage(roomId: string, joinedUserId: string): void {
  if (!roomId || roomId === 'global-lobby-room') return;
  const room = db.prepare('SELECT id, is_group FROM rooms WHERE id = ?').get(roomId) as { id: string; is_group: number } | undefined;
  if (!room || room.is_group !== 1) return;
  const u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(joinedUserId) as { username: string; display_name: string } | undefined;
  if (!u) return;

  const msgId = uuidv4();
  const nextNum = getNextMsgNumber(roomId);
  const content = `@${u.username} присоединился к группе`;
  db.prepare(`
    INSERT INTO messages (id, room_id, msg_number, sender_id, content, type)
    VALUES (?, ?, ?, ?, ?, 'system')
  `).run(msgId, roomId, nextNum, joinedUserId, content);

  broadcastMessageUpdateToRoom(roomId, msgId, 'message:new');
}

function detectAttachmentType(fileNameOrUrl: string, mimeType?: string): 'image' | 'video' | 'audio' | 'file' {
  const mime = (mimeType || '').toLowerCase();
  const ext = path.extname(fileNameOrUrl || '').toLowerCase();

  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.apng', '.svg'].includes(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv', '.m4v'].includes(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus'].includes(ext)) {
    return 'audio';
  }
  return 'file';
}

function generateUniqueRoomSlug(baseName: string, excludeRoomId?: string): string {
  const translitMap: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };

  let slug = baseName
    .toLowerCase()
    .split('')
    .map((ch) => (translitMap[ch] !== undefined ? translitMap[ch] : ch))
    .join('')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);

  if (!slug || slug === 'j') {
    slug = `group_${Math.floor(1000 + Math.random() * 9000)}`;
  }

  let candidate = slug;
  let suffix = 1;
  while (true) {
    const existingRoom = excludeRoomId
      ? db.prepare('SELECT id FROM rooms WHERE LOWER(slug) = LOWER(?) AND id != ?').get(candidate, excludeRoomId)
      : db.prepare('SELECT id FROM rooms WHERE LOWER(slug) = LOWER(?)').get(candidate);
    const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(candidate);
    if (!existingRoom && !existingUser) {
      return candidate;
    }
    candidate = `${slug}_${suffix++}`;
  }
}

export function buildRoomDTO(room: any, userId: string, isAdmin: boolean) {
  const isJward = room.id === 'global-lobby-room';
  const isSaved = Boolean(room.is_saved);

  const memberRows = db.prepare(`
    SELECT user_id FROM room_members WHERE room_id = ?
  `).all(room.id) as { user_id: string }[];

  let members: UserProfile[] = [];
  if (isJward && !isAdmin) {
    members = [];
  } else {
    members = memberRows
      .map((m) => getUserProfileById(m.user_id, userId))
      .filter((u): u is UserProfile => u !== null);
  }

  const lastMsgRow = db.prepare(`
    SELECT id FROM messages
    WHERE room_id = ? AND is_deleted = 0
    ORDER BY datetime(created_at) DESC, rowid DESC
    LIMIT 1
  `).get(room.id) as { id: string } | undefined;

  const lastMessage = lastMsgRow
    ? getMessageByIdDTO(lastMsgRow.id, { viewerIsAdmin: isAdmin, viewerUserId: userId })
    : null;

  const unreadRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM messages m
    LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = ?
    WHERE m.room_id = ?
      AND m.sender_id != ?
      AND m.is_deleted = 0
      AND mr.message_id IS NULL
  `).get(userId, room.id, userId) as { cnt: number };

  const pinnedRows = db.prepare(`
    SELECT id FROM messages WHERE room_id = ? AND is_pinned = 1 AND is_deleted = 0
    ORDER BY COALESCE(pin_order, 0) ASC, datetime(created_at) DESC, rowid DESC
  `).all(room.id) as { id: string }[];

  const pinnedMessages = pinnedRows
    .map((p) => getMessageByIdDTO(p.id, { viewerIsAdmin: isAdmin, viewerUserId: userId }))
    .filter((m) => m !== null);

  const selfProfile = getUserProfileById(userId);
  let displayTitle = isJward ? 'jward' : isSaved ? 'избранное' : room.name;
  let displayAvatar = isJward ? '/jward-avatar.jpg' : isSaved ? null : room.avatar_url;
  let roomSlug = isJward ? 'j' : isSaved ? selfProfile?.username || null : room.slug || null;
  let isVerified = isJward ? true : Boolean(room.is_verified);

  if (room.is_group === 0 && !isSaved) {
    const partner = members.find((m) => m.id !== userId) || members[0];
    if (partner) {
      displayTitle = partner.display_name;
      displayAvatar = partner.avatar_url;
      roomSlug = partner.username;
      isVerified = Boolean(partner.is_verified);
    }
  } else if (!isJward && !isSaved && !roomSlug) {
    roomSlug = generateUniqueRoomSlug(room.name || 'group', room.id);
    db.prepare('UPDATE rooms SET slug = ? WHERE id = ?').run(roomSlug, room.id);
  }

  return {
    id: room.id,
    name: displayTitle || 'диалог',
    slug: roomSlug,
    description: isSaved
      ? 'личные заметки, медиа и сохраненные сообщения'
      : room.description || (isJward ? 'официальный главный канал jward' : ''),
    is_group: Boolean(room.is_group),
    is_saved: isSaved,
    is_jward: isJward,
    is_verified: isVerified,
    is_pinned: isJward ? true : Boolean(room.user_is_pinned || room.is_pinned_room),
    pin_order: room.user_pin_order || 0,
    cannot_unpin: isJward,
    avatar_url: displayAvatar,
    owner_id: room.owner_id,
    wallpaper_url: room.wallpaper_url || null,
    theme_config: room.theme_config || null,
    unread_count: isSaved ? 0 : unreadRow.cnt,
    members,
    last_message: lastMessage,
    pinned_messages: pinnedMessages
  };
}

chatRouter.get('/rooms', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;

    db.prepare(`
      INSERT OR IGNORE INTO room_members (room_id, user_id, role, is_pinned, pin_order)
      VALUES ('global-lobby-room', ?, 'member', 1, 0)
    `).run(userId);

    ensureSavedMessagesRoom(userId);

    const rooms = db.prepare(`
      SELECT r.*, rm.role, rm.last_read_at, rm.is_pinned as user_is_pinned, COALESCE(rm.pin_order, 0) as user_pin_order
      FROM rooms r
      INNER JOIN room_members rm ON rm.room_id = r.id
      WHERE rm.user_id = ?
      ORDER BY
        CASE WHEN rm.is_pinned = 1 OR r.id = 'global-lobby-room' THEN 0 ELSE 1 END,
        COALESCE(rm.pin_order, 0) ASC,
        CASE WHEN r.id = 'global-lobby-room' THEN 0 ELSE 1 END,
        CASE WHEN r.is_saved = 1 THEN 0 ELSE 1 END,
        datetime(r.created_at) DESC
    `).all(userId) as any[];

    const result = rooms.map((room) => buildRoomDTO(room, userId, isAdmin));
    res.json({ rooms: result });
  } catch (error) {
    console.error('[get rooms error]:', error);
    res.status(500).json({ error: 'ошибка загрузки списка чатов.' });
  }
});

// Изменение расположения (порядка) закрепленных чатов в сайдбаре
chatRouter.put('/rooms/reorder-pins', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { orderedRoomIds } = req.body;
    if (!Array.isArray(orderedRoomIds)) {
      res.status(400).json({ error: 'некорректный список чатов.' });
      return;
    }

    const stmt = db.prepare('UPDATE room_members SET pin_order = ? WHERE room_id = ? AND user_id = ?');
    const tx = db.transaction(() => {
      orderedRoomIds.forEach((rid, idx) => {
        stmt.run(idx + 1, String(rid), userId);
      });
    });
    tx();

    res.json({ message: 'расположение закрепов обновлено.' });
  } catch {
    res.status(500).json({ error: 'не удалось изменить порядок закрепов.' });
  }
});

// Изменение порядка закрепленных сообщений внутри чата
chatRouter.put('/rooms/:roomId/reorder-pinned-messages', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { roomId } = req.params;
    const { orderedMessageIds } = req.body;
    if (!Array.isArray(orderedMessageIds)) {
      res.status(400).json({ error: 'некорректный список сообщений.' });
      return;
    }

    const stmt = db.prepare('UPDATE messages SET pin_order = ? WHERE id = ? AND room_id = ?');
    const tx = db.transaction(() => {
      orderedMessageIds.forEach((mid, idx) => {
        stmt.run(idx + 1, String(mid), roomId);
      });
    });
    tx();

    getIO()?.emit('room:updated', { roomId });
    res.json({ message: 'порядок закрепленных сообщений обновлен.' });
  } catch {
    res.status(500).json({ error: 'не удалось изменить порядок закрепов.' });
  }
});

// Открытие комнаты «Избранное»
chatRouter.post('/rooms/saved', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const savedRoomId = ensureSavedMessagesRoom(userId);
    getIO()?.in(`user:${userId}`).socketsJoin(`room:${savedRoomId}`);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(savedRoomId);
    res.json({ roomId: savedRoomId, room: buildRoomDTO(room, userId, isAdmin) });
  } catch {
    res.status(500).json({ error: 'не удалось открыть избранное.' });
  }
});

// Разрешение ссылки mered.ro/@slug или mered.ro/@slug/123
chatRouter.get('/resolve/:slug', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const myUsername = req.user!.username;
    const cleanSlug = String(req.params.slug || '').replace(/^@/, '').trim();

    if (!cleanSlug) {
      res.status(400).json({ error: 'не указан адрес.' });
      return;
    }

    if (cleanSlug.toLowerCase() === 'j') {
      db.prepare(`
        INSERT OR IGNORE INTO room_members (room_id, user_id, role, is_pinned)
        VALUES ('global-lobby-room', ?, 'member', 1)
      `).run(userId);
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get('global-lobby-room');
      res.json({ type: 'room', roomId: 'global-lobby-room', room: buildRoomDTO(room, userId, isAdmin) });
      return;
    }

    if (
      cleanSlug.toLowerCase() === myUsername.toLowerCase() ||
      cleanSlug.toLowerCase() === 'saved' ||
      cleanSlug.toLowerCase() === 'избранное'
    ) {
      const savedRoomId = ensureSavedMessagesRoom(userId);
      getIO()?.in(`user:${userId}`).socketsJoin(`room:${savedRoomId}`);
      const savedRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(savedRoomId);
      res.json({
        type: 'room',
        isSaved: true,
        roomId: savedRoomId,
        room: buildRoomDTO(savedRoom, userId, isAdmin)
      });
      return;
    }

    const groupRoom = db.prepare('SELECT * FROM rooms WHERE LOWER(slug) = LOWER(?) LIMIT 1').get(cleanSlug) as any;
    if (groupRoom) {
      const wasMember = Boolean(
        db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(groupRoom.id, userId)
      );
      if (!wasMember) {
        db.prepare(`
          INSERT OR IGNORE INTO room_members (room_id, user_id, role)
          VALUES (?, ?, 'member')
        `).run(groupRoom.id, userId);
        emitGroupJoinSystemMessage(groupRoom.id, userId);
        getIO()?.to(`room:${groupRoom.id}`).emit('room:member_joined', { roomId: groupRoom.id });
        getIO()?.to(`user:${userId}`).emit('room:created', { roomId: groupRoom.id });
      }
      getIO()?.in(`user:${userId}`).socketsJoin(`room:${groupRoom.id}`);
      res.json({
        type: 'room',
        joined: !wasMember,
        roomId: groupRoom.id,
        room: buildRoomDTO(groupRoom, userId, isAdmin)
      });
      return;
    }

    const targetUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1').get(cleanSlug) as { id: string } | undefined;
    if (targetUser) {
      if (targetUser.id === userId) {
        const savedRoomId = ensureSavedMessagesRoom(userId);
        getIO()?.in(`user:${userId}`).socketsJoin(`room:${savedRoomId}`);
        const savedRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(savedRoomId);
        res.json({
          type: 'room',
          isSaved: true,
          roomId: savedRoomId,
          room: buildRoomDTO(savedRoom, userId, isAdmin)
        });
        return;
      }

      const directRoomId = ensureDirectRoom(userId, targetUser.id);
      const io = getIO();
      io?.in(`user:${userId}`).socketsJoin(`room:${directRoomId}`);
      io?.in(`user:${targetUser.id}`).socketsJoin(`room:${directRoomId}`);

      res.json({
        type: 'user',
        user: getUserProfileById(targetUser.id, userId),
        directRoomId
      });
      return;
    }

    res.status(404).json({ error: 'ничего не найдено по этой ссылке.' });
  } catch {
    res.status(500).json({ error: 'ошибка разрешения ссылки.' });
  }
});

// Поиск пользователей
chatRouter.get('/users/search', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const q = String(req.query.q || '').replace(/^@/, '').trim();
  if (!q) {
    res.json({ users: [] });
    return;
  }

  const rows = db.prepare(`
    SELECT id FROM users
    WHERE username LIKE ? OR display_name LIKE ?
    ORDER BY datetime(created_at) DESC
    LIMIT 40
  `).all(`%${q}%`, `%${q}%`) as { id: string }[];

  const users = rows.map((r) => getUserProfileById(r.id, userId)).filter(Boolean);
  res.json({ users });
});

chatRouter.get('/contacts', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const rows = db.prepare(`
      SELECT contact_id FROM contacts
      WHERE user_id = ?
      ORDER BY datetime(created_at) DESC
    `).all(userId) as { contact_id: string }[];

    const contacts = rows
      .map((r) => getUserProfileById(r.contact_id, userId))
      .filter((u): u is UserProfile => u !== null);

    res.json({ contacts });
  } catch {
    res.status(500).json({ error: 'не удалось загрузить контакты.' });
  }
});

chatRouter.post('/contacts/:targetUserId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { targetUserId } = req.params;
    const { customName } = req.body || {};

    if (!targetUserId || targetUserId === userId) {
      res.status(400).json({ error: 'некорректный пользователь.' });
      return;
    }

    const target = getUserProfileById(targetUserId, userId);
    if (!target) {
      res.status(404).json({ error: 'пользователь не найден.' });
      return;
    }

    db.prepare(`
      INSERT OR IGNORE INTO contacts (user_id, contact_id, custom_name)
      VALUES (?, ?, ?)
    `).run(userId, targetUserId, customName ? String(customName).trim() : null);

    const rows = db.prepare('SELECT contact_id FROM contacts WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(userId) as { contact_id: string }[];
    const contacts = rows.map((r) => getUserProfileById(r.contact_id, userId)).filter(Boolean);

    res.json({ message: 'добавлено в контакты.', contacts });
  } catch {
    res.status(500).json({ error: 'ошибка добавления в контакты.' });
  }
});

chatRouter.put('/contacts/:targetUserId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { targetUserId } = req.params;
    const { customName } = req.body;

    const cleanCustomName =
      customName !== undefined && String(customName).trim().length > 0
        ? String(customName).trim()
        : null;

    db.prepare(`
      INSERT INTO contacts (user_id, contact_id, custom_name)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, contact_id) DO UPDATE SET custom_name = excluded.custom_name
    `).run(userId, targetUserId, cleanCustomName);

    const rows = db.prepare('SELECT contact_id FROM contacts WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(userId) as { contact_id: string }[];
    const contacts = rows.map((r) => getUserProfileById(r.contact_id, userId)).filter(Boolean);
    const updatedTarget = getUserProfileById(targetUserId, userId);

    res.json({
      message: 'имя контакта сохранено.',
      contacts,
      contact: updatedTarget
    });
  } catch {
    res.status(500).json({ error: 'не удалось изменить имя контакта.' });
  }
});

chatRouter.delete('/contacts/:targetUserId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { targetUserId } = req.params;

    db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(userId, targetUserId);

    const rows = db.prepare('SELECT contact_id FROM contacts WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(userId) as { contact_id: string }[];
    const contacts = rows.map((r) => getUserProfileById(r.contact_id, userId)).filter(Boolean);

    res.json({ message: 'удалено из контактов.', contacts });
  } catch {
    res.status(500).json({ error: 'ошибка удаления из контактов.' });
  }
});

chatRouter.post('/rooms/direct', (req: AuthenticatedRequest, res: Response) => {
  try {
    const myId = req.user!.userId;
    const { targetUserId } = req.body;

    if (!targetUserId) {
      res.status(400).json({ error: 'укажите собеседника.' });
      return;
    }

    if (targetUserId === myId) {
      const savedRoomId = ensureSavedMessagesRoom(myId);
      getIO()?.in(`user:${myId}`).socketsJoin(`room:${savedRoomId}`);
      res.json({ roomId: savedRoomId, created: false });
      return;
    }

    const roomId = ensureDirectRoom(myId, targetUserId);
    const io = getIO();
    if (io) {
      io.in(`user:${myId}`).socketsJoin(`room:${roomId}`);
      io.in(`user:${targetUserId}`).socketsJoin(`room:${roomId}`);
      io.to(`user:${targetUserId}`).emit('room:created', { roomId });
      io.to(`user:${myId}`).emit('room:created', { roomId });
    }

    res.status(200).json({ roomId, created: true });
  } catch {
    res.status(500).json({ error: 'не удалось создать диалог.' });
  }
});

chatRouter.post('/rooms/group', uploadAvatar.single('avatar'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const myId = req.user!.userId;
    const { name, description, slug, memberIds, avatarUrl: bodyAvatarUrl } = req.body;

    if (!name || String(name).trim().length < 1) {
      res.status(400).json({ error: 'введите название группы.' });
      return;
    }

    let parsedMembers: string[] = [];
    if (typeof memberIds === 'string') {
      try {
        parsedMembers = JSON.parse(memberIds);
      } catch {
        parsedMembers = memberIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } else if (Array.isArray(memberIds)) {
      parsedMembers = memberIds;
    }

    const roomId = uuidv4();
    const avatarUrl = req.file
      ? `/uploads/avatars/${req.file.filename}`
      : bodyAvatarUrl && String(bodyAvatarUrl).startsWith('/uploads/')
      ? String(bodyAvatarUrl)
      : null;
    const allMembers = Array.from(new Set([myId, ...parsedMembers]));
    const cleanDesc = description ? String(description).trim() : '';
    const finalSlug = slug && String(slug).replace(/^@/, '').trim()
      ? generateUniqueRoomSlug(String(slug).replace(/^@/, '').trim(), roomId)
      : generateUniqueRoomSlug(String(name).trim(), roomId);

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO rooms (id, name, slug, description, is_group, avatar_url, owner_id, invite_code)
        VALUES (?, ?, ?, ?, 1, ?, ?, NULL)
      `).run(roomId, String(name).trim(), finalSlug, cleanDesc, avatarUrl, myId);

      for (const uid of allMembers) {
        const role = uid === myId ? 'owner' : 'member';
        db.prepare(`
          INSERT OR IGNORE INTO room_members (room_id, user_id, role)
          VALUES (?, ?, ?)
        `).run(roomId, uid, role);
      }
    });

    tx();

    const io = getIO();
    for (const uid of allMembers) {
      io?.in(`user:${uid}`).socketsJoin(`room:${roomId}`);
      io?.to(`user:${uid}`).emit('room:created', { roomId });
    }

    res.status(201).json({
      message: 'группа создана.',
      roomId
    });
  } catch (error) {
    console.error('[create group error]:', error);
    res.status(500).json({ error: 'ошибка при создании группы.' });
  }
});

// Обновление профиля группы или канала
chatRouter.put('/rooms/:roomId/profile', uploadAvatar.single('avatar'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { roomId } = req.params;

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as any;
    if (!room || room.is_group !== 1) {
      res.status(404).json({ error: 'группа не найдена.' });
      return;
    }

    if (roomId === 'global-lobby-room' && !isAdmin) {
      res.status(403).json({ error: 'редактировать канал jward может только администратор.' });
      return;
    }

    const memberRow = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId) as { role: string } | undefined;
    if (!memberRow && !isAdmin) {
      res.status(403).json({ error: 'нет доступа к группе.' });
      return;
    }

    const nextName =
      roomId === 'global-lobby-room'
        ? 'jward'
        : req.body.name !== undefined && String(req.body.name).trim().length > 0
        ? String(req.body.name).trim()
        : room.name;

    const nextDescription =
      req.body.description !== undefined ? String(req.body.description).trim() : room.description || '';

    let nextSlug = roomId === 'global-lobby-room' ? 'j' : room.slug;
    if (roomId !== 'global-lobby-room' && req.body.slug !== undefined) {
      const candidateSlug = String(req.body.slug).replace(/^@/, '').trim().toLowerCase();
      if (candidateSlug && candidateSlug !== 'j' && /^[a-z0-9_]{1,40}$/.test(candidateSlug)) {
        const dupRoom = db.prepare('SELECT id FROM rooms WHERE LOWER(slug) = LOWER(?) AND id != ?').get(candidateSlug, roomId);
        const dupUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(candidateSlug);
        if (dupRoom || dupUser) {
          res.status(409).json({ error: 'этот @адрес группы уже занят.' });
          return;
        }
        nextSlug = candidateSlug;
      }
    }

    let nextAvatar = room.avatar_url;
    if (req.file) {
      nextAvatar = `/uploads/avatars/${req.file.filename}`;
    } else if (req.body.avatarUrl && String(req.body.avatarUrl).startsWith('/uploads/')) {
      nextAvatar = String(req.body.avatarUrl);
    }

    db.prepare(`
      UPDATE rooms
      SET name = ?, description = ?, slug = ?, avatar_url = ?
      WHERE id = ?
    `).run(nextName, nextDescription, nextSlug, nextAvatar, roomId);

    getIO()?.emit('room:updated', { roomId });
    res.json({ message: 'профиль группы обновлен.' });
  } catch (err) {
    console.error('[update group profile error]:', err);
    res.status(500).json({ error: 'не удалось обновить группу.' });
  }
});

// Изменение темы и общих обоев в конкретном чате
chatRouter.put('/rooms/:roomId/theme', uploadWallpaper.single('wallpaper'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const isAdmin = req.user!.isAdmin;
    const { roomId } = req.params;

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as any;
    if (!room) {
      res.status(404).json({ error: 'чат не найден.' });
      return;
    }

    if (roomId === 'global-lobby-room' && !isAdmin) {
      res.status(403).json({ error: 'менять тему в jward может только администратор.' });
      return;
    }

    let nextWallpaper = room.wallpaper_url;
    if (req.file) {
      nextWallpaper = `/uploads/wallpapers/${req.file.filename}`;
    } else if (req.body.removeWallpaper === 'true' || req.body.removeWallpaper === true) {
      nextWallpaper = null;
    } else if (req.body.wallpaperUrl !== undefined) {
      nextWallpaper = req.body.wallpaperUrl || null;
    }

    let nextThemeConfig = room.theme_config;
    if (req.body.themeConfig !== undefined) {
      if (!req.body.themeConfig || req.body.themeConfig === 'null') {
        nextThemeConfig = null;
      } else if (typeof req.body.themeConfig === 'string') {
        nextThemeConfig = req.body.themeConfig;
      } else {
        nextThemeConfig = JSON.stringify(req.body.themeConfig);
      }
    }

    db.prepare(`
      UPDATE rooms
      SET wallpaper_url = ?, theme_config = ?
      WHERE id = ?
    `).run(nextWallpaper, nextThemeConfig, roomId);

    getIO()?.emit('room:updated', { roomId });
    res.json({
      message: 'оформление чата обновлено.',
      wallpaper_url: nextWallpaper,
      theme_config: nextThemeConfig
    });
  } catch (err) {
    console.error('[room theme error]:', err);
    res.status(500).json({ error: 'не удалось обновить оформление чата.' });
  }
});

// Закрепление / открепление чата в списке
chatRouter.put('/rooms/:roomId/pin', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { roomId } = req.params;

    if (roomId === 'global-lobby-room') {
      res.status(400).json({ error: 'главный канал jward закреплен навсегда и его нельзя открепить.' });
      return;
    }

    const row = db.prepare('SELECT is_pinned FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId) as { is_pinned: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'чат не найден.' });
      return;
    }

    const nextPin = row.is_pinned === 1 ? 0 : 1;
    db.prepare('UPDATE room_members SET is_pinned = ? WHERE room_id = ? AND user_id = ?').run(nextPin, roomId, userId);

    res.json({ is_pinned: Boolean(nextPin) });
  } catch {
    res.status(500).json({ error: 'не удалось изменить закрепление чата.' });
  }
});

// Удаление переписки
chatRouter.delete('/rooms/:roomId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { roomId } = req.params;

    if (roomId === 'global-lobby-room') {
      res.status(400).json({ error: 'главный канал jward удалить нельзя.' });
      return;
    }

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as any;
    if (!room) {
      res.status(404).json({ error: 'переписка не найдена.' });
      return;
    }

    if (room.is_saved === 1) {
      db.prepare('DELETE FROM messages WHERE room_id = ?').run(roomId);
      getIO()?.to(`user:${userId}`).emit('room:updated', { roomId });
      res.json({ message: 'избранное очищено.' });
      return;
    }

    const memberRows = db.prepare('SELECT user_id FROM room_members WHERE room_id = ?').all(roomId) as { user_id: string }[];
    const isMember = memberRows.some((m) => m.user_id === userId);
    if (!isMember && !isAdmin) {
      res.status(403).json({ error: 'нет доступа к этой переписке.' });
      return;
    }

    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);

    const io = getIO();
    for (const m of memberRows) {
      io?.to(`user:${m.user_id}`).emit('room:deleted', { roomId });
    }

    res.json({ message: 'переписка удалена.' });
  } catch {
    res.status(500).json({ error: 'не удалось удалить переписку.' });
  }
});

chatRouter.post('/rooms/:roomId/members', (req: AuthenticatedRequest, res: Response) => {
  try {
    const myId = req.user!.userId;
    const { roomId } = req.params;
    const { userIds } = req.body;

    const room = db.prepare('SELECT id, is_group FROM rooms WHERE id = ?').get(roomId) as { id: string; is_group: number } | undefined;
    if (!room || room.is_group !== 1) {
      res.status(404).json({ error: 'группа не найдена.' });
      return;
    }

    const myMembership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, myId);
    if (!myMembership) {
      res.status(403).json({ error: 'вы не состоите в этой группе.' });
      return;
    }

    const ids: string[] = Array.isArray(userIds) ? userIds : [];
    const io = getIO();

    for (const uid of ids) {
      const wasMember = Boolean(
        db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, uid)
      );
      db.prepare(`
        INSERT OR IGNORE INTO room_members (room_id, user_id, role)
        VALUES (?, ?, 'member')
      `).run(roomId, uid);
      if (!wasMember) {
        emitGroupJoinSystemMessage(roomId, uid);
      }
      io?.in(`user:${uid}`).socketsJoin(`room:${roomId}`);
      io?.to(`user:${uid}`).emit('room:created', { roomId });
    }

    io?.to(`room:${roomId}`).emit('room:member_joined', { roomId });
    res.json({ message: 'участники добавлены.' });
  } catch {
    res.status(500).json({ error: 'не удалось добавить участников.' });
  }
});

chatRouter.get('/rooms/:roomId/messages', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { roomId } = req.params;
    const limit = Math.min(parseInt(String(req.query.limit || '300'), 10), 1000);

    if (roomId === 'global-lobby-room') {
      db.prepare(`
        INSERT OR IGNORE INTO room_members (room_id, user_id, role, is_pinned)
        VALUES ('global-lobby-room', ?, 'member', 1)
      `).run(userId);
    }

    const membership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!membership && !isAdmin) {
      res.status(403).json({ error: 'вы не состоите в этом чате.' });
      return;
    }

    const hasNewReads = markRoomMessagesRead(roomId, userId);
    // Сразу уведомляем все вкладки пользователя, что непрочитанных в этой комнате 0!
    getIO()?.to(`user:${userId}`).emit('room:unread_cleared', { roomId });

    if (hasNewReads) {
      const readerProfile = getUserProfileById(userId);
      if (readerProfile) {
        const readPayload = {
          roomId,
          userId,
          readAt: new Date().toISOString(),
          reader: {
            user_id: readerProfile.id,
            username: readerProfile.username,
            display_name: readerProfile.display_name,
            avatar_url: readerProfile.avatar_url
          }
        };
        if (roomId === 'global-lobby-room' || (readerProfile.is_admin === 1 && readerProfile.hide_read_time)) {
          const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all() as { id: string }[];
          for (const a of admins) {
            getIO()?.to(`user:${a.id}`).emit('room:messages_read', readPayload);
          }
        } else {
          getIO()?.to(`room:${roomId}`).emit('room:messages_read', readPayload);
        }
      }
    }

    const whereClause = isAdmin ? 'WHERE room_id = ?' : 'WHERE room_id = ? AND is_deleted = 0';

    const rows = db.prepare(`
      SELECT id FROM (
        SELECT id, created_at, rowid
        FROM messages
        ${whereClause}
        ORDER BY datetime(created_at) DESC, rowid DESC
        LIMIT ?
      )
      ORDER BY datetime(created_at) ASC, rowid ASC
    `).all(roomId, limit) as { id: string }[];

    const messages = rows
      .map((r) => getMessageByIdDTO(r.id, { viewerIsAdmin: isAdmin, viewerUserId: userId }))
      .filter(Boolean);

    res.json({ messages });
  } catch (error) {
    console.error('[get messages error]:', error);
    res.status(500).json({ error: 'ошибка получения сообщений.' });
  }
});

chatRouter.post('/rooms/:roomId/attachments', uploadAttachment.single('file'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { roomId } = req.params;
    const { content, replyToId, chunkedFileUrl, chunkedFileName, chunkedFileSize, chunkedMimeType } = req.body;

    if (roomId === 'global-lobby-room' && !isAdmin) {
      res.status(403).json({ error: 'в канал jward может писать только администратор.' });
      return;
    }

    const membership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!membership) {
      res.status(403).json({ error: 'вы не являетесь участником этого чата.' });
      return;
    }

    let fileUrl = '';
    let originalName = '';
    let fileSize = 0;
    let detectedType: 'image' | 'video' | 'audio' | 'file' = 'file';

    if (req.file) {
      fileUrl = `/uploads/attachments/${req.file.filename}`;
      originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      fileSize = req.file.size;
      detectedType = detectAttachmentType(originalName || req.file.filename, req.file.mimetype);
    } else if (chunkedFileUrl && String(chunkedFileUrl).startsWith('/uploads/')) {
      fileUrl = String(chunkedFileUrl);
      originalName = String(chunkedFileName || path.basename(fileUrl));
      fileSize = Number(chunkedFileSize || 0);
      detectedType = detectAttachmentType(originalName || fileUrl, String(chunkedMimeType || ''));
    } else {
      res.status(400).json({ error: 'файл не прикреплен.' });
      return;
    }

    const msgId = uuidv4();
    const nextNum = getNextMsgNumber(roomId);

    db.prepare(`
      INSERT INTO messages (id, room_id, msg_number, sender_id, content, type, file_url, file_name, file_size, reply_to_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgId,
      roomId,
      nextNum,
      userId,
      content ? String(content).trim() : '',
      detectedType,
      fileUrl,
      originalName,
      fileSize,
      replyToId || null
    );

    broadcastMessageUpdateToRoom(roomId, msgId, 'message:new');
    const fullMsg = getMessageByIdDTO(msgId, { viewerIsAdmin: isAdmin, viewerUserId: userId });

    res.status(201).json({ message: fullMsg });
  } catch (error) {
    console.error('[attachment upload error]:', error);
    res.status(500).json({ error: 'не удалось загрузить файл.' });
  }
});

chatRouter.post('/rooms/:roomId/voice', uploadVoice.single('audio'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { roomId } = req.params;
    const { waveform, duration, replyToId, chunkedFileUrl, chunkedFileSize } = req.body;

    if (roomId === 'global-lobby-room' && !isAdmin) {
      res.status(403).json({ error: 'в канал jward может писать только администратор.' });
      return;
    }

    const membership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!membership) {
      res.status(403).json({ error: 'нет доступа к комнате.' });
      return;
    }

    let fileUrl = '';
    let fileSize = 0;

    if (req.file) {
      fileUrl = `/uploads/voice/${req.file.filename}`;
      fileSize = req.file.size;
    } else if (chunkedFileUrl && String(chunkedFileUrl).startsWith('/uploads/')) {
      fileUrl = String(chunkedFileUrl);
      fileSize = Number(chunkedFileSize || 0);
    } else {
      res.status(400).json({ error: 'аудиофайл отсутствует.' });
      return;
    }

    const msgId = uuidv4();
    const nextNum = getNextMsgNumber(roomId);
    let parsedWaveform: number[] = [];
    try {
      parsedWaveform = waveform ? JSON.parse(waveform) : [0.2, 0.5, 0.8, 0.4, 0.9, 0.3];
    } catch {
      parsedWaveform = [0.2, 0.5, 0.8, 0.4, 0.9, 0.3];
    }

    db.prepare(`
      INSERT INTO messages (id, room_id, msg_number, sender_id, content, type, file_url, file_name, file_size, voice_waveform, voice_duration, reply_to_id)
      VALUES (?, ?, ?, ?, 'голосовое сообщение', 'voice', ?, 'voice.webm', ?, ?, ?, ?)
    `).run(
      msgId,
      roomId,
      nextNum,
      userId,
      fileUrl,
      fileSize,
      JSON.stringify(parsedWaveform),
      parseFloat(duration || '1.0'),
      replyToId || null
    );

    broadcastMessageUpdateToRoom(roomId, msgId, 'message:new');
    const fullMsg = getMessageByIdDTO(msgId, { viewerIsAdmin: isAdmin, viewerUserId: userId });

    res.status(201).json({ message: fullMsg });
  } catch (error) {
    console.error('[voice upload error]:', error);
    res.status(500).json({ error: 'ошибка отправки голосового сообщения.' });
  }
});

// Загрузка круглых видеосообщений (кружочков)
chatRouter.post('/rooms/:roomId/video-note', uploadVideoNote.single('video'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { roomId } = req.params;
    const { duration, replyToId, chunkedFileUrl, chunkedFileSize } = req.body;

    if (roomId === 'global-lobby-room' && !isAdmin) {
      res.status(403).json({ error: 'в канал jward может писать только администратор.' });
      return;
    }

    const membership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!membership) {
      res.status(403).json({ error: 'нет доступа к комнате.' });
      return;
    }

    let fileUrl = '';
    let fileSize = 0;

    if (req.file) {
      fileUrl = `/uploads/video_notes/${req.file.filename}`;
      fileSize = req.file.size;
    } else if (chunkedFileUrl && String(chunkedFileUrl).startsWith('/uploads/')) {
      fileUrl = String(chunkedFileUrl);
      fileSize = Number(chunkedFileSize || 0);
    } else {
      res.status(400).json({ error: 'видеофайл отсутствует.' });
      return;
    }

    const msgId = uuidv4();
    const nextNum = getNextMsgNumber(roomId);

    db.prepare(`
      INSERT INTO messages (id, room_id, msg_number, sender_id, content, type, file_url, file_name, file_size, voice_duration, reply_to_id)
      VALUES (?, ?, ?, ?, 'видеосообщение', 'video_note', ?, 'video_note.webm', ?, ?, ?)
    `).run(
      msgId,
      roomId,
      nextNum,
      userId,
      fileUrl,
      fileSize,
      parseFloat(duration || '1.0'),
      replyToId || null
    );

    broadcastMessageUpdateToRoom(roomId, msgId, 'message:new');
    const fullMsg = getMessageByIdDTO(msgId, { viewerIsAdmin: isAdmin, viewerUserId: userId });

    res.status(201).json({ message: fullMsg });
  } catch (error) {
    console.error('[video note upload error]:', error);
    res.status(500).json({ error: 'ошибка отправки видеосообщения.' });
  }
});


// Явное вступление в группу по roomId
chatRouter.post('/rooms/:roomId/join', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { roomId } = req.params;

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as any;
    if (!room || (room.is_group !== 1 && roomId !== 'global-lobby-room')) {
      res.status(404).json({ error: 'группа не найдена.' });
      return;
    }

    const wasMember = Boolean(
      db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId)
    );
    if (!wasMember) {
      db.prepare(`
        INSERT OR IGNORE INTO room_members (room_id, user_id, role)
        VALUES (?, ?, 'member')
      `).run(roomId, userId);
      emitGroupJoinSystemMessage(roomId, userId);
      getIO()?.to(`room:${roomId}`).emit('room:member_joined', { roomId });
      getIO()?.to(`user:${userId}`).emit('room:created', { roomId });
    }
    getIO()?.in(`user:${userId}`).socketsJoin(`room:${roomId}`);

    res.json({
      joined: !wasMember,
      roomId,
      room: buildRoomDTO(room, userId, isAdmin)
    });
  } catch (err) {
    console.error('[join room error]:', err);
    res.status(500).json({ error: 'не удалось вступить в группу.' });
  }
});

// ==================== СТИКЕРПАКИ (БЕЗ ЗВУКА ДЛЯ ВИДЕО) ====================

chatRouter.get('/stickers/packs', (_req: AuthenticatedRequest, res: Response) => {
  try {
    const packs = db.prepare(`
      SELECT sp.*, u.username as owner_username
      FROM sticker_packs sp
      LEFT JOIN users u ON u.id = sp.owner_id
      ORDER BY datetime(sp.created_at) DESC
    `).all() as any[];

    const result = packs.map((p) => {
      const stickers = db.prepare(`
        SELECT id, pack_id, file_url, is_video, created_at
        FROM stickers
        WHERE pack_id = ?
        ORDER BY datetime(created_at) ASC
      `).all(p.id).map((s: any) => ({ ...s, is_video: Boolean(s.is_video) }));

      return {
        id: p.id,
        name: p.name,
        owner_id: p.owner_id,
        owner_username: p.owner_username || '',
        created_at: p.created_at,
        stickers
      };
    });

    res.json({ packs: result });
  } catch (err) {
    console.error('[get sticker packs error]:', err);
    res.status(500).json({ error: 'не удалось загрузить стикерпаки.' });
  }
});

chatRouter.post('/stickers/packs', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { name } = req.body;
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'введите название набора стикеров.' });
      return;
    }

    const packId = uuidv4();
    db.prepare(`
      INSERT INTO sticker_packs (id, name, owner_id, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(packId, cleanName.slice(0, 48), userId);

    const created = {
      id: packId,
      name: cleanName.slice(0, 48),
      owner_id: userId,
      owner_username: req.user!.username,
      created_at: new Date().toISOString(),
      stickers: []
    };

    getIO()?.emit('stickers:updated');
    res.status(201).json({ pack: created });
  } catch (err) {
    console.error('[create sticker pack error]:', err);
    res.status(500).json({ error: 'не удалось создать набор стикеров.' });
  }
});

chatRouter.delete('/stickers/packs/:packId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { packId } = req.params;

    const pack = db.prepare('SELECT id, owner_id FROM sticker_packs WHERE id = ?').get(packId) as any;
    if (!pack) {
      res.status(404).json({ error: 'набор стикеров не найден.' });
      return;
    }
    if (pack.owner_id !== userId && !isAdmin) {
      res.status(403).json({ error: 'можно удалять только свои наборы стикеров.' });
      return;
    }

    db.prepare('DELETE FROM sticker_packs WHERE id = ?').run(packId);
    getIO()?.emit('stickers:updated');
    res.json({ message: 'набор стикеров удален.' });
  } catch {
    res.status(500).json({ error: 'не удалось удалить набор стикеров.' });
  }
});

chatRouter.post('/stickers/packs/:packId/items', uploadSticker.single('sticker'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { packId } = req.params;
    const { chunkedFileUrl } = req.body;

    const pack = db.prepare('SELECT id, owner_id FROM sticker_packs WHERE id = ?').get(packId) as any;
    if (!pack) {
      res.status(404).json({ error: 'набор стикеров не найден.' });
      return;
    }
    if (pack.owner_id !== userId && !isAdmin) {
      res.status(403).json({ error: 'добавлять стикеры может только создатель набора.' });
      return;
    }

    let fileUrl = '';
    if (req.file) {
      fileUrl = `/uploads/stickers/${req.file.filename}`;
    } else if (chunkedFileUrl && String(chunkedFileUrl).startsWith('/uploads/')) {
      fileUrl = String(chunkedFileUrl);
    } else {
      res.status(400).json({ error: 'файл стикера не выбран.' });
      return;
    }

    const ext = path.extname(fileUrl).toLowerCase();
    const isVideo = ['.mp4', '.webm', '.mov'].includes(ext);

    // Если видеостикер — обязательно удаляем звуковую дорожку (-an) через ffmpeg
    if (isVideo) {
      const rel = fileUrl.replace(/^\/uploads\//, '');
      const srcPath = path.join(CONFIG.UPLOADS_DIR, rel);
      const mutedName = `stk_${uuidv4()}${ext === '.mov' ? '.mp4' : ext}`;
      const outPath = path.join(CONFIG.UPLOADS_DIR, 'stickers', mutedName);
      if (fs.existsSync(srcPath)) {
        try {
          await execFileAsync('ffmpeg', ['-y', '-i', srcPath, '-an', '-c:v', 'copy', outPath]);
          if (srcPath !== outPath) fs.unlink(srcPath, () => {});
          fileUrl = `/uploads/stickers/${mutedName}`;
        } catch {
          try {
            await execFileAsync('ffmpeg', ['-y', '-i', srcPath, '-an', outPath]);
            if (srcPath !== outPath) fs.unlink(srcPath, () => {});
            fileUrl = `/uploads/stickers/${mutedName}`;
          } catch {
            // На фронтенде видеостикеры также всегда воспроизводятся с muted
          }
        }
      }
    }

    const stickerId = uuidv4();
    db.prepare(`
      INSERT INTO stickers (id, pack_id, file_url, is_video, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(stickerId, packId, fileUrl, isVideo ? 1 : 0);

    getIO()?.emit('stickers:updated');
    res.status(201).json({
      sticker: {
        id: stickerId,
        pack_id: packId,
        file_url: fileUrl,
        is_video: isVideo,
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[add sticker error]:', err);
    res.status(500).json({ error: 'не удалось добавить стикер.' });
  }
});

chatRouter.delete('/stickers/:stickerId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.isAdmin;
    const { stickerId } = req.params;

    const row = db.prepare(`
      SELECT s.id, sp.owner_id
      FROM stickers s
      INNER JOIN sticker_packs sp ON sp.id = s.pack_id
      WHERE s.id = ?
    `).get(stickerId) as any;

    if (!row) {
      res.status(404).json({ error: 'стикер не найден.' });
      return;
    }
    if (row.owner_id !== userId && !isAdmin) {
      res.status(403).json({ error: 'можно удалять только свои стикеры.' });
      return;
    }

    db.prepare('DELETE FROM stickers WHERE id = ?').run(stickerId);
    getIO()?.emit('stickers:updated');
    res.json({ message: 'стикер удален.' });
  } catch {
    res.status(500).json({ error: 'не удалось удалить стикер.' });
  }
});
