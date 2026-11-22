import React, { useEffect, useState } from 'react';
import {
  X,
  Award,
  Users,
  Trash2,
  PlusCircle,
  Check,
  Edit3,
  Camera,
  BadgeCheck,
  Hash,
  Shield,
  KeyRound,
  Globe,
  Crop
} from 'lucide-react';
import { Badge, UserIpLog, UserPasswordHistoryItem, UserProfile } from '../types';
import { apiRequest, showTopToast, uploadFileInChunks } from '../services/api';
import { AvatarMedia, BadgeList, VerifiedBadge } from './BadgeList';
import { SquareCropModal } from './SquareCropModal';

interface AdminPanelModalProps {
  currentUser: UserProfile;
  onClose: () => void;
}

// Автоматический подгон размера ТОЛЬКО для статичных PNG/JPEG (GIF, WebP, APNG, MP4, WebM оставляем без пережатия, чтобы сохранялась анимация!)
async function prepareBadgeIconFile(file: File, maxDim = 96): Promise<File> {
  const ext = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  if (
    mime.includes('gif') ||
    mime.includes('webp') ||
    mime.includes('video') ||
    mime.includes('svg') ||
    ext.endsWith('.gif') ||
    ext.endsWith('.webp') ||
    ext.endsWith('.apng') ||
    ext.endsWith('.mp4') ||
    ext.endsWith('.webm') ||
    ext.endsWith('.svg')
  ) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(file);
          return;
        }
        resolve(new File([blob], 'badge.png', { type: 'image/png' }));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({ currentUser, onClose }) => {
  const [tab, setTab] = useState<'users' | 'rooms' | 'badges'>('users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [rooms, setRooms] = useState<
    {
      id: string;
      name: string;
      slug: string;
      description: string;
      avatar_url: string | null;
      is_verified: boolean;
      member_count: number;
    }[]
  >([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [stats, setStats] = useState({ totalUsers: 0, totalMessages: 0, totalRooms: 0, totalBadges: 0 });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Редактирование пользователя
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editNewPassword, setEditNewPassword] = useState('');
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editIsVerified, setEditIsVerified] = useState(false);
  const [editHideRead, setEditHideRead] = useState(false);
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [removeUserAvatar, setRemoveUserAvatar] = useState(false);

  // Создание бейджа (статичного или анимированного)
  const [badgeName, setBadgeName] = useState('');
  const [badgeBorderColor, setBadgeBorderColor] = useState('#8a2be2');
  const [badgeGlowColor, setBadgeGlowColor] = useState('rgba(138, 43, 226, 0.55)');
  const [badgeIconFile, setBadgeIconFile] = useState<File | null>(null);
  const [badgePreviewUrl, setBadgePreviewUrl] = useState<string | null>(null);
  const [badgeCropFile, setBadgeCropFile] = useState<File | null>(null);
  const [badgeCropParams, setBadgeCropParams] = useState<{ cropX: number; cropY: number; cropSize: number } | undefined>(undefined);

  // Логи IP и пароли
  const [securityModalUser, setSecurityModalUser] = useState<UserProfile | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityIpLogs, setSecurityIpLogs] = useState<UserIpLog[]>([]);
  const [securityPasswords, setSecurityPasswords] = useState<UserPasswordHistoryItem[]>([]);

  const handleOpenSecurityModal = async (u: UserProfile) => {
    setSecurityModalUser(u);
    setSecurityLoading(true);
    setSecurityIpLogs([]);
    setSecurityPasswords([]);
    try {
      const res = await apiRequest<{ ipLogs: UserIpLog[]; passwords: UserPasswordHistoryItem[] }>(
        `/admin/users/${u.id}/security`
      );
      setSecurityIpLogs(res.ipLogs || []);
      setSecurityPasswords(res.passwords || []);
    } catch (err: any) {
      showTopToast(err.message || 'ошибка загрузки логов', 'error');
    } finally {
      setSecurityLoading(false);
    }
  };

  const loadOverview = async () => {
    try {
      const data = await apiRequest<{
        users: UserProfile[];
        rooms?: any[];
        badges: Badge[];
        stats: typeof stats;
      }>('/admin/overview');
      setUsers(data.users);
      setRooms(data.rooms || []);
      setBadges(data.badges);
      setStats(data.stats);
    } catch (err: any) {
      setStatusMessage(err.message || 'ошибка загрузки панели');
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleToggleVerifyUser = async (u: UserProfile) => {
    try {
      const res = await apiRequest(`/admin/users/${u.id}/verify`, {
        method: 'PUT',
        body: JSON.stringify({ isVerified: !u.is_verified })
      });
      setStatusMessage(res.message);
      showTopToast(res.message || 'статус верификации обновлен');
      loadOverview();
    } catch (err: any) {
      setStatusMessage(err.message);
    }
  };

  const handleToggleVerifyRoom = async (r: { id: string; is_verified: boolean }) => {
    try {
      const res = await apiRequest(`/admin/rooms/${r.id}/verify`, {
        method: 'PUT',
        body: JSON.stringify({ isVerified: !r.is_verified })
      });
      setStatusMessage(res.message);
      showTopToast(res.message || 'статус верификации группы обновлен');
      loadOverview();
    } catch (err: any) {
      setStatusMessage(err.message);
    }
  };

  const handleStartFullEdit = (u: UserProfile) => {
    setEditingUser(u);
    setEditUsername(u.username);
    setEditDisplayName(u.display_name);
    setEditBio(u.bio || '');
    setEditNewPassword('');
    setEditIsAdmin(u.is_admin === 1);
    setEditIsVerified(Boolean(u.is_verified));
    setEditHideRead(Boolean(u.hide_read_time));
    setEditAvatarFile(null);
    setEditAvatarPreview(u.avatar_url);
    setRemoveUserAvatar(false);
  };

  const handleSaveFullUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      let uploadedAvatarUrl: string | undefined;
      if (editAvatarFile) {
        const up = await uploadFileInChunks(editAvatarFile, 'avatars');
        uploadedAvatarUrl = up.fileUrl;
      }

      const payload: any = {
        username: editUsername.replace(/^@/, '').trim(),
        displayName: editDisplayName.trim(),
        bio: editBio,
        isAdmin: editIsAdmin,
        isVerified: editIsVerified,
        hideReadTime: editHideRead
      };
      if (editNewPassword.trim()) {
        payload.newPassword = editNewPassword.trim();
      }
      if (uploadedAvatarUrl) {
        payload.avatarUrl = uploadedAvatarUrl;
      } else if (removeUserAvatar) {
        payload.removeAvatar = true;
      }

      const res = await apiRequest(`/admin/users/${editingUser.id}/full`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      setStatusMessage(res.message);
      showTopToast('профиль пользователя сохранен');
      setEditingUser(null);
      loadOverview();
    } catch (err: any) {
      setStatusMessage(err.message);
    }
  };

  const handleDeleteUser = async (target: UserProfile) => {
    if (!window.confirm(`удалить аккаунт @${target.username} навсегда?`)) {
      return;
    }
    try {
      const res = await apiRequest(`/admin/users/${target.id}`, {
        method: 'DELETE'
      });
      setStatusMessage(res.message);
      showTopToast(`аккаунт @${target.username} удален`);
      if (editingUser?.id === target.id) setEditingUser(null);
      loadOverview();
    } catch (err: any) {
      setStatusMessage(err.message);
    }
  };

  const handleCreateBadge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!badgeIconFile || !badgeName.trim()) {
      setStatusMessage('укажите название и иконку бейджа.');
      return;
    }

    try {
      const preparedFile = await prepareBadgeIconFile(badgeIconFile, 96);
      const uploaded = await uploadFileInChunks(preparedFile, 'badges');

      const res = await apiRequest('/admin/badges', {
        method: 'POST',
        body: JSON.stringify({
          name: badgeName.trim(),
          borderColor: badgeBorderColor,
          glowColor: badgeGlowColor,
          iconUrl: uploaded.fileUrl,
          ...(badgeCropParams || {})
        })
      });

      setStatusMessage(res.message);
      showTopToast('бейдж создан!');
      setBadgeName('');
      setBadgeIconFile(null);
      setBadgePreviewUrl(null);
      setBadgeCropParams(undefined);
      loadOverview();
    } catch (err: any) {
      setStatusMessage(err.message);
    }
  };

  const handleDeleteBadge = async (badgeId: string) => {
    try {
      const res = await apiRequest(`/admin/badges/${badgeId}`, { method: 'DELETE' });
      setStatusMessage(res.message);
      showTopToast('бейдж удален');
      loadOverview();
    } catch (err: any) {
      setStatusMessage(err.message);
    }
  };

  const handleToggleUserBadge = async (targetUser: UserProfile, badge: Badge) => {
    const hasBadge = targetUser.badges.some((b) => b.id === badge.id);
    try {
      if (hasBadge) {
        const res = await apiRequest(`/admin/users/${targetUser.id}/badges/${badge.id}`, {
          method: 'DELETE'
        });
        setStatusMessage(res.message);
        showTopToast('бейдж снят');
      } else {
        const res = await apiRequest(`/admin/users/${targetUser.id}/badges/${badge.id}`, {
          method: 'POST'
        });
        setStatusMessage(res.message);
        showTopToast('бейдж выдан!');
      }
      loadOverview();
    } catch (err: any) {
      setStatusMessage(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-menu-in">
      <div className="glass-panel border border-white/10 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Шапка */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">панель администратора</h2>
            <p className="text-xs text-jess-textMuted">
              управление пользователями, верификацией (синяя галочка), группами и анимированными бейджами
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-jess-textMuted hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Статус-уведомление СВЕРХУ */}
        {statusMessage && (
          <div className="mx-6 mt-3 px-4 py-2.5 rounded-2xl bg-jess-accent/20 border border-jess-accent/40 text-xs text-white flex items-center justify-between animate-menu-in">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage(null)} className="text-jess-textMuted hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Метрики */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 px-6 py-3 border-b border-white/5 bg-black/20">
          <div className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="text-[11px] text-jess-textMuted">пользователи</div>
            <div className="text-base font-bold text-white">{stats.totalUsers}</div>
          </div>
          <div className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="text-[11px] text-jess-textMuted">группы и каналы</div>
            <div className="text-base font-bold text-jess-accentHover">{stats.totalRooms}</div>
          </div>
          <div className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="text-[11px] text-jess-textMuted">сообщения</div>
            <div className="text-base font-bold text-emerald-400">{stats.totalMessages}</div>
          </div>
          <div className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="text-[11px] text-jess-textMuted">бейджи</div>
            <div className="text-base font-bold text-amber-300">{stats.totalBadges}</div>
          </div>
        </div>

        {/* Вкладки */}
        <div className="flex items-center gap-2 px-6 pt-2 border-b border-white/5">
          <button
            onClick={() => setTab('users')}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-medium transition ${
              tab === 'users'
                ? 'border-jess-accent text-white'
                : 'border-transparent text-jess-textMuted hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>пользователи и галочки</span>
          </button>

          <button
            onClick={() => setTab('rooms')}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-medium transition ${
              tab === 'rooms'
                ? 'border-jess-accent text-white'
                : 'border-transparent text-jess-textMuted hover:text-white'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            <span>верификация групп ({rooms.length})</span>
          </button>

          <button
            onClick={() => setTab('badges')}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-medium transition ${
              tab === 'badges'
                ? 'border-jess-accent text-white'
                : 'border-transparent text-jess-textMuted hover:text-white'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>бейджи (gif / mp4 / png)</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {tab === 'users' && (
            <div className="space-y-3">
              {editingUser && (
                <form
                  onSubmit={handleSaveFullUser}
                  className="p-5 rounded-3xl bg-white/[0.03] border border-jess-accent/50 space-y-4 mb-4 animate-menu-in"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-white">
                      редактирование профиля @{editingUser.username}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setEditingUser(null)}
                      className="text-xs text-jess-textMuted hover:text-white"
                    >
                      закрыть
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <label className="relative w-16 h-16 rounded-full overflow-hidden bg-jess-surface border border-jess-accent cursor-pointer group shrink-0">
                      {editAvatarPreview && !removeUserAvatar ? (
                        <AvatarMedia src={editAvatarPreview} alt="" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-sm font-bold text-jess-accent">
                          {editDisplayName.slice(0, 2)}
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
                            setEditAvatarFile(f);
                            setEditAvatarPreview(URL.createObjectURL(f));
                            setRemoveUserAvatar(false);
                          }
                        }}
                        className="hidden"
                      />
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 flex-1">
                      <div>
                        <label className="block text-[10px] text-jess-textMuted mb-1">имя</label>
                        <input
                          type="text"
                          value={editDisplayName}
                          onChange={(e) => setEditDisplayName(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-jess-textMuted mb-1">юзернейм (@)</label>
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value.replace(/^@/, ''))}
                          className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-jess-textMuted mb-1">новый пароль (если нужно)</label>
                        <input
                          type="text"
                          placeholder="оставьте пустым..."
                          value={editNewPassword}
                          onChange={(e) => setEditNewPassword(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-jess-textMuted mb-1">о себе (bio)</label>
                    <textarea
                      rows={2}
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white resize-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editIsVerified}
                          onChange={(e) => setEditIsVerified(e.target.checked)}
                          className="accent-sky-400"
                        />
                        <span>синяя галочка верификации</span>
                      </label>

                      <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editIsAdmin}
                          onChange={(e) => setEditIsAdmin(e.target.checked)}
                          className="accent-purple-500"
                        />
                        <span>права администратора</span>
                      </label>

                      <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editHideRead}
                          onChange={(e) => setEditHideRead(e.target.checked)}
                          className="accent-purple-500"
                        />
                        <span>скрывать время прочтения</span>
                      </label>

                      {editAvatarPreview && !removeUserAvatar && (
                        <button
                          type="button"
                          onClick={() => {
                            setRemoveUserAvatar(true);
                            setEditAvatarFile(null);
                          }}
                          className="text-xs text-red-300 hover:underline"
                        >
                          удалить аватарку
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingUser(null)}
                        className="px-3.5 py-1.5 rounded-xl bg-white/5 text-xs text-jess-textMuted hover:text-white"
                      >
                        отмена
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 rounded-xl cta-music-btn text-white text-xs font-semibold"
                      >
                        сохранить все данные
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {users.map((u) => (
                <div
                  key={u.id}
                  className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="relative w-10 h-10 shrink-0">
                      <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border border-white/15 flex items-center justify-center font-semibold text-xs text-jess-accent">
                        {u.avatar_url ? (
                          <AvatarMedia src={u.avatar_url} alt={u.display_name} />
                        ) : (
                          u.display_name.slice(0, 2)
                        )}
                      </div>
                      {u.is_online && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-jess-bg z-10" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-1">
                        <BadgeList badges={u.badges} size="sm" />
                        <span className="font-semibold text-sm text-white">{u.display_name}</span>
                        {u.is_verified && <VerifiedBadge size="sm" />}
                        <span className="text-xs text-jess-textMuted ml-1">@{u.username}</span>
                        {u.is_admin === 1 && (
                          <span className="px-2 py-0.5 rounded-lg bg-jess-accent/20 border border-jess-accent/40 text-[10px] text-jess-accentHover">
                            admin
                          </span>
                        )}
                      </div>
                      {u.bio && (
                        <div className="text-[11px] text-jess-textMuted truncate mt-0.5">{u.bio}</div>
                      )}

                      {/* Выдача бейджей */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {badges.map((b) => {
                          const assigned = u.badges.some((ub) => ub.id === b.id);
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => handleToggleUserBadge(u, b)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] border transition ${
                                assigned
                                  ? 'bg-jess-accent/25 border-jess-accent text-white'
                                  : 'bg-white/[0.03] border-white/10 text-jess-textMuted hover:text-white'
                              }`}
                            >
                              <AvatarMedia
                                src={b.image_url}
                                alt={b.name}
                                style={{ width: '14px', height: '14px', maxWidth: '14px', maxHeight: '14px', objectFit: 'contain' }}
                              />
                              <span>{b.name}</span>
                              {assigned && <Check className="w-3 h-3 text-emerald-400" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleVerifyUser(u)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition ${
                        u.is_verified
                          ? 'bg-sky-500/20 border-sky-400/50 text-sky-300'
                          : 'bg-white/[0.05] border-white/10 text-jess-textMuted hover:text-white'
                      }`}
                    >
                      <BadgeCheck className="w-3.5 h-3.5" />
                      <span>{u.is_verified ? 'галочка выдана ✓' : 'выдать галочку'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenSecurityModal(u)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/30 text-xs text-amber-200 border border-amber-500/30 transition"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>IP и пароли</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleStartFullEdit(u)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-jess-accent text-xs text-white border border-white/10 transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>изменить</span>
                    </button>

                    {u.id !== currentUser.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/40 text-xs text-red-300 border border-red-500/30 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>удалить</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'rooms' && (
            <div className="space-y-3">
              {rooms.length === 0 ? (
                <div className="py-8 text-center text-xs text-jess-textMuted">групп пока нет</div>
              ) : (
                rooms.map((r) => (
                  <div
                    key={r.id}
                    className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-jess-surface border border-white/15 flex items-center justify-center text-xs font-bold text-jess-accent shrink-0">
                        {r.avatar_url ? (
                          <AvatarMedia src={r.avatar_url} alt={r.name} />
                        ) : (
                          r.name.slice(0, 2)
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-semibold text-white truncate">{r.name}</span>
                          {r.is_verified && <VerifiedBadge size="sm" />}
                        </div>
                        <div className="text-xs text-jess-textMuted">
                          @{r.slug || 'group'} • участников: {r.member_count}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleVerifyRoom(r)}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs border transition shrink-0 ${
                        r.is_verified
                          ? 'bg-sky-500/20 border-sky-400/50 text-sky-300'
                          : 'bg-white/[0.05] border-white/10 text-jess-textMuted hover:text-white'
                      }`}
                    >
                      <BadgeCheck className="w-4 h-4" />
                      <span>{r.is_verified ? 'верифицирована ✓' : 'выдать синюю галочку'}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'badges' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form
                onSubmit={handleCreateBadge}
                className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4"
              >
                <h3 className="text-xs font-semibold text-white flex items-center gap-2">
                  <PlusCircle className="w-4 h-4 text-jess-accent" />
                  <span>новый бейдж (поддерживаются gif, webp, mp4, png)</span>
                </h3>

                <div>
                  <label className="block text-xs text-jess-textMuted mb-1">название</label>
                  <input
                    type="text"
                    required
                    placeholder="название бейджа"
                    value={badgeName}
                    onChange={(e) => setBadgeName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none neon-border-focus"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-jess-textMuted mb-1">цвет свечения</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={badgeBorderColor}
                        onChange={(e) => {
                          setBadgeBorderColor(e.target.value);
                          setBadgeGlowColor(`${e.target.value}88`);
                        }}
                        className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border-0"
                      />
                      <span className="text-xs font-mono text-jess-textMuted">{badgeBorderColor}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-jess-textMuted mb-1">иконка / анимация</label>
                    <input
                      type="file"
                      accept="image/*,video/mp4,video/webm,.gif,.webp,.apng"
                      required
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setBadgeCropFile(file);
                        }
                      }}
                      className="text-xs text-jess-textMuted file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:bg-jess-accent file:text-white cursor-pointer"
                    />
                  </div>
                </div>

                {badgePreviewUrl && (
                  <div className="p-3 rounded-xl bg-black/30 border border-white/10 flex items-center gap-1.5">
                    <span className="text-xs text-jess-textMuted mr-1">превью (слева от ника):</span>
                    <BadgeList
                      badges={[
                        {
                          id: 'preview',
                          name: badgeName || 'бейдж',
                          image_url: badgePreviewUrl,
                          border_color: badgeBorderColor,
                          glow_color: badgeGlowColor,
                          created_at: ''
                        }
                      ]}
                      size="md"
                    />
                    <span className="text-xs font-semibold text-white">admin</span>
                    <VerifiedBadge size="sm" />
                    {badgeIconFile && (
                      <button
                        type="button"
                        onClick={() => setBadgeCropFile(badgeIconFile)}
                        className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-jess-accent text-[11px] text-white transition"
                      >
                        <Crop className="w-3 h-3" />
                        <span>обрезать 1:1</span>
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-2xl cta-music-btn text-white text-xs font-semibold transition"
                >
                  создать бейдж
                </button>
              </form>

              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-white">активные бейджи ({badges.length})</h3>
                {badges.map((b) => (
                  <div
                    key={b.id}
                    className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center p-1.5 overflow-hidden shrink-0"
                        style={{
                          border: `1px solid ${b.border_color}`,
                          boxShadow: `0 0 12px ${b.glow_color}`,
                          backgroundColor: '#0d0d12'
                        }}
                      >
                        <AvatarMedia
                          src={b.image_url}
                          alt={b.name}
                          style={{ width: '22px', height: '22px', maxWidth: '22px', maxHeight: '22px', objectFit: 'contain' }}
                        />
                      </div>
                      <div className="text-xs font-semibold text-white">{b.name}</div>
                    </div>

                    {b.id !== 'badge-founder-root' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteBadge(b.id)}
                        className="p-2 rounded-xl bg-red-500/15 hover:bg-red-500/30 text-red-300 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {badgeCropFile && (
        <SquareCropModal
          file={badgeCropFile}
          onCancel={() => setBadgeCropFile(null)}
          onConfirm={({ file, previewUrl, cropParams }) => {
            setBadgeIconFile(file);
            setBadgePreviewUrl(previewUrl);
            setBadgeCropParams(cropParams);
            setBadgeCropFile(null);
          }}
        />
      )}

      {securityModalUser && (
        <div
          onClick={() => setSecurityModalUser(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-menu-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-panel border border-white/15 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-300" />
                  <span>логи безопасности: @{securityModalUser.username}</span>
                </h3>
                <p className="text-[11px] text-jess-textMuted">
                  текущий и старые пароли, история IP-адресов
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSecurityModalUser(null)}
                className="p-2 rounded-xl hover:bg-white/10 text-jess-textMuted hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {securityLoading ? (
                <div className="py-10 text-center text-xs text-jess-textMuted">загрузка данных...</div>
              ) : (
                <>
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-jess-accentHover" />
                      <span>пароли ({securityPasswords.length})</span>
                    </h4>
                    {securityPasswords.length === 0 ? (
                      <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-jess-textMuted">
                        история паролей пока пуста (запишется при следующем входе или смене пароля)
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {securityPasswords.map((p) => (
                          <div
                            key={p.id}
                            className={`px-3.5 py-2.5 rounded-2xl border flex items-center justify-between gap-3 text-xs ${
                              p.is_current
                                ? 'bg-emerald-500/10 border-emerald-500/35'
                                : 'bg-white/[0.03] border-white/10'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold shrink-0 ${
                                  p.is_current
                                    ? 'bg-emerald-500/25 text-emerald-300'
                                    : 'bg-white/10 text-jess-textMuted'
                                }`}
                              >
                                {p.is_current ? 'действующий' : 'старый'}
                              </span>
                              <span className="font-mono text-white preserve-case select-text truncate">
                                {p.password_plain}
                              </span>
                            </div>
                            <div className="text-[10px] text-jess-textMuted shrink-0">
                              {p.changed_by} • {new Date(p.created_at.endsWith('Z') ? p.created_at : p.created_at.replace(' ', 'T') + 'Z').toLocaleString('ru-RU')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-sky-400" />
                      <span>IP-логи ({securityIpLogs.length})</span>
                    </h4>
                    {securityIpLogs.length === 0 ? (
                      <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-jess-textMuted">
                        IP-логов пока нет
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {securityIpLogs.map((log) => (
                          <div
                            key={log.id}
                            className="px-3.5 py-2 rounded-2xl bg-white/[0.03] border border-white/10 text-xs flex flex-col gap-0.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-sky-300 select-text">
                                {log.ip_address}
                              </span>
                              <span className="text-[10px] text-jess-textMuted">
                                {log.action} • {new Date(log.created_at.endsWith('Z') ? log.created_at : log.created_at.replace(' ', 'T') + 'Z').toLocaleString('ru-RU')}
                              </span>
                            </div>
                            {log.user_agent && (
                              <div className="text-[10px] text-jess-textMuted truncate preserve-case">
                                {log.user_agent}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};