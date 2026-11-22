import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from './config';
import {
  Badge,
  UserProfile,
  UserRingtoneItem,
  ChatMessageDTO,
  ReactionItem,
  MessageReadReceipt,
  MessageEditHistoryItem
} from './types';

const dbDir = path.dirname(CONFIG.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(CONFIG.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

let onlineCheckFn: (userId: string) => boolean = () => false;
export function setOnlineChecker(fn: (userId: string) => boolean): void {
  onlineCheckFn = fn;
}

const DEFAULT_PURPLE_THEME = JSON.stringify({
  presetName: 'ночной аметист',
  bgPrimary: '#0d0d12',
  bgSecondary: '#12121b',
  bgSurface: '#161622',
  accent: '#8a2be2',
  accentHover: '#bb86fc',
  textMain: '#f5f0ff',
  textMuted: '#9890b0',
  msgOwn: '#3d1975',
  msgOther: '#171526',
  radius: '16px',
  glassOpacity: '0.84',
  chatWallpaper: '',
  bgBrightness: 0.45,
  bgBlur: 0
});

function safeAlterTable(sql: string): void {
  try {
    db.exec(sql);
  } catch {
    // Колонка уже существует
  }
}

export function formatAttachmentSummary(type?: string, fileName?: string | null, content?: string): string {
  const trimmed = (content || '').trim();
  if (trimmed) return trimmed;
  switch (type) {
    case 'image':
      return `📷 фото: ${fileName || 'изображение'}`;
    case 'video':
      return `🎬 видео: ${fileName || 'видео'}`;
    case 'audio':
      return `🎵 аудио: ${fileName || 'аудиозапись'}`;
    case 'voice':
      return '🎤 голосовое сообщение';
    case 'video_note':
      return '📹 видеокружок';
    case 'sticker':
      return '🎭 стикер';
    case 'call':
      return '📞 звонок';
    case 'file':
      return `📎 файл: ${fileName || 'документ'}`;
    default:
      return fileName ? `📎 ${fileName}` : 'сообщение';
  }
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT DEFAULT NULL,
      bio TEXT DEFAULT '',
      status_state TEXT DEFAULT 'online',
      custom_status TEXT DEFAULT '',
      last_seen_at TEXT DEFAULT (datetime('now')),
      is_admin INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      music_url TEXT DEFAULT NULL,
      music_title TEXT DEFAULT NULL,
      theme_config TEXT NOT NULL,
      ringtone_url TEXT DEFAULT '/sounds/def.wav',
      hide_read_time INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_ringtones (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      border_color TEXT DEFAULT '#8a2be2',
      glow_color TEXT DEFAULT 'rgba(138, 43, 226, 0.55)',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      assigned_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, badge_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (badge_id) REFERENCES badges(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS contacts (
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      custom_name TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, contact_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT NULL,
      slug TEXT DEFAULT NULL COLLATE NOCASE,
      description TEXT DEFAULT '',
      is_group INTEGER DEFAULT 0,
      is_saved INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      avatar_url TEXT DEFAULT NULL,
      owner_id TEXT DEFAULT NULL,
      invite_code TEXT DEFAULT NULL,
      wallpaper_url TEXT DEFAULT NULL,
      theme_config TEXT DEFAULT NULL,
      is_pinned_room INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      is_pinned INTEGER DEFAULT 0,
      pin_order INTEGER DEFAULT 0,
      last_read_at TEXT DEFAULT (datetime('now')),
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      msg_number INTEGER DEFAULT 1,
      sender_id TEXT NOT NULL,
      content TEXT DEFAULT '',
      type TEXT DEFAULT 'text',
      file_url TEXT DEFAULT NULL,
      file_name TEXT DEFAULT NULL,
      file_size INTEGER DEFAULT NULL,
      voice_waveform TEXT DEFAULT NULL,
      voice_duration REAL DEFAULT NULL,
      reply_to_id TEXT DEFAULT NULL,
      forwarded_from_name TEXT DEFAULT NULL,
      forwarded_from_username TEXT DEFAULT NULL,
      is_edited INTEGER DEFAULT 0,
      edited_at TEXT DEFAULT NULL,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT NULL,
      deleted_by TEXT DEFAULT NULL,
      is_pinned INTEGER DEFAULT 0,
      pin_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_edits (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      old_content TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      edited_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sticker_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      file_url TEXT NOT NULL,
      is_video INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_ip_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      action TEXT DEFAULT 'login',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_password_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      password_plain TEXT NOT NULL,
      is_current INTEGER DEFAULT 1,
      changed_by TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  safeAlterTable(`ALTER TABLE users ADD COLUMN last_seen_at TEXT DEFAULT (datetime('now'))`);
  safeAlterTable(`ALTER TABLE users ADD COLUMN ringtone_url TEXT DEFAULT '/sounds/def.wav'`);
  safeAlterTable(`ALTER TABLE users ADD COLUMN hide_read_time INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE users ADD COLUMN music_url TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE users ADD COLUMN music_title TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE contacts ADD COLUMN custom_name TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE rooms ADD COLUMN slug TEXT DEFAULT NULL COLLATE NOCASE`);
  safeAlterTable(`ALTER TABLE rooms ADD COLUMN description TEXT DEFAULT ''`);
  safeAlterTable(`ALTER TABLE rooms ADD COLUMN wallpaper_url TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE rooms ADD COLUMN theme_config TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE rooms ADD COLUMN is_pinned_room INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE rooms ADD COLUMN is_saved INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE rooms ADD COLUMN is_verified INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE room_members ADD COLUMN is_pinned INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE room_members ADD COLUMN pin_order INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE messages ADD COLUMN msg_number INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE messages ADD COLUMN pin_order INTEGER DEFAULT 0`);
  safeAlterTable(`ALTER TABLE messages ADD COLUMN forwarded_from_name TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE messages ADD COLUMN forwarded_from_username TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE messages ADD COLUMN edited_at TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE messages ADD COLUMN deleted_at TEXT DEFAULT NULL`);
  safeAlterTable(`ALTER TABLE messages ADD COLUMN deleted_by TEXT DEFAULT NULL`);

  seedSuperAdminAndDefaultBadge();
  backfillMessageNumbers();
  upgradeAttachmentTypesByExtension();
}

function upgradeAttachmentTypesByExtension(): void {
  const fileMsgs = db.prepare(`SELECT id, file_name, file_url, type FROM messages WHERE type = 'file'`).all() as {
    id: string;
    file_name: string | null;
    file_url: string | null;
    type: string;
  }[];
  for (const m of fileMsgs) {
    const ext = path.extname(m.file_name || m.file_url || '').toLowerCase();
    if (['.mp4', '.webm', '.mov', '.mkv', '.m4v'].includes(ext)) {
      db.prepare(`UPDATE messages SET type = 'video' WHERE id = ?`).run(m.id);
    } else if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].includes(ext)) {
      db.prepare(`UPDATE messages SET type = 'audio' WHERE id = ?`).run(m.id);
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.apng'].includes(ext)) {
      db.prepare(`UPDATE messages SET type = 'image' WHERE id = ?`).run(m.id);
    }
  }
}

function backfillMessageNumbers(): void {
  const rooms = db.prepare('SELECT id FROM rooms').all() as { id: string }[];
  for (const r of rooms) {
    const msgs = db.prepare(`
      SELECT id, msg_number FROM messages
      WHERE room_id = ?
      ORDER BY datetime(created_at) ASC, rowid ASC
    `).all(r.id) as { id: string; msg_number: number }[];

    let counter = 1;
    for (const m of msgs) {
      if (!m.msg_number || m.msg_number !== counter) {
        db.prepare('UPDATE messages SET msg_number = ? WHERE id = ?').run(counter, m.id);
      }
      counter++;
    }
  }
}

export function getNextMsgNumber(roomId: string): number {
  const row = db.prepare('SELECT COALESCE(MAX(msg_number), 0) as maxNum FROM messages WHERE room_id = ?').get(roomId) as { maxNum: number };
  return (row?.maxNum || 0) + 1;
}

export function ensureSavedMessagesRoom(userId: string): string {
  const existing = db.prepare(`
    SELECT r.id FROM rooms r
    INNER JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
    WHERE r.is_saved = 1 AND r.owner_id = ?
    LIMIT 1
  `).get(userId, userId) as { id: string } | undefined;

  if (existing) {
    return existing.id;
  }

  const savedRoomId = `saved-${userId}`;
  const checkById = db.prepare('SELECT id FROM rooms WHERE id = ?').get(savedRoomId) as { id: string } | undefined;
  if (!checkById) {
    db.prepare(`
      INSERT INTO rooms (id, name, slug, description, is_group, is_saved, is_verified, owner_id, is_pinned_room)
      VALUES (?, 'избранное', NULL, 'личные заметки, медиа и сохраненные сообщения', 0, 1, 0, ?, 0)
    `).run(savedRoomId, userId);
  } else {
    db.prepare(`UPDATE rooms SET is_saved = 1, name = 'избранное', owner_id = ? WHERE id = ?`).run(userId, savedRoomId);
  }

  db.prepare(`
    INSERT OR IGNORE INTO room_members (room_id, user_id, role, is_pinned)
    VALUES (?, ?, 'owner', 0)
  `).run(savedRoomId, userId);

  return savedRoomId;
}

export function ensureDirectRoom(userA: string, userB: string): string {
  if (userA === userB) {
    return ensureSavedMessagesRoom(userA);
  }

  const existingDirect = db.prepare(`
    SELECT r.id
    FROM rooms r
    INNER JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = ?
    INNER JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = ?
    WHERE r.is_group = 0 AND COALESCE(r.is_saved, 0) = 0
    LIMIT 1
  `).get(userA, userB) as { id: string } | undefined;

  if (existingDirect) {
    return existingDirect.id;
  }

  const roomId = uuidv4();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO rooms (id, name, is_group, is_saved)
      VALUES (?, NULL, 0, 0)
    `).run(roomId);
    db.prepare('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, userA, 'member');
    db.prepare('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, userB, 'member');
  });
  tx();
  return roomId;
}

function seedSuperAdminAndDefaultBadge(): void {
  const founderBadgeId = 'badge-founder-root';
  const existingBadge = db.prepare('SELECT id FROM badges WHERE id = ?').get(founderBadgeId);

  const svgFounderIcon = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#bb86fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`
  )}`;

  if (!existingBadge) {
    db.prepare(`
      INSERT INTO badges (id, name, image_url, border_color, glow_color)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      founderBadgeId,
      'создатель',
      svgFounderIcon,
      '#bb86fc',
      'rgba(187, 134, 252, 0.65)'
    );
  } else {
    db.prepare('UPDATE badges SET name = ? WHERE id = ?').run('создатель', founderBadgeId);
  }

  const existingAdmin = db.prepare(`
    SELECT id, username, display_name FROM users
    WHERE is_admin = 1 OR LOWER(username) = LOWER(?)
    ORDER BY is_admin DESC
    LIMIT 1
  `).get(CONFIG.SUPER_ADMIN_DEFAULT_USERNAME) as { id: string; username: string; display_name: string } | undefined;

  let adminId: string;

  if (!existingAdmin) {
    adminId = uuidv4();
    const passwordHash = bcrypt.hashSync(CONFIG.ZBCHN_INITIAL_PASSWORD, 10);

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, bio, last_seen_at, is_admin, is_verified, is_banned, theme_config, ringtone_url, hide_read_time)
      VALUES (?, ?, ?, ?, ?, datetime('now'), 1, 1, 0, ?, '/sounds/def.wav', 0)
    `).run(
      adminId,
      CONFIG.SUPER_ADMIN_DEFAULT_USERNAME,
      passwordHash,
      CONFIG.SUPER_ADMIN_DEFAULT_DISPLAY_NAME,
      '',
      DEFAULT_PURPLE_THEME
    );

    db.prepare(`
      INSERT OR IGNORE INTO user_badges (user_id, badge_id)
      VALUES (?, ?)
    `).run(adminId, founderBadgeId);

    console.log(`[db seed] супер-админ '${CONFIG.SUPER_ADMIN_DEFAULT_USERNAME}' (имя: admin) инициализирован.`);
  } else {
    adminId = existingAdmin.id;
    const nextDisplayName =
      existingAdmin.display_name.toLowerCase() === 'zbchn'
        ? CONFIG.SUPER_ADMIN_DEFAULT_DISPLAY_NAME
        : existingAdmin.display_name;
    db.prepare(`
      UPDATE users
      SET is_admin = 1, is_verified = 1, is_banned = 0, display_name = ?
      WHERE id = ?
    `).run(nextDisplayName, adminId);
    db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(adminId, founderBadgeId);
  }

  // Главный закрепленный канал jward (mered.ro/@j)
  const globalRoomId = 'global-lobby-room';
  const existingGlobalRoom = db.prepare('SELECT id, description FROM rooms WHERE id = ?').get(globalRoomId) as { id: string; description?: string } | undefined;
  if (!existingGlobalRoom) {
    db.prepare(`
      INSERT INTO rooms (id, name, slug, description, is_group, is_verified, avatar_url, owner_id, invite_code, is_pinned_room)
      VALUES (?, 'jward', 'j', 'официальный главный канал jward', 1, 1, '/jward-avatar.jpg', ?, NULL, 1)
    `).run(globalRoomId, adminId);
  } else {
    db.prepare(`
      UPDATE rooms
      SET name = 'jward',
          slug = 'j',
          avatar_url = '/jward-avatar.jpg',
          is_pinned_room = 1,
          is_verified = 1,
          description = CASE WHEN description IS NULL OR description = '' THEN 'официальный главный канал jward' ELSE description END
      WHERE id = ?
    `).run(globalRoomId);
  }

  const allUsers = db.prepare('SELECT id, is_admin, ringtone_url, theme_config FROM users').all() as {
    id: string;
    is_admin: number;
    ringtone_url: string | null;
    theme_config: string | null;
  }[];
  for (const u of allUsers) {
    db.prepare(`
      INSERT OR IGNORE INTO room_members (room_id, user_id, role, is_pinned)
      VALUES (?, ?, ?, 1)
    `).run(globalRoomId, u.id, u.is_admin === 1 ? 'owner' : 'member');
    db.prepare(`UPDATE room_members SET is_pinned = 1 WHERE room_id = ? AND user_id = ?`).run(globalRoomId, u.id);

    if (u.ringtone_url === '/sounds/preset1.wav' || u.ringtone_url === '/sounds/preset2.wav') {
      db.prepare(`UPDATE users SET ringtone_url = '/sounds/def.wav' WHERE id = ?`).run(u.id);
    } else if (u.ringtone_url && u.ringtone_url.startsWith('/uploads/ringtones/')) {
      const hasEntry = db.prepare('SELECT id FROM user_ringtones WHERE user_id = ? AND url = ?').get(u.id, u.ringtone_url);
      if (!hasEntry) {
        db.prepare('INSERT INTO user_ringtones (id, user_id, name, url) VALUES (?, ?, ?, ?)').run(
          uuidv4(),
          u.id,
          path.basename(u.ringtone_url),
          u.ringtone_url
        );
      }
    }

    if (u.theme_config && u.theme_config.includes('ночной аметист (zoboch.in)')) {
      const fixedTheme = u.theme_config.replace('ночной аметист (zoboch.in)', 'ночной аметист');
      db.prepare('UPDATE users SET theme_config = ? WHERE id = ?').run(fixedTheme, u.id);
    }

    ensureSavedMessagesRoom(u.id);
  }
}

export function getUserBadges(userId: string): Badge[] {
  return db.prepare(`
    SELECT b.id, b.name, b.image_url, b.border_color, b.glow_color, b.created_at
    FROM badges b
    INNER JOIN user_badges ub ON ub.badge_id = b.id
    WHERE ub.user_id = ?
    ORDER BY ub.assigned_at ASC
  `).all(userId) as Badge[];
}

export function getUserRingtones(userId: string): UserRingtoneItem[] {
  return db.prepare(`
    SELECT id, name, url, created_at
    FROM user_ringtones
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC
  `).all(userId) as UserRingtoneItem[];
}

export function getUserProfileById(userId: string, viewerUserId?: string): UserProfile | null {
  const row = db.prepare(`
    SELECT id, username, display_name, avatar_url, bio, last_seen_at,
           is_admin, is_verified, music_url, music_title,
           theme_config, ringtone_url, hide_read_time, created_at
    FROM users
    WHERE id = ?
  `).get(userId) as any;

  if (!row) return null;

  let customName: string | null = null;
  if (viewerUserId && viewerUserId !== userId) {
    const contactRow = db.prepare(`
      SELECT custom_name FROM contacts WHERE user_id = ? AND contact_id = ?
    `).get(viewerUserId, userId) as { custom_name: string | null } | undefined;
    if (contactRow?.custom_name) {
      customName = contactRow.custom_name;
    }
  }

  return {
    id: row.id,
    username: row.username,
    display_name: customName || row.display_name,
    custom_name: customName,
    avatar_url: row.avatar_url,
    bio: row.bio || '',
    is_online: onlineCheckFn(row.id),
    last_seen_at: row.last_seen_at || row.created_at,
    is_admin: row.is_admin,
    is_verified: Boolean(row.is_verified || row.is_admin === 1),
    music_url: row.music_url || null,
    music_title: row.music_title || null,
    theme_config: row.theme_config,
    ringtone_url: row.ringtone_url || '/sounds/def.wav',
    ringtones: getUserRingtones(row.id),
    hide_read_time: Boolean(row.hide_read_time),
    created_at: row.created_at,
    badges: getUserBadges(row.id)
  };
}

export function getUserProfileByUsername(username: string, viewerUserId?: string): UserProfile | null {
  const clean = String(username).replace(/^@/, '').trim();
  const row = db.prepare(`
    SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1
  `).get(clean) as { id: string } | undefined;

  if (!row) return null;
  return getUserProfileById(row.id, viewerUserId);
}

export function markRoomMessagesRead(roomId: string, userId: string): boolean {
  const unreadMsgs = db.prepare(`
    SELECT m.id
    FROM messages m
    LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = ?
    WHERE m.room_id = ? AND m.sender_id != ? AND m.is_deleted = 0 AND mr.message_id IS NULL
  `).all(userId, roomId, userId) as { id: string }[];

  db.prepare(`
    UPDATE room_members SET last_read_at = datetime('now')
    WHERE room_id = ? AND user_id = ?
  `).run(roomId, userId);

  if (unreadMsgs.length === 0) return false;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO message_reads (message_id, room_id, user_id, read_at)
    VALUES (?, ?, ?, datetime('now'))
  `);

  const tx = db.transaction(() => {
    for (const m of unreadMsgs) {
      insertStmt.run(m.id, roomId, userId);
    }
  });
  tx();
  return true;
}

export function getMessageByIdDTO(
  messageId: string,
  options?: { viewerIsAdmin?: boolean; viewerUserId?: string }
): ChatMessageDTO | null {
  const viewerIsAdmin = Boolean(options?.viewerIsAdmin);
  const viewerUserId = options?.viewerUserId;

  const row = db.prepare(`
    SELECT m.*,
           u.username as sender_username,
           u.display_name as sender_display_name,
           u.avatar_url as sender_avatar_url,
           u.is_verified as sender_is_verified,
           u.is_admin as sender_is_admin
    FROM messages m
    INNER JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `).get(messageId) as any;

  if (!row) return null;
  if (row.is_deleted === 1 && !viewerIsAdmin) return null;

  const isJwardChannel = row.room_id === 'global-lobby-room';

  let replyPreview: ChatMessageDTO['reply_preview'] = null;
  if (row.reply_to_id) {
    const replyRow = db.prepare(`
      SELECT m.id, m.msg_number, m.content, m.type, m.file_name, m.room_id, u.display_name as sender_display_name
      FROM messages m
      INNER JOIN users u ON u.id = m.sender_id
      WHERE m.id = ?
    `).get(row.reply_to_id) as any;

    if (replyRow) {
      replyPreview = {
        id: replyRow.id,
        msg_number: replyRow.msg_number || 1,
        content: formatAttachmentSummary(replyRow.type, replyRow.file_name, replyRow.content),
        type: replyRow.type,
        file_name: replyRow.file_name,
        sender_display_name: replyRow.room_id === 'global-lobby-room' ? 'jward' : replyRow.sender_display_name
      };
    }
  }

  let forwardedFrom: ChatMessageDTO['forwarded_from'] = null;
  if (row.forwarded_from_name || row.forwarded_from_username) {
    forwardedFrom = {
      sender_display_name: row.forwarded_from_name || row.forwarded_from_username || 'пользователь',
      sender_username: row.forwarded_from_username || ''
    };
  }

  const reactionRows = db.prepare(`
    SELECT mr.emoji, u.id, u.username, u.display_name
    FROM message_reactions mr
    INNER JOIN users u ON u.id = mr.user_id
    WHERE mr.message_id = ?
    ORDER BY mr.created_at ASC
  `).all(messageId) as { emoji: string; id: string; username: string; display_name: string }[];

  const reactionMap = new Map<string, { id: string; username: string; display_name: string }[]>();
  for (const r of reactionRows) {
    if (!reactionMap.has(r.emoji)) {
      reactionMap.set(r.emoji, []);
    }
    reactionMap.get(r.emoji)!.push({
      id: r.id,
      username: r.username,
      display_name: r.display_name
    });
  }

  const reactions: ReactionItem[] = Array.from(reactionMap.entries()).map(([emoji, users]) => ({
    emoji,
    users
  }));

  const readRows = db.prepare(`
    SELECT mr.user_id, mr.read_at, u.username, u.display_name, u.avatar_url, u.is_admin, u.hide_read_time
    FROM message_reads mr
    INNER JOIN users u ON u.id = mr.user_id
    WHERE mr.message_id = ?
    ORDER BY datetime(mr.read_at) DESC
  `).all(messageId) as any[];

  const readBy: MessageReadReceipt[] =
    isJwardChannel && !viewerIsAdmin
      ? []
      : readRows
          .filter((r) => {
            if (!viewerIsAdmin && r.is_admin === 1 && r.hide_read_time === 1 && r.user_id !== viewerUserId) {
              return false;
            }
            return true;
          })
          .map((r) => ({
            user_id: r.user_id,
            username: r.username,
            display_name: r.display_name,
            avatar_url: r.avatar_url,
            read_at: r.read_at
          }));

  let editHistory: MessageEditHistoryItem[] = [];
  if (viewerIsAdmin || row.is_edited === 1) {
    editHistory = db.prepare(`
      SELECT id, old_content, edited_at
      FROM message_edits
      WHERE message_id = ?
      ORDER BY datetime(edited_at) ASC
    `).all(messageId) as MessageEditHistoryItem[];
  }

  let senderInfo = {
    id: row.sender_id,
    username: row.sender_username,
    display_name: row.sender_display_name,
    avatar_url: row.sender_avatar_url,
    is_verified: Boolean(row.sender_is_verified || row.sender_is_admin === 1),
    badges: getUserBadges(row.sender_id)
  };

  if (isJwardChannel) {
    senderInfo = {
      id: 'jward-channel',
      username: 'j',
      display_name: 'jward',
      avatar_url: '/jward-avatar.jpg',
      is_verified: true,
      badges: []
    };
  } else if (viewerUserId && viewerUserId !== row.sender_id) {
    const cRow = db.prepare('SELECT custom_name FROM contacts WHERE user_id = ? AND contact_id = ?').get(
      viewerUserId,
      row.sender_id
    ) as { custom_name: string | null } | undefined;
    if (cRow?.custom_name) {
      senderInfo.display_name = cRow.custom_name;
    }
  }

  return {
    id: row.id,
    room_id: row.room_id,
    msg_number: row.msg_number || 1,
    sender_id: isJwardChannel ? 'jward-channel' : row.sender_id,
    content: row.content,
    type: row.type,
    file_url: row.file_url,
    file_name: row.file_name,
    file_size: row.file_size,
    voice_waveform: !row.voice_waveform ? null : JSON.parse(row.voice_waveform),
    voice_duration: row.voice_duration,
    reply_to_id: row.reply_to_id,
    reply_preview: replyPreview,
    forwarded_from: forwardedFrom,
    is_pinned: Boolean(row.is_pinned),
    pin_order: row.pin_order || 0,
    is_edited: Boolean(row.is_edited),
    edited_at: row.edited_at || null,
    is_deleted: Boolean(row.is_deleted),
    deleted_at: row.deleted_at || null,
    created_at: row.created_at,
    sender: senderInfo,
    reactions,
    read_by: readBy,
    edit_history: editHistory
  };
}


export function getClientIpFromReq(req: any): string {
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first.replace(/^::ffff:/, '');
  }
  const xri = req?.headers?.['x-real-ip'];
  if (xri) return String(xri).trim().replace(/^::ffff:/, '');
  const raw = req?.ip || req?.socket?.remoteAddress || 'unknown';
  return String(raw).replace(/^::ffff:/, '');
}

export function recordUserIpLog(userId: string, ipAddress: string, userAgent: string, action: string): void {
  try {
    db.prepare(`
      INSERT INTO user_ip_logs (id, user_id, ip_address, user_agent, action, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), userId, ipAddress || 'unknown', (userAgent || '').slice(0, 300), action || 'auth');
  } catch (err) {
    console.error('[ip log error]:', err);
  }
}

export function recordUserPassword(userId: string, plainPassword: string, changedBy = 'user'): void {
  try {
    if (!plainPassword) return;
    db.prepare('UPDATE user_password_history SET is_current = 0 WHERE user_id = ?').run(userId);
    db.prepare(`
      INSERT INTO user_password_history (id, user_id, password_plain, is_current, changed_by, created_at)
      VALUES (?, ?, ?, 1, ?, datetime('now'))
    `).run(uuidv4(), userId, String(plainPassword), changedBy);
  } catch (err) {
    console.error('[password history error]:', err);
  }
}

export { DEFAULT_PURPLE_THEME };

