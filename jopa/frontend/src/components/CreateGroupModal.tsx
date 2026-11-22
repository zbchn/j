import React, { useState } from 'react';
import { X, Search, Camera, Check, Users } from 'lucide-react';
import { UserProfile } from '../types';
import { apiRequest, showTopToast, uploadFileInChunks } from '../services/api';
import { AvatarMedia, BadgeList, VerifiedBadge } from './BadgeList';

interface CreateGroupModalProps {
  currentUser: UserProfile;
  contacts: UserProfile[];
  onClose: () => void;
  onCreated: (roomId: string) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  currentUser,
  contacts,
  onClose,
  onCreated
}) => {
  const [groupName, setGroupName] = useState('');
  const [groupSlug, setGroupSlug] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await apiRequest<{ users: UserProfile[] }>(
        `/chat/users/search?q=${encodeURIComponent(q.replace(/^@/, ''))}`
      );
      setSearchResults(res.users.filter((u) => u.id !== currentUser.id));
    } catch {
      setSearchResults([]);
    }
  };

  const toggleMember = (uid: string) => {
    setSelectedIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    setCreating(true);
    try {
      let uploadedAvatarUrl: string | undefined;
      if (avatarFile) {
        const up = await uploadFileInChunks(avatarFile, 'avatars');
        uploadedAvatarUrl = up.fileUrl;
      }

      const payload: any = {
        name: groupName.trim(),
        description: groupDescription.trim(),
        memberIds: selectedIds
      };
      if (groupSlug.trim()) {
        payload.slug = groupSlug.replace(/^@/, '').trim().toLowerCase();
      }
      if (uploadedAvatarUrl) {
        payload.avatarUrl = uploadedAvatarUrl;
      }

      const res = await apiRequest<{ roomId: string }>('/chat/rooms/group', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showTopToast('группа успешно создана!');
      onCreated(res.roomId);
    } catch (err: any) {
      alert(err.message || 'не удалось создать группу');
    } finally {
      setCreating(false);
    }
  };

  const displayPool = searchQuery.trim() ? searchResults : contacts;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-menu-in">
      <div className="glass-panel border border-white/10 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-jess-accent" />
            <h3 className="text-sm font-semibold text-white">новая группа</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-jess-textMuted hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="flex items-center gap-3.5">
            <label className="relative w-14 h-14 rounded-2xl overflow-hidden bg-jess-surface border border-white/15 flex items-center justify-center cursor-pointer group shrink-0">
              {avatarPreview ? (
                <AvatarMedia src={avatarPreview} alt="group" />
              ) : (
                <Camera className="w-5 h-5 text-jess-textMuted group-hover:text-white transition" />
              )}
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
                required
                placeholder="Название группы..."
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full px-4 py-2 rounded-2xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none neon-border-focus"
              />
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs text-jess-textMuted">mered.ro/@</span>
                <input
                  type="text"
                  placeholder="group_link (необязательно)"
                  value={groupSlug}
                  onChange={(e) => setGroupSlug(e.target.value.replace(/^@/, ''))}
                  className="w-full pl-24 pr-3 py-1.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-jess-textMuted mb-1">описание группы</label>
            <textarea
              rows={2}
              placeholder="О чем эта группа..."
              value={groupDescription}
              onChange={(e) => setGroupDescription(e.target.value)}
              className="w-full px-3.5 py-2 rounded-2xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus resize-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-jess-textMuted">участники</span>
              <span className="text-xs text-jess-accentHover">выбрано: {selectedIds.length}</span>
            </div>
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-jess-textMuted absolute left-3.5 top-2.5" />
              <input
                type="text"
                placeholder="Введите имя или @юзернейм для поиска..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-2xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus"
              />
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {displayPool.length === 0 ? (
                <div className="py-4 text-center text-xs text-jess-textMuted">
                  {searchQuery.trim()
                    ? 'никого не найдено'
                    : 'начните вводить имя или @юзернейм в поиске'}
                </div>
              ) : (
                displayPool.map((u) => {
                  const isSelected = selectedIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleMember(u.id)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-2xl border text-left transition ${
                        isSelected
                          ? 'bg-jess-accent/15 border-jess-accent/50'
                          : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-jess-surface border border-white/10 flex items-center justify-center text-xs font-semibold text-jess-accent shrink-0">
                          {u.avatar_url ? (
                            <AvatarMedia src={u.avatar_url} alt={u.display_name} />
                          ) : (
                            u.display_name.slice(0, 2)
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center">
                            <BadgeList badges={u.badges} size="sm" />
                            <span className="text-xs font-semibold text-white truncate">
                              {u.display_name}
                            </span>
                            {u.is_verified && <VerifiedBadge size="sm" />}
                          </div>
                          <div className="text-[11px] text-jess-textMuted truncate">@{u.username}</div>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center border transition ${
                          isSelected
                            ? 'bg-jess-accent border-jess-accent text-white'
                            : 'border-white/20 text-transparent'
                        }`}
                      >
                        <Check className="w-3 h-3" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-2xl border border-white/10 text-xs text-jess-textMuted hover:text-white transition"
            >
              отмена
            </button>
            <button
              type="submit"
              disabled={creating || !groupName.trim()}
              className="px-5 py-2 rounded-2xl cta-music-btn text-white text-xs font-semibold transition disabled:opacity-40"
            >
              {creating ? 'создание...' : 'создать группу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
