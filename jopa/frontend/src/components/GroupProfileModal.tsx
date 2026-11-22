import React, { useState } from 'react';
import {
  X,
  Camera,
  Check,
  Copy,
  Users,
  UserPlus,
  Palette,
  Trash2,
  Edit3,
  Lock,
  BadgeCheck,
  ExternalLink
} from 'lucide-react';
import { ChatRoom, UserProfile } from '../types';
import { apiRequest, uploadFileInChunks, copyTextWithToast, showTopToast } from '../services/api';
import { AvatarMedia, BadgeList, VerifiedBadge } from './BadgeList';
import { formatLastSeen, renderTextWithIosEmojis } from './IosEmoji';

interface GroupProfileModalProps {
  room: ChatRoom;
  currentUser: UserProfile;
  contacts: UserProfile[];
  onClose: () => void;
  onUpdated: () => void;
  onDeletedRoom: () => void;
  onOpenRoomTheme: () => void;
  onSelectUserMiniProfile: (u: UserProfile) => void;
}

export const GroupProfileModal: React.FC<GroupProfileModalProps> = ({
  room,
  currentUser,
  contacts,
  onClose,
  onUpdated,
  onDeletedRoom,
  onOpenRoomTheme,
  onSelectUserMiniProfile
}) => {
  const isJward = Boolean(room.is_jward || room.id === 'global-lobby-room');
  const isAdmin = currentUser.is_admin === 1;
  const canEdit = isJward ? isAdmin : true;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name);
  const [slug, setSlug] = useState(room.slug || (isJward ? 'j' : ''));
  const [description, setDescription] = useState(room.description || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(room.avatar_url);
  const [saving, setSaving] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [showAddMember, setShowAddMember] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      let uploadedAvatarUrl: string | undefined;
      if (avatarFile) {
        const up = await uploadFileInChunks(avatarFile, 'avatars');
        uploadedAvatarUrl = up.fileUrl;
      }

      const payload: any = {
        name: isJward ? 'jward' : name.trim(),
        description: description.trim()
      };
      if (!isJward && slug.trim()) {
        payload.slug = slug.replace(/^@/, '').trim();
      }
      if (uploadedAvatarUrl) {
        payload.avatarUrl = uploadedAvatarUrl;
      }

      await apiRequest(`/chat/rooms/${room.id}/profile`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      setEditing(false);
      setStatusMsg('профиль сохранен');
      showTopToast('профиль группы сохранен!', 'success');
      onUpdated();
    } catch (err: any) {
      setStatusMsg(err.message || 'ошибка сохранения');
      showTopToast(err.message || 'ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRoomVerification = async () => {
    try {
      const res = await apiRequest(`/admin/rooms/${room.id}/verify`, {
        method: 'PUT',
        body: JSON.stringify({ isVerified: !room.is_verified })
      });
      setStatusMsg(res.message);
      showTopToast(res.message, 'success');
      onUpdated();
    } catch (err: any) {
      setStatusMsg(err.message);
      showTopToast(err.message, 'error');
    }
  };

  const handleSearchUsers = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await apiRequest<{ users: UserProfile[] }>(
        `/chat/users/search?q=${encodeURIComponent(q.replace(/^@/, ''))}`
      );
      const existingIds = new Set(room.members.map((m) => m.id));
      setSearchResults(res.users.filter((u) => !existingIds.has(u.id)));
    } catch {
      setSearchResults([]);
    }
  };

  const handleAddMember = async (uid: string) => {
    try {
      await apiRequest(`/chat/rooms/${room.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userIds: [uid] })
      });
      setSearchResults((prev) => prev.filter((u) => u.id !== uid));
      showTopToast('участник добавлен в группу!', 'success');
      onUpdated();
    } catch (err: any) {
      showTopToast(err.message, 'error');
    }
  };

  const handleDeleteRoom = async () => {
    if (isJward) return;
    if (!window.confirm(`удалить группу «${room.name}» у всех участников?`)) return;
    try {
      await apiRequest(`/chat/rooms/${room.id}`, { method: 'DELETE' });
      showTopToast('группа удалена', 'info');
      onDeletedRoom();
    } catch (err: any) {
      showTopToast(err.message, 'error');
    }
  };

  const displaySlug = isJward ? 'j' : room.slug || slug || 'group';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-menu-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel border border-white/10 rounded-3xl w-full max-w-md max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {isJward ? 'профиль канала' : 'профиль группы'}
          </h3>
          <div className="flex items-center gap-1.5">
            {canEdit && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-jess-textMuted hover:text-white transition"
                title="редактировать"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-white/10 text-jess-textMuted hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Статус СВЕРХУ окна */}
        {statusMsg && (
          <div className="mx-6 mt-3 px-4 py-2 rounded-2xl bg-black/50 border border-jess-accent/40 text-xs text-white flex items-center justify-between animate-menu-in">
            <span>{statusMsg}</span>
            <button type="button" onClick={() => setStatusMsg(null)} className="text-jess-textMuted hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {editing ? (
            <form onSubmit={handleSaveProfile} className="space-y-3.5">
              <div className="flex items-center gap-4">
                <label className="relative w-16 h-16 rounded-full overflow-hidden bg-jess-surface border border-jess-accent cursor-pointer group shrink-0">
                  {avatarPreview ? (
                    <AvatarMedia src={avatarPreview} alt={name} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lg font-bold text-jess-accent">
                      {name.slice(0, 2)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/55 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <Camera className="w-5 h-5 text-white" />
                  </div>
                  <input
                    type="file"
                    accept="image/*,video/mp4,video/webm"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setAvatarFile(f);
                        setAvatarPreview(URL.createObjectURL(f));
                      }
                    }}
                    className="hidden"
                  />
                </label>

                <div className="flex-1 space-y-2">
                  <input
                    type="text"
                    disabled={isJward}
                    value={isJward ? 'jward' : name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Название группы"
                    className="w-full px-3.5 py-2 rounded-2xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none neon-border-focus disabled:opacity-60"
                  />
                  {!isJward && (
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-xs text-jess-textMuted">mered.ro/@</span>
                      <input
                        type="text"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value.replace(/^@/, ''))}
                        placeholder="group_slug"
                        className="w-full pl-24 pr-3 py-1.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs text-jess-textMuted mb-1">описание</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Добавьте описание группы..."
                  className="w-full px-3.5 py-2 rounded-2xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus resize-none"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-white/10 text-xs text-jess-textMuted hover:text-white"
                >
                  отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 rounded-xl cta-music-btn text-white text-xs font-semibold"
                >
                  {saving ? 'сохранение...' : 'сохранить'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-jess-surface border-2 border-jess-accent/60 flex items-center justify-center text-xl font-bold text-jess-accent shrink-0 soft-glow">
                  {room.avatar_url ? (
                    <AvatarMedia src={room.avatar_url} alt={room.name} />
                  ) : (
                    room.name.slice(0, 2)
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <h4 className="text-base font-bold text-white truncate">
                      {renderTextWithIosEmojis(room.name)}
                    </h4>
                    {(room.is_verified || isJward) && <VerifiedBadge size="md" />}
                  </div>
                  <div className="text-xs font-mono" style={{ color: 'var(--accent-hover)' }}>
                    @{displaySlug}
                  </div>
                  <div className="text-[11px] text-jess-textMuted mt-0.5">
                    {isJward && !isAdmin
                      ? 'главный канал • закреплен'
                      : `участников: ${room.members.length}`}
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-jess-textMain">
                <div className="text-[10px] text-jess-textMuted mb-1">описание</div>
                <p className="whitespace-pre-wrap leading-relaxed">
                  {room.description
                    ? renderTextWithIosEmojis(room.description)
                    : 'описание пока не добавлено'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    copyTextWithToast(
                      `https://mered.ro/@${displaySlug}`,
                      `ссылка mered.ro/@${displaySlug} скопирована!`
                    );
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-jess-accent transition"
                >
                  <span className="font-mono">{copiedLink ? 'скопировано!' : `mered.ro/@${displaySlug}`}</span>
                  {copiedLink ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    window.history.pushState({}, '', `/@${displaySlug}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  title="открыть публичную карточку группы / канала"
                  className="p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-jess-textMuted hover:text-white transition"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>

              {(!isJward || isAdmin) && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onOpenRoomTheme}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs text-white transition"
                  >
                    <Palette className="w-3.5 h-3.5 text-jess-accent" />
                    <span>тема и общие обои</span>
                  </button>

                  {isAdmin && !isJward && (
                    <button
                      type="button"
                      onClick={handleToggleRoomVerification}
                      className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl border text-xs transition ${
                        room.is_verified
                          ? 'bg-sky-500/20 border-sky-400/50 text-sky-300'
                          : 'bg-white/[0.05] border-white/10 text-jess-textMuted hover:text-white'
                      }`}
                    >
                      <BadgeCheck className="w-3.5 h-3.5" />
                      <span>{room.is_verified ? 'галочка ✓' : 'галочка'}</span>
                    </button>
                  )}

                  {!isJward && (
                    <button
                      type="button"
                      onClick={handleDeleteRoom}
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-2xl bg-red-500/15 hover:bg-red-500/30 border border-red-500/30 text-xs text-red-300 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>удалить</span>
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {isJward && !isAdmin ? (
            <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center gap-2.5 text-xs text-jess-textMuted">
              <Lock className="w-4 h-4 text-jess-accent shrink-0" />
              <span>список участников этого канала доступен только администратору</span>
            </div>
          ) : (
            <div className="pt-2 border-t border-white/5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-jess-textMuted">
                  <Users className="w-3.5 h-3.5 text-jess-accent" />
                  <span>участники ({room.members.length})</span>
                </div>

                {!isJward && (
                  <button
                    type="button"
                    onClick={() => setShowAddMember(!showAddMember)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-jess-accent/20 hover:bg-jess-accent text-white text-[11px] transition"
                  >
                    <UserPlus className="w-3 h-3" />
                    <span>добавить</span>
                  </button>
                )}
              </div>

              {showAddMember && (
                <div className="p-3 rounded-2xl bg-black/40 border border-white/10 space-y-2">
                  <input
                    type="text"
                    placeholder="Введите имя или @юзернейм..."
                    value={searchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-jess-accent"
                  />
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {(searchQuery.trim()
                      ? searchResults
                      : contacts.filter((c) => !room.members.some((m) => m.id === c.id))
                    ).map((u) => (
                      <div key={u.id} className="flex items-center justify-between p-1.5 rounded-xl bg-white/[0.03]">
                        <span className="text-xs text-white truncate">
                          {u.display_name} (@{u.username})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddMember(u.id)}
                          className="px-2.5 py-1 rounded-lg bg-jess-accent text-white text-[11px] font-semibold"
                        >
                          +
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {room.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectUserMiniProfile(member);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-2xl hover:bg-white/[0.05] text-left transition"
                  >
                    <div className="relative w-9 h-9 shrink-0">
                      <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border border-white/10 flex items-center justify-center text-xs font-semibold text-jess-accent">
                        {member.avatar_url ? (
                          <AvatarMedia src={member.avatar_url} alt={member.display_name} />
                        ) : (
                          member.display_name.slice(0, 2)
                        )}
                      </div>
                      {member.is_online && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-jess-bg z-10" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center">
                        <BadgeList badges={member.badges} size="sm" />
                        <span className="text-xs font-semibold text-white truncate">
                          {renderTextWithIosEmojis(member.display_name)}
                        </span>
                        {member.is_verified && <VerifiedBadge size="sm" />}
                      </div>
                      <div className="text-[11px] text-jess-textMuted truncate">
                        {formatLastSeen(member.is_online, member.last_seen_at)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
