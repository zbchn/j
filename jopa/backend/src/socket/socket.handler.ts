import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../config';
import {
  db,
  getMessageByIdDTO,
  getUserProfileById,
  setOnlineChecker,
  getNextMsgNumber,
  markRoomMessagesRead,
  recordUserIpLog
} from '../db';
import { JwtPayload, UserProfile } from '../types';

let ioInstance: Server | null = null;
const onlineSocketsByUser = new Map<string, Set<string>>();

export interface CallParticipantState {
  socketId: string;
  userId: string;
  user: UserProfile;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
}

const activeCalls = new Map<string, Map<string, CallParticipantState>>();
interface ActiveCallMeta {
  initiatorId: string;
  startedAt: number;
  answeredAt: number | null;
  wasDeclined: boolean;
}
const activeCallMeta = new Map<string, ActiveCallMeta>();

setOnlineChecker((userId: string) => {
  const set = onlineSocketsByUser.get(userId);
  return Boolean(set && set.size > 0);
});

export function getIO(): Server | null {
  return ioInstance;
}

function getRoomMemberIds(roomId: string): string[] {
  const rows = db.prepare('SELECT user_id FROM room_members WHERE room_id = ?').all(roomId) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

function emitToRoomMembers(io: Server, roomId: string, event: string, data: any): void {
  if (roomId === 'global-lobby-room') {
    io.emit(event, data);
    return;
  }
  const memberIds = getRoomMemberIds(roomId);
  for (const uid of memberIds) {
    io.to(`user:${uid}`).emit(event, data);
  }
}

export function broadcastMessageUpdateToRoom(
  roomId: string,
  messageId: string,
  eventName: 'message:new' | 'message:updated'
): void {
  const io = ioInstance;
  if (!io) return;

  const memberIds =
    roomId === 'global-lobby-room'
      ? (db.prepare('SELECT id FROM users').all() as { id: string }[]).map((u) => u.id)
      : getRoomMemberIds(roomId);

  for (const uid of memberIds) {
    const uRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(uid) as { is_admin: number } | undefined;
    const isAdmin = uRow?.is_admin === 1;
    const dto = getMessageByIdDTO(messageId, { viewerIsAdmin: isAdmin, viewerUserId: uid });
    if (dto) {
      io.to(`user:${uid}`).emit(eventName, dto);
    }
  }
}

function serializeCallParticipants(roomId: string): CallParticipantState[] {
  const roomCall = activeCalls.get(roomId);
  if (!roomCall) return [];
  return Array.from(roomCall.values());
}

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 100 * 1024 * 1024
  });

  ioInstance = io;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token || typeof token !== 'string') {
      return next(new Error('требуется авторизация'));
    }

    try {
      const payload = jwt.verify(token, CONFIG.JWT_SECRET) as JwtPayload;
      const userRow = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(payload.userId) as any;

      if (!userRow) {
        return next(new Error('аккаунт не найден'));
      }

      socket.data.userId = userRow.id;
      socket.data.username = userRow.username;
      socket.data.isAdmin = userRow.is_admin === 1;
      next();
    } catch {
      next(new Error('недействительный токен'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId: string = socket.data.userId;

    if (!onlineSocketsByUser.has(userId)) {
      onlineSocketsByUser.set(userId, new Set());
    }
    onlineSocketsByUser.get(userId)!.add(socket.id);

    db.prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`).run(userId);
    const sockIp = String(
      socket.handshake.headers['x-forwarded-for'] ||
        socket.handshake.headers['x-real-ip'] ||
        socket.handshake.address ||
        'unknown'
    ).split(',')[0].trim().replace(/^::ffff:/, '');
    recordUserIpLog(userId, sockIp, String(socket.handshake.headers['user-agent'] || ''), 'socket_connect');

    socket.join(`user:${userId}`);

    db.prepare(`
      INSERT OR IGNORE INTO room_members (room_id, user_id, role, is_pinned)
      VALUES ('global-lobby-room', ?, 'member', 1)
    `).run(userId);

    const userRooms = db.prepare('SELECT room_id FROM room_members WHERE user_id = ?').all(userId) as { room_id: string }[];
    for (const r of userRooms) {
      socket.join(`room:${r.room_id}`);
    }

    const updatedProfile = getUserProfileById(userId);
    io.emit('presence:update', {
      userId,
      isOnline: true,
      lastSeenAt: updatedProfile?.last_seen_at,
      user: updatedProfile
    });

    socket.on('room:join_channel', ({ roomId }: { roomId: string }) => {
      if (roomId === 'global-lobby-room') {
        socket.join(`room:${roomId}`);
        return;
      }
      const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
      if (member) {
        socket.join(`room:${roomId}`);
      }
    });

    socket.on('message:send', (payload: { roomId: string; content: string; replyToId?: string }) => {
      const { roomId, content, replyToId } = payload;
      if (!content || String(content).trim().length === 0) return;

      const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
      const isAdmin = userRow?.is_admin === 1;

      if (roomId === 'global-lobby-room') {
        if (!isAdmin) return;
        db.prepare(`
          INSERT OR IGNORE INTO room_members (room_id, user_id, role, is_pinned)
          VALUES ('global-lobby-room', ?, 'owner', 1)
        `).run(userId);
      }

      const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
      if (!member) return;

      const msgId = uuidv4();
      const nextNum = getNextMsgNumber(roomId);
      db.prepare(`
        INSERT INTO messages (id, room_id, msg_number, sender_id, content, type, reply_to_id)
        VALUES (?, ?, ?, ?, ?, 'text', ?)
      `).run(msgId, roomId, nextNum, userId, String(content).trim(), replyToId || null);

      db.prepare("UPDATE room_members SET last_read_at = datetime('now') WHERE room_id = ? AND user_id = ?").run(roomId, userId);

      broadcastMessageUpdateToRoom(roomId, msgId, 'message:new');
    });


    socket.on('message:send_sticker', (payload: { roomId: string; fileUrl: string; replyToId?: string }) => {
      const { roomId, fileUrl, replyToId } = payload;
      if (!roomId || !fileUrl) return;

      const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
      const isAdmin = userRow?.is_admin === 1;
      if (roomId === 'global-lobby-room' && !isAdmin) return;

      const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
      if (!member) return;

      const msgId = uuidv4();
      const nextNum = getNextMsgNumber(roomId);
      db.prepare(`
        INSERT INTO messages (id, room_id, msg_number, sender_id, content, type, file_url, reply_to_id)
        VALUES (?, ?, ?, ?, '', 'sticker', ?, ?)
      `).run(msgId, roomId, nextNum, userId, String(fileUrl), replyToId || null);

      db.prepare("UPDATE room_members SET last_read_at = datetime('now') WHERE room_id = ? AND user_id = ?").run(roomId, userId);
      broadcastMessageUpdateToRoom(roomId, msgId, 'message:new');
    });

    socket.on('message:edit', (payload: { messageId: string; newContent: string }) => {
      const { messageId, newContent } = payload;
      if (!messageId || !newContent || !String(newContent).trim()) return;

      const msgRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
      if (!msgRow || msgRow.is_deleted === 1) return;

      const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
      const isAdmin = userRow?.is_admin === 1;

      if (msgRow.sender_id !== userId && !isAdmin) return;

      const trimmedNext = String(newContent).trim();
      if (trimmedNext === msgRow.content) return;

      const editTx = db.transaction(() => {
        db.prepare(`
          INSERT INTO message_edits (id, message_id, old_content, edited_by, edited_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(uuidv4(), messageId, msgRow.content, userId);

        db.prepare(`
          UPDATE messages
          SET content = ?, is_edited = 1, edited_at = datetime('now')
          WHERE id = ?
        `).run(trimmedNext, messageId);
      });

      editTx();
      broadcastMessageUpdateToRoom(msgRow.room_id, messageId, 'message:updated');
    });

    socket.on('message:delete', (payload: { messageId: string }) => {
      const { messageId } = payload;
      if (!messageId) return;

      const msgRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
      if (!msgRow) return;

      const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
      const isAdmin = userRow?.is_admin === 1;

      if (msgRow.sender_id !== userId && !isAdmin) return;

      db.prepare(`
        UPDATE messages
        SET is_deleted = 1, is_pinned = 0, deleted_at = datetime('now'), deleted_by = ?
        WHERE id = ?
      `).run(userId, messageId);

      const roomId = msgRow.room_id;
      const memberIds =
        roomId === 'global-lobby-room'
          ? (db.prepare('SELECT id FROM users').all() as { id: string }[]).map((u) => u.id)
          : getRoomMemberIds(roomId);

      for (const uid of memberIds) {
        const u = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(uid) as { is_admin: number } | undefined;
        if (u?.is_admin === 1) {
          const adminDto = getMessageByIdDTO(messageId, { viewerIsAdmin: true, viewerUserId: uid });
          if (adminDto) {
            io.to(`user:${uid}`).emit('message:updated', adminDto);
          }
        } else {
          io.to(`user:${uid}`).emit('message:deleted', { roomId, messageId });
        }
      }
    });

    socket.on('message:forward', (payload: { messageId: string; targetRoomId: string }) => {
      const { messageId, targetRoomId } = payload;
      if (!messageId || !targetRoomId) return;

      const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
      const isAdmin = userRow?.is_admin === 1;

      if (targetRoomId === 'global-lobby-room' && !isAdmin) return;

      const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(targetRoomId, userId);
      if (!member && targetRoomId !== 'global-lobby-room') return;

      const orig = getMessageByIdDTO(messageId, { viewerIsAdmin: isAdmin, viewerUserId: userId });
      if (!orig) return;

      const newMsgId = uuidv4();
      const nextNum = getNextMsgNumber(targetRoomId);
      const fwdName = orig.forwarded_from?.sender_display_name || orig.sender.display_name;
      const fwdUsername = orig.forwarded_from?.sender_username || orig.sender.username;

      db.prepare(`
        INSERT INTO messages (
          id, room_id, msg_number, sender_id, content, type,
          file_url, file_name, file_size,
          voice_waveform, voice_duration,
          forwarded_from_name, forwarded_from_username
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newMsgId,
        targetRoomId,
        nextNum,
        userId,
        orig.content,
        orig.type === 'system' ? 'text' : orig.type,
        orig.file_url,
        orig.file_name,
        orig.file_size,
        orig.voice_waveform ? JSON.stringify(orig.voice_waveform) : null,
        orig.voice_duration,
        fwdName,
        fwdUsername
      );

      db.prepare("UPDATE room_members SET last_read_at = datetime('now') WHERE room_id = ? AND user_id = ?").run(
        targetRoomId,
        userId
      );

      broadcastMessageUpdateToRoom(targetRoomId, newMsgId, 'message:new');
    });

    socket.on('message:toggle_pin', (payload: { messageId: string }) => {
      const { messageId } = payload;
      const msg = db.prepare('SELECT room_id, is_pinned FROM messages WHERE id = ?').get(messageId) as any;
      if (!msg) return;

      const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
      const isAdmin = userRow?.is_admin === 1;

      if (msg.room_id === 'global-lobby-room' && !isAdmin) return;

      const member = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(msg.room_id, userId);
      if (!member) return;

      const nextPin = msg.is_pinned === 1 ? 0 : 1;
      db.prepare('UPDATE messages SET is_pinned = ? WHERE id = ?').run(nextPin, messageId);

      broadcastMessageUpdateToRoom(msg.room_id, messageId, 'message:updated');
      const updated = getMessageByIdDTO(messageId, { viewerIsAdmin: isAdmin, viewerUserId: userId });
      emitToRoomMembers(io, msg.room_id, 'room:pins_updated', { roomId: msg.room_id, message: updated });
      io.emit('room:updated', { roomId: msg.room_id });
    });

    socket.on('message:toggle_reaction', (payload: { messageId: string; emoji: string }) => {
      const { messageId, emoji } = payload;
      if (!emoji) return;

      const msg = db.prepare('SELECT room_id FROM messages WHERE id = ?').get(messageId) as any;
      if (!msg) return;

      const existing = db.prepare(`
        SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?
      `).get(messageId, userId, emoji);

      if (existing) {
        db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, userId, emoji);
      } else {
        db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, userId, emoji);
      }

      broadcastMessageUpdateToRoom(msg.room_id, messageId, 'message:updated');
    });

    socket.on('typing:start', ({ roomId }: { roomId: string }) => {
      if (roomId === 'global-lobby-room') return;
      const u = getUserProfileById(userId);
      socket.to(`room:${roomId}`).emit('typing:update', {
        roomId,
        userId,
        displayName: u?.display_name || 'пользователь',
        isTyping: true
      });
    });

    socket.on('typing:stop', ({ roomId }: { roomId: string }) => {
      socket.to(`room:${roomId}`).emit('typing:update', {
        roomId,
        userId,
        isTyping: false
      });
    });

    socket.on('room:mark_read', ({ roomId }: { roomId: string }) => {
      if (!roomId) return;
      const hasNew = markRoomMessagesRead(roomId, userId);
      // Всегда сбрасываем бейдж непрочитанных сообщений у этого пользователя во всех вкладках!
      io.to(`user:${userId}`).emit('room:unread_cleared', { roomId });

      if (hasNew) {
        const readerProfile = getUserProfileById(userId);
        const nowIso = new Date().toISOString();
        if (readerProfile && (roomId === 'global-lobby-room' || (readerProfile.is_admin === 1 && readerProfile.hide_read_time))) {
          const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all() as { id: string }[];
          for (const a of admins) {
            io.to(`user:${a.id}`).emit('room:messages_read', {
              roomId,
              userId,
              readAt: nowIso,
              reader: {
                user_id: readerProfile.id,
                username: readerProfile.username,
                display_name: readerProfile.display_name,
                avatar_url: readerProfile.avatar_url
              }
            });
          }
        } else if (readerProfile) {
          emitToRoomMembers(io, roomId, 'room:messages_read', {
            roomId,
            userId,
            readAt: nowIso,
            reader: {
              user_id: readerProfile.id,
              username: readerProfile.username,
              display_name: readerProfile.display_name,
              avatar_url: readerProfile.avatar_url
            }
          });
        }
      }
    });

    // ==================== ЗВОНКИ И ДЕМОНСТРАЦИЯ ЭКРАНА (WEBRTC SIGNALING) ====================

    socket.on('call:get_state', ({ roomId }: { roomId: string }, callback?: Function) => {
      const participants = serializeCallParticipants(roomId);
      if (typeof callback === 'function') {
        callback({ active: participants.length > 0, participants });
      }
    });

    socket.on('call:join', ({ roomId }: { roomId: string }, callback?: Function) => {
      const profile = getUserProfileById(userId);
      if (!profile) {
        if (typeof callback === 'function') callback({ error: 'профиль не найден' });
        return;
      }

      // Останавливаем рингтон входящего звонка на ВСЕХ других открытых вкладках и устройствах этого пользователя!
      io.to(`user:${userId}`).emit('call:dismiss_incoming', { roomId });

      if (!activeCalls.has(roomId)) {
        activeCalls.set(roomId, new Map());
      }
      const roomCall = activeCalls.get(roomId)!;

      for (const [oldSid, p] of roomCall.entries()) {
        if (p.userId === userId) {
          roomCall.delete(oldSid);
          if (oldSid !== socket.id) {
            io.to(`call:${roomId}`).emit('call:peer_left', { roomId, socketId: oldSid, userId });
          }
        }
      }

      const otherParticipantsCount = Array.from(roomCall.values()).filter((p) => p.userId !== userId).length;
      const wasEmpty = otherParticipantsCount === 0;

      if (wasEmpty) {
        activeCallMeta.set(roomId, {
          initiatorId: userId,
          startedAt: Date.now(),
          answeredAt: null,
          wasDeclined: false
        });
      } else {
        const meta = activeCallMeta.get(roomId);
        if (meta && !meta.answeredAt && userId !== meta.initiatorId) {
          meta.answeredAt = Date.now();
        }
      }

      const myPeerState: CallParticipantState = {
        socketId: socket.id,
        userId,
        user: profile,
        isMuted: false,
        isDeafened: false,
        isCameraOn: false,
        isScreenSharing: false
      };

      roomCall.set(socket.id, myPeerState);
      socket.join(`call:${roomId}`);

      const participants = serializeCallParticipants(roomId);

      io.to(`call:${roomId}`).emit('call:sound', {
        roomId,
        type: 'open',
        userId
      });

      socket.to(`call:${roomId}`).emit('call:peer_joined', {
        roomId,
        peer: myPeerState
      });

      emitToRoomMembers(io, roomId, 'call:participants_updated', {
        roomId,
        participants
      });

      if (wasEmpty && roomId !== 'global-lobby-room') {
        const roomRow = db.prepare('SELECT id, name, is_group FROM rooms WHERE id = ?').get(roomId) as any;
        const memberIds = getRoomMemberIds(roomId).filter((uid) => uid !== userId);
        for (const targetUid of memberIds) {
          io.to(`user:${targetUid}`).emit('call:incoming', {
            roomId,
            roomName: roomRow?.is_group ? roomRow.name : profile.display_name,
            isGroup: Boolean(roomRow?.is_group),
            caller: profile
          });
        }
      }

      if (typeof callback === 'function') {
        callback({ participants });
      }
    });

    socket.on(
      'call:update_state',
      (payload: {
        roomId: string;
        isMuted?: boolean;
        isDeafened?: boolean;
        isCameraOn?: boolean;
        isScreenSharing?: boolean;
      }) => {
        const roomCall = activeCalls.get(payload.roomId);
        const peer = roomCall?.get(socket.id);
        if (!roomCall || !peer) return;

        if (payload.isMuted !== undefined) peer.isMuted = Boolean(payload.isMuted);
        if (payload.isDeafened !== undefined) peer.isDeafened = Boolean(payload.isDeafened);
        if (payload.isCameraOn !== undefined) peer.isCameraOn = Boolean(payload.isCameraOn);
        if (payload.isScreenSharing !== undefined) peer.isScreenSharing = Boolean(payload.isScreenSharing);

        const participants = serializeCallParticipants(payload.roomId);
        emitToRoomMembers(io, payload.roomId, 'call:participants_updated', {
          roomId: payload.roomId,
          participants
        });
      }
    );

    socket.on(
      'call:signal',
      (payload: {
        roomId: string;
        targetSocketId: string;
        type: 'offer' | 'answer' | 'ice-candidate';
        sdp?: any;
        candidate?: any;
      }) => {
        const profile = getUserProfileById(userId);
        io.to(payload.targetSocketId).emit('call:signal', {
          roomId: payload.roomId,
          fromSocketId: socket.id,
          fromUserId: userId,
          fromUser: profile,
          type: payload.type,
          sdp: payload.sdp,
          candidate: payload.candidate
        });
      }
    );

    socket.on('call:ping', (callback?: Function) => {
      if (typeof callback === 'function') callback({ ts: Date.now() });
    });

    socket.on('call:decline', ({ roomId }: { roomId: string }) => {
      // Останавливаем рингтон во всех других открытых вкладках этого же пользователя!
      io.to(`user:${userId}`).emit('call:dismiss_incoming', { roomId });

      const meta = activeCallMeta.get(roomId);
      if (meta) meta.wasDeclined = true;

      const profile = getUserProfileById(userId);
      io.to(`call:${roomId}`).emit('call:declined', {
        roomId,
        userId,
        user: profile
      });
    });

    const handleLeaveCall = (roomId: string) => {
      const roomCall = activeCalls.get(roomId);
      if (!roomCall || !roomCall.has(socket.id)) return;

      io.to(`call:${roomId}`).emit('call:sound', {
        roomId,
        type: 'close',
        userId
      });

      roomCall.delete(socket.id);
      socket.leave(`call:${roomId}`);

      io.to(`call:${roomId}`).emit('call:peer_left', {
        roomId,
        socketId: socket.id,
        userId
      });

      const participants = serializeCallParticipants(roomId);
      emitToRoomMembers(io, roomId, 'call:participants_updated', {
        roomId,
        participants
      });

      if (roomCall.size === 0) {
        activeCalls.delete(roomId);
        const meta = activeCallMeta.get(roomId);
        activeCallMeta.delete(roomId);

        if (meta && roomId !== 'global-lobby-room') {
          const status = meta.answeredAt ? 'completed' : meta.wasDeclined ? 'declined' : 'missed';
          const durationSec = meta.answeredAt ? Math.max(1, Math.round((Date.now() - meta.answeredAt) / 1000)) : 0;
          const callMsgId = uuidv4();
          const nextNum = getNextMsgNumber(roomId);
          const payloadJson = JSON.stringify({
            status,
            durationSec,
            callerId: meta.initiatorId
          });
          try {
            db.prepare(`
              INSERT INTO messages (id, room_id, msg_number, sender_id, content, type)
              VALUES (?, ?, ?, ?, ?, 'call')
            `).run(callMsgId, roomId, nextNum, meta.initiatorId, payloadJson);
            broadcastMessageUpdateToRoom(roomId, callMsgId, 'message:new');
          } catch (err) {
            console.error('[call log message error]:', err);
          }
        }

        emitToRoomMembers(io, roomId, 'call:ended', { roomId });
      }
    };

    socket.on('call:leave', ({ roomId }: { roomId: string }) => {
      handleLeaveCall(roomId);
    });

    socket.on('disconnect', () => {
      for (const [roomId, roomCall] of activeCalls.entries()) {
        if (roomCall.has(socket.id)) {
          handleLeaveCall(roomId);
        }
      }

      const userSet = onlineSocketsByUser.get(userId);
      if (userSet) {
        userSet.delete(socket.id);
        if (userSet.size === 0) {
          onlineSocketsByUser.delete(userId);
          db.prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`).run(userId);
          const offProfile = getUserProfileById(userId);
          io.emit('presence:update', {
            userId,
            isOnline: false,
            lastSeenAt: offProfile?.last_seen_at,
            user: offProfile
          });
        }
      }
    });
  });

  return io;
}
