import React, { useRef, useState } from 'react';
import {
  X,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Music,
  Play,
  Square,
  Upload,
  KeyRound,
  Trash2,
  Eye,
  EyeOff,
  Shield,
  Headphones
} from 'lucide-react';
import { UserProfile } from '../types';
import { apiRequest, uploadFileInChunks, showTopToast, copyTextWithToast } from '../services/api';
import { AvatarMedia, BadgeList, ProfileMusicPlayer, VerifiedBadge } from './BadgeList';

interface ProfileSettingsModalProps {
  user: UserProfile;
  onClose: () => void;
  onUpdated: (updated: UserProfile) => void;
  onAccountDeleted: () => void;
}

export const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  user,
  onClose,
  onUpdated,
  onAccountDeleted
}) => {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio || '');
  const [hideReadTime, setHideReadTime] = useState(Boolean(user.hide_read_time));
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar_url);

  // Музыка в профиле
  const [musicTitle, setMusicTitle] = useState(user.music_title || '');
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const musicFileInputRef = useRef<HTMLInputElement | null>(null);

  // Рингтон и список загруженных рингтонов
  const [ringtoneUrl, setRingtoneUrl] = useState(user.ringtone_url || '/sounds/def.wav');
  const [loadingRingtone, setLoadingRingtone] = useState(false);
  const [playingPreviewUrl, setPlayingPreviewUrl] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneFileInputRef = useRef<HTMLInputElement | null>(null);

  // Смена пароля
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const notifyStatus = (text: string, error = false) => {
    setMessage(text);
    setIsError(error);
    showTopToast(text, error ? 'error' : 'success');
  };

  const stopPreviewAudio = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }
    setPlayingPreviewUrl(null);
  };

  const togglePlayRingtonePreview = (urlToPlay?: string) => {
    const targetUrl = urlToPlay || ringtoneUrl || '/sounds/def.wav';
    if (playingPreviewUrl === targetUrl) {
      stopPreviewAudio();
      return;
    }
    stopPreviewAudio();
    const audio = new Audio(targetUrl);
    previewAudioRef.current = audio;
    setPlayingPreviewUrl(targetUrl);
    audio.onended = () => setPlayingPreviewUrl(null);
    audio.onerror = () => {
      setPlayingPreviewUrl(null);
      notifyStatus('не удалось воспроизвести этот рингтон', true);
    };
    audio.play().catch(() => setPlayingPreviewUrl(null));
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
      showTopToast('аватарка выбрана — нажмите «сохранить профиль»', 'info');
    }
  };

  const handleCopyProfileLink = () => {
    const clean = username.replace(/^@/, '').trim() || user.username;
    copyTextWithToast(`https://mered.ro/@${clean}`, `ссылка mered.ro/@${clean} скопирована!`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSelectRingtoneUrl = async (targetUrl: string, labelName?: string) => {
    stopPreviewAudio();
    setRingtoneUrl(targetUrl);
    try {
      const res = await apiRequest<{ user: UserProfile; ringtone_url: string }>('/auth/ringtone/url', {
        method: 'POST',
        body: JSON.stringify({ url: targetUrl })
      });
      onUpdated(res.user);
      notifyStatus(
        targetUrl === '/sounds/def.wav'
          ? 'выбран стандартный рингтон (def.wav)'
          : `выбран рингтон «${labelName || 'загруженный'}»`
      );
    } catch (err: any) {
      notifyStatus(err.message, true);
    }
  };

  const handleUploadRingtoneFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopPreviewAudio();
    setLoadingRingtone(true);
    setMessage(null);
    setIsError(false);

    try {
      const uploaded = await uploadFileInChunks(file, 'ringtones');
      const res = await apiRequest<{ user: UserProfile; ringtone_url: string; message: string }>(
        '/auth/ringtone/upload',
        {
          method: 'POST',
          body: JSON.stringify({
            chunkedFileUrl: uploaded.fileUrl,
            originalName: file.name
          })
        }
      );
      setRingtoneUrl(res.ringtone_url);
      onUpdated(res.user);
      notifyStatus(res.message || 'рингтон загружен и выбран!');
    } catch (err: any) {
      notifyStatus(err.message || 'ошибка загрузки рингтона', true);
    } finally {
      setLoadingRingtone(false);
      if (ringtoneFileInputRef.current) ringtoneFileInputRef.current.value = '';
    }
  };

  const handleDeleteUploadedRingtone = async (ringtoneId: string) => {
    stopPreviewAudio();
    try {
      const res = await apiRequest<{ user: UserProfile; message: string }>(`/auth/ringtone/${ringtoneId}`, {
        method: 'DELETE'
      });
      setRingtoneUrl(res.user.ringtone_url || '/sounds/def.wav');
      onUpdated(res.user);
      notifyStatus('рингтон удален из списка');
    } catch (err: any) {
      notifyStatus(err.message || 'ошибка удаления рингтона', true);
    }
  };

  const handleUploadProfileMusic = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMusic(true);
    setMessage(null);
    setIsError(false);

    try {
      const uploaded = await uploadFileInChunks(file, 'music');
      const autoTitle = musicTitle.trim() || file.name.replace(/\.[^/.]+$/, '');
      const res = await apiRequest<{ user: UserProfile; message: string }>('/auth/profile/music', {
        method: 'POST',
        body: JSON.stringify({
          musicUrl: uploaded.fileUrl,
          musicTitle: autoTitle
        })
      });
      setMusicTitle(res.user.music_title || autoTitle);
      onUpdated(res.user);
      notifyStatus('музыка добавлена в ваш профиль!');
    } catch (err: any) {
      notifyStatus(err.message || 'не удалось загрузить музыку в профиль', true);
    } finally {
      setUploadingMusic(false);
      if (musicFileInputRef.current) musicFileInputRef.current.value = '';
    }
  };

  const handleRemoveProfileMusic = async () => {
    try {
      const res = await apiRequest<{ user: UserProfile }>('/auth/profile/music', {
        method: 'POST',
        body: JSON.stringify({ removeMusic: true })
      });
      setMusicTitle('');
      onUpdated(res.user);
      notifyStatus('музыка удалена из профиля');
    } catch (err: any) {
      notifyStatus(err.message, true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setIsError(false);

    try {
      let uploadedAvatarUrl: string | undefined;
      if (avatarFile) {
        const up = await uploadFileInChunks(avatarFile, 'avatars');
        uploadedAvatarUrl = up.fileUrl;
      }

      const payload: any = {
        display_name: displayName.trim(),
        username: username.replace(/^@/, '').trim(),
        bio
      };
      if (user.is_admin === 1) {
        payload.hide_read_time = String(hideReadTime);
      }
      if (uploadedAvatarUrl) {
        payload.avatarUrl = uploadedAvatarUrl;
      }

      const res = await apiRequest<{ user: UserProfile; message: string }>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      if (musicTitle.trim() && res.user.music_url && musicTitle.trim() !== res.user.music_title) {
        const mRes = await apiRequest<{ user: UserProfile }>('/auth/profile/music', {
          method: 'POST',
          body: JSON.stringify({
            musicUrl: res.user.music_url,
            musicTitle: musicTitle.trim()
          })
        });
        onUpdated(mRes.user);
      } else {
        onUpdated(res.user);
      }

      setUsername(res.user.username);
      setDisplayName(res.user.display_name);
      setAvatarFile(null);
      notifyStatus('профиль успешно сохранен!');
    } catch (err: any) {
      notifyStatus(err.message || 'ошибка сохранения профиля', true);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 4) {
      notifyStatus('новый пароль должен быть не короче 4 символов', true);
      return;
    }
    setChangingPassword(true);
    try {
      const res = await apiRequest<{ message: string }>('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword('');
      setNewPassword('');
      notifyStatus(res.message || 'пароль успешно обновлен!');
    } catch (err: any) {
      notifyStatus(err.message || 'ошибка смены пароля', true);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteOwnAccount = async () => {
    if (!window.confirm('вы уверены, что хотите навсегда удалить свой аккаунт?')) return;
    try {
      await apiRequest('/auth/account', { method: 'DELETE' });
      stopPreviewAudio();
      onAccountDeleted();
    } catch (err: any) {
      notifyStatus(err.message || 'не удалось удалить аккаунт', true);
    }
  };

  const cleanUser = username.replace(/^@/, '').trim() || user.username;
  const uploadedRingtones = user.ringtones || [];
  const activeCustomRingtone = uploadedRingtones.find((r) => r.url === ringtoneUrl);
  const isDefaultRingtone = !ringtoneUrl || ringtoneUrl === '/sounds/def.wav';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-menu-in">
      <div className="glass-panel border border-white/10 rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">настройки профиля</h2>
          <button
            onClick={() => {
              stopPreviewAudio();
              onClose();
            }}
            className="p-1.5 rounded-xl hover:bg-white/10 text-jess-textMuted hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Статусная плашка СВЕРХУ окна, чтобы сразу было видно сохранение */}
        {message && (
          <div
            className={`mx-6 mt-3 px-4 py-2.5 rounded-2xl border text-xs flex items-center justify-between animate-menu-in ${
              isError
                ? 'bg-red-950/60 border-red-500/40 text-red-200'
                : 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
            }`}
          >
            <span>{message}</span>
            <button type="button" onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Карточка аватара (без лишней надписи про форматы) */}
          <div className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10">
            <label className="relative w-16 h-16 rounded-full overflow-hidden bg-jess-surface border border-jess-accent/50 cursor-pointer group shrink-0 soft-glow">
              {avatarPreview ? (
                <AvatarMedia src={avatarPreview} alt={displayName} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lg font-bold text-jess-accent">
                  {displayName.slice(0, 2)}
                </div>
              )}
              <div className="absolute inset-0 bg-black/55 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <input
                type="file"
                accept="image/*,video/mp4,video/webm"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </label>

            <div className="min-w-0 flex-1">
              <div className="flex items-center flex-wrap gap-1">
                <BadgeList badges={user.badges} size="md" />
                <span className="font-semibold text-sm text-white truncate">{displayName}</span>
                {user.is_verified && <VerifiedBadge size="sm" />}
              </div>
              <div className="text-xs text-jess-textMuted mt-0.5">@{cleanUser}</div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleCopyProfileLink}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] text-jess-accent transition"
                >
                  {copiedLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedLink ? 'скопировано!' : `mered.ro/@${cleanUser}`}</span>
                </button>
                <a
                  href={`/@${cleanUser}`}
                  onClick={(e) => {
                    e.preventDefault();
                    stopPreviewAudio();
                    onClose();
                    window.history.pushState({}, '', `/@${cleanUser}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  title="открыть мою публичную карточку"
                  className="p-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-jess-textMuted hover:text-white transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-jess-textMuted mb-1">имя</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-2xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none neon-border-focus"
              />
            </div>

            <div>
              <label className="block text-xs text-jess-textMuted mb-1">юзернейм</label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-sm text-jess-textMuted select-none">@</span>
                <input
                  type="text"
                  required
                  maxLength={51}
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
                  placeholder="username"
                  className="w-full pl-8 pr-3.5 py-2 rounded-2xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none neon-border-focus"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-jess-textMuted mb-1">о себе</label>
            <textarea
              rows={2}
              placeholder="напишите пару слов о себе..."
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full px-3.5 py-2 rounded-2xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none neon-border-focus resize-none"
            />
          </div>

          {/* Музыка в профиле (meredro - kasual) */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Headphones className="w-4 h-4 text-jess-accent" />
                <span className="text-xs font-semibold text-white">музыка в профиле</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={musicFileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
                  onChange={handleUploadProfileMusic}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingMusic}
                  onClick={() => musicFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl cta-music-btn text-xs text-white font-medium"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploadingMusic ? 'загрузка...' : 'загрузить трек'}</span>
                </button>
                {user.music_url && (
                  <button
                    type="button"
                    onClick={handleRemoveProfileMusic}
                    className="p-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition"
                    title="удалить трек из профиля"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <input
              type="text"
              placeholder="название трека в профиле (например: meredro - kasual)"
              value={musicTitle}
              onChange={(e) => setMusicTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus"
            />

            {user.music_url && (
              <ProfileMusicPlayer
                musicUrl={user.music_url}
                musicTitle={musicTitle || user.music_title}
              />
            )}
          </div>

          {/* Скрытие статуса прочтения для администратора */}
          {user.is_admin === 1 && (
            <label className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] border border-jess-accent/35 cursor-pointer">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-jess-accent shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-white">скрывать моё прочтение</div>
                  <div className="text-[11px] text-jess-textMuted">
                    другие не увидят, когда вы прочитали сообщения
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={hideReadTime}
                onChange={(e) => setHideReadTime(e.target.checked)}
                className="w-4 h-4 accent-purple-500 cursor-pointer"
              />
            </label>
          )}

          {/* Настройка рингтона со списком всех загруженных пользователем рингтонов и индикацией выбранного */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-jess-accent" />
                <span className="text-xs font-semibold text-white">рингтон звонка</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={ringtoneFileInputRef}
                  type="file"
                  accept="audio/*,video/*,.mp3,.wav,.ogg,.m4a"
                  onChange={handleUploadRingtoneFile}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={loadingRingtone}
                  onClick={() => ringtoneFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl cta-music-btn text-xs text-white font-medium"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{loadingRingtone ? 'загрузка...' : 'загрузить рингтон'}</span>
                </button>
              </div>
            </div>

            <div className="text-[11px] text-jess-textMuted">
              сейчас выбран:{' '}
              <span className="text-white font-semibold">
                {isDefaultRingtone
                  ? 'стандартный (def.wav)'
                  : activeCustomRingtone
                  ? activeCustomRingtone.name
                  : ringtoneUrl.split('/').pop()}
              </span>
            </div>

            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {/* Стандартный рингтон def.wav */}
              <div
                className={`flex items-center justify-between p-2.5 rounded-xl border transition ${
                  isDefaultRingtone
                    ? 'bg-white/[0.08] border-jess-accent soft-glow'
                    : 'bg-black/30 border-white/10 hover:border-white/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectRingtoneUrl('/sounds/def.wav', 'def.wav')}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  <span
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                      isDefaultRingtone ? 'border-jess-accent bg-jess-accent text-white' : 'border-white/25'
                    }`}
                  >
                    {isDefaultRingtone && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className="text-xs font-medium text-white truncate">стандартный рингтон (def.wav)</span>
                </button>

                <button
                  type="button"
                  onClick={() => togglePlayRingtonePreview('/sounds/def.wav')}
                  className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-jess-accent text-white transition shrink-0"
                  title="прослушать"
                >
                  {playingPreviewUrl === '/sounds/def.wav' ? (
                    <Square className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {/* Список загруженных рингтонов пользователя */}
              {uploadedRingtones.map((r) => {
                const isSelected = ringtoneUrl === r.url;
                return (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition ${
                      isSelected
                        ? 'bg-white/[0.08] border-jess-accent soft-glow'
                        : 'bg-black/30 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectRingtoneUrl(r.url, r.name)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      <span
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                          isSelected ? 'border-jess-accent bg-jess-accent text-white' : 'border-white/25'
                        }`}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="text-xs font-medium text-white truncate">{r.name}</span>
                      {isSelected && (
                        <span className="px-2 py-0.5 rounded-full bg-jess-accent/25 text-[10px] text-white shrink-0">
                          выбран
                        </span>
                      )}
                    </button>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => togglePlayRingtonePreview(r.url)}
                        className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-jess-accent text-white transition"
                        title="прослушать"
                      >
                        {playingPreviewUrl === r.url ? (
                          <Square className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUploadedRingtone(r.id)}
                        className="p-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300 transition"
                        title="удалить рингтон"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Смена пароля */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-jess-accent" />
              <span className="text-xs font-semibold text-white">смена пароля</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="relative flex items-center">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Текущий пароль"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus"
                />
              </div>

              <div className="relative flex items-center">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Новый пароль"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 text-jess-textMuted hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <button
              type="button"
              disabled={changingPassword || !newPassword}
              onClick={handleChangePassword}
              className="px-4 py-1.5 rounded-xl bg-white/[0.07] hover:bg-jess-accent text-white text-xs font-medium transition disabled:opacity-40"
            >
              {changingPassword ? 'обновление...' : 'обновить пароль'}
            </button>
          </div>

          <div className="pt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={handleDeleteOwnAccount}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-red-500/15 hover:bg-red-500/30 border border-red-500/30 text-xs text-red-300 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>удалить мой аккаунт</span>
            </button>
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => {
                stopPreviewAudio();
                onClose();
              }}
              className="px-4 py-2 rounded-2xl border border-white/10 text-xs text-jess-textMuted hover:text-white transition"
            >
              закрыть
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-2xl cta-music-btn text-white text-xs font-semibold transition"
            >
              {saving ? 'сохранение...' : 'сохранить профиль'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
