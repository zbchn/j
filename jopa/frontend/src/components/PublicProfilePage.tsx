import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, UserPlus, Check, Copy, Edit3, Bookmark, ArrowLeft } from 'lucide-react';
import { UserProfile } from '../types';
import { apiRequest, copyTextWithToast, showTopToast } from '../services/api';
import {
  AvatarMedia,
  BadgeList,
  InteractiveTitle,
  ProfileMusicPlayer,
  VerifiedBadge
} from './BadgeList';
import { formatLastSeen, renderTextWithIosEmojis } from './IosEmoji';

const BG_VIDEOS = [
  '/bg/bg1.mp4',
  '/bg/bg2.mp4',
  '/bg/bg3.mp4',
  '/bg/bg4.mp4',
  '/bg/bg5.mp4',
  '/bg/bg6.mp4'
];

interface PublicProfilePageProps {
  usernameParam: string;
  currentUser: UserProfile | null;
  contacts: UserProfile[];
  onStartChatWithUser: (targetUser: UserProfile) => void;
  onOpenSavedMessages?: () => void;
  onOpenRoomById?: (roomId: string) => void;
  onBackToApp?: () => void;
  onToggleContact: (targetUser: UserProfile) => void;
  onRenameContact?: (targetUser: UserProfile, customName: string) => void;
}

export const PublicProfilePage: React.FC<PublicProfilePageProps> = ({
  usernameParam,
  currentUser,
  contacts,
  onStartChatWithUser,
  onOpenSavedMessages,
  onOpenRoomById,
  onBackToApp,
  onToggleContact,
  onRenameContact
}) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [roomCard, setRoomCard] = useState<{
    id: string;
    name: string;
    slug: string;
    description: string;
    avatar_url: string | null;
    is_verified?: boolean;
    is_jward: boolean;
    member_count: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [editingCustomName, setEditingCustomName] = useState(false);
  const [customNameInput, setCustomNameInput] = useState('');

  // Последовательное воспроизведение фоновых видео с 0:00 (без ползунка яркости и без автосмены цветов)
  const [videoIdx, setVideoIdx] = useState(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    const activeVid = videoRefs.current[videoIdx];
    if (activeVid) {
      activeVid.currentTime = 0;
      activeVid.play().catch(() => {});
    }
    videoRefs.current.forEach((v, idx) => {
      if (v && idx !== videoIdx) {
        v.pause();
      }
    });
  }, [videoIdx]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setProfile(null);
    setRoomCard(null);
    const clean = usernameParam.replace(/^@/, '').trim();
    apiRequest<{ isRoom?: boolean; user?: UserProfile; room?: any }>(
      `/auth/public-profile/${encodeURIComponent(clean)}`
    )
      .then((res) => {
        if (res.isRoom && res.room) {
          setRoomCard(res.room);
        } else if (res.user) {
          setProfile(res.user);
          const contactMatch = contacts.find((c) => c.id === res.user!.id);
          setCustomNameInput(contactMatch?.custom_name || contactMatch?.display_name || res.user.display_name);
        } else {
          setError('профиль не найден');
        }
      })
      .catch((err: any) => {
        setError(err.message || 'профиль не найден');
      })
      .finally(() => setLoading(false));
  }, [usernameParam, contacts]);

  const handleCopyLink = (slugOrUsername: string) => {
    copyTextWithToast(`https://mered.ro/@${slugOrUsername}`, `ссылка mered.ro/@${slugOrUsername} скопирована!`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const contactEntry = profile ? contacts.find((c) => c.id === profile.id) : undefined;
  const isInContacts = Boolean(contactEntry);
  const displayedName = contactEntry?.display_name || profile?.display_name || '';
  const isSelf = Boolean(currentUser && profile && currentUser.id === profile.id);

  return (
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-[#0d0d12] p-4 relative overflow-hidden select-none">
      {/* Фоновое видео с последовательным воспроизведением с начала каждого ролика */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none select-none bg-black">
        {BG_VIDEOS.map((src, idx) => {
          const isActive = idx === videoIdx;
          return (
            <video
              key={src}
              ref={(el) => {
                videoRefs.current[idx] = el;
              }}
              src={src}
              muted
              playsInline
              preload="auto"
              onEnded={() => {
                if (isActive) {
                  setVideoIdx((prev) => (prev + 1) % BG_VIDEOS.length);
                }
              }}
              className={`absolute inset-0 w-full h-full object-cover scale-105 transition-opacity duration-700 ease-in-out ${
                isActive ? 'opacity-100' : 'opacity-0'
              }`}
              style={{
                filter: 'brightness(0.45) contrast(1.08) saturate(1.15)'
              }}
            />
          );
        })}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at center, rgba(13, 13, 18, 0.35) 0%, rgba(8, 6, 14, 0.85) 100%)',
            backdropFilter: 'blur(2px)'
          }}
        />
      </div>

      {onBackToApp && (
        <button
          type="button"
          onClick={onBackToApp}
          className="fixed top-4 left-4 z-20 flex items-center gap-1.5 px-3.5 py-2 rounded-2xl glass-panel border border-white/10 text-xs text-white hover:border-jess-accent/60 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-jess-accent" />
          <span>в мессенджер</span>
        </button>
      )}

      <div className="w-full max-w-sm glass-panel border border-white/15 rounded-3xl p-7 shadow-2xl relative z-10 animate-menu-in">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <img src="/logo.jpg" alt="logo" className="w-7 h-7 rounded-xl object-cover" />
            <InteractiveTitle text="jessenger" className="text-xs font-bold text-white" />
          </div>
          <a
            href="https://zoboch.in"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-jess-textMuted"
          >
            dev by <span className="zbchn-link">zbchn</span>
          </a>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-jess-textMuted">загрузка карточки...</div>
        ) : roomCard ? (
          /* Карточка для групп и основного канала @j (mered.ro/@j и mered.ro/@group) */
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="relative w-24 h-24">
              <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border-2 border-jess-accent/60 flex items-center justify-center text-2xl font-bold text-jess-accent soft-glow">
                {roomCard.avatar_url ? (
                  <AvatarMedia src={roomCard.avatar_url} alt={roomCard.name} />
                ) : (
                  roomCard.name.slice(0, 2)
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-center gap-1">
                <h1 className="text-lg font-bold text-white">{roomCard.name}</h1>
                {(roomCard.is_verified || roomCard.is_jward) && <VerifiedBadge size="md" />}
              </div>
              <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--accent-hover)' }}>
                @{roomCard.slug}
              </div>
              <div className="text-[11px] text-jess-textMuted mt-1">
                {roomCard.is_jward
                  ? 'официальный главный канал'
                  : roomCard.member_count !== null
                  ? `группа • участников: ${roomCard.member_count}`
                  : 'группа'}
              </div>
            </div>

            {roomCard.description && (
              <div className="w-full p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-jess-textMain text-left">
                <div className="text-[10px] text-jess-textMuted mb-1">описание</div>
                <p className="whitespace-pre-wrap leading-relaxed">
                  {renderTextWithIosEmojis(roomCard.description)}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => handleCopyLink(roomCard.slug)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 text-xs text-jess-textMuted hover:text-white transition"
            >
              <span className="font-mono">{copied ? 'ссылка скопирована!' : `mered.ro/@${roomCard.slug}`}</span>
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-jess-accent" />}
            </button>

            {onOpenRoomById && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (currentUser) {
                      await apiRequest(`/chat/rooms/${roomCard.id}/join`, { method: 'POST' });
                    }
                  } catch {
                    // ignore
                  }
                  onOpenRoomById(roomCard.id);
                }}
                className="w-full py-3 rounded-2xl cta-music-btn text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
              >
                <MessageCircle className="w-4 h-4" />
                <span>{roomCard.is_jward ? 'открыть канал jward' : 'вступить и открыть группу'}</span>
              </button>
            )}
          </div>
        ) : error || !profile ? (
          <div className="py-10 text-center space-y-4">
            <div className="text-sm font-semibold text-white">карточка @{usernameParam} не найдена</div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="relative w-24 h-24 shrink-0">
              <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border-2 border-jess-accent/60 flex items-center justify-center text-2xl font-bold text-jess-accent soft-glow">
                {profile.avatar_url ? (
                  <AvatarMedia src={profile.avatar_url} alt={displayedName} />
                ) : (
                  displayedName.slice(0, 2)
                )}
              </div>
              {profile.is_online && (
                <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-emerald-400 border-2 border-jess-bg shadow-[0_0_10px_#34d399] z-10" />
              )}
            </div>

            <div className="w-full">
              {editingCustomName && onRenameContact ? (
                <div className="flex items-center justify-center gap-2 mb-1">
                  <input
                    type="text"
                    value={customNameInput}
                    onChange={(e) => setCustomNameInput(e.target.value)}
                    placeholder="имя контакта..."
                    className="px-3 py-1.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-jess-accent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onRenameContact(profile, customNameInput);
                      setEditingCustomName(false);
                      showTopToast('имя контакта сохранено!', 'success');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-jess-accent text-white text-xs font-semibold"
                  >
                    ок
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center flex-wrap gap-1">
                  <BadgeList badges={profile.badges} size="md" />
                  <h1 className="text-lg font-bold text-white">
                    {renderTextWithIosEmojis(displayedName)}
                  </h1>
                  {profile.is_verified && <VerifiedBadge size="md" />}
                  {currentUser && currentUser.id !== profile.id && onRenameContact && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomNameInput(displayedName);
                        setEditingCustomName(true);
                      }}
                      title="изменить имя контакта"
                      className="p-1 rounded-lg hover:bg-white/10 text-jess-textMuted hover:text-white transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--accent-hover)' }}>
                @{profile.username}
              </div>
              <div className="text-[11px] text-jess-textMuted mt-1">
                {formatLastSeen(profile.is_online, profile.last_seen_at)}
              </div>
            </div>

            {profile.music_url && (
              <ProfileMusicPlayer
                musicUrl={profile.music_url}
                musicTitle={profile.music_title}
              />
            )}

            {profile.bio && (
              <div className="w-full p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-jess-textMain text-left">
                <div className="text-[10px] text-jess-textMuted mb-1">о себе</div>
                <p className="whitespace-pre-wrap leading-relaxed">
                  {renderTextWithIosEmojis(profile.bio)}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => handleCopyLink(profile.username)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 text-xs text-jess-textMuted hover:text-white transition"
            >
              <span className="font-mono">{copied ? 'ссылка скопирована!' : `mered.ro/@${profile.username}`}</span>
              {copied ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4 text-jess-accent" />
              )}
            </button>

            <div className="w-full flex flex-col gap-2 pt-2">
              {isSelf && onOpenSavedMessages ? (
                <button
                  type="button"
                  onClick={onOpenSavedMessages}
                  className="w-full py-3 rounded-2xl cta-music-btn text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
                >
                  <Bookmark className="w-4 h-4" />
                  <span>открыть избранное</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartChatWithUser(profile)}
                  className="w-full py-3 rounded-2xl cta-music-btn text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>написать сообщение</span>
                </button>
              )}

              {currentUser && currentUser.id !== profile.id && (
                <button
                  type="button"
                  onClick={() => onToggleContact(profile)}
                  className="w-full py-2.5 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs text-white flex items-center justify-center gap-2 transition"
                >
                  {isInContacts ? <Check className="w-4 h-4 text-emerald-400" /> : <UserPlus className="w-4 h-4" />}
                  <span>{isInContacts ? 'в контактах' : 'добавить в контакты'}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
