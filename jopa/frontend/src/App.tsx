import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Users,
  Palette,
  Settings,
  ShieldAlert,
  LogOut,
  Search,
  Hash,
  UserPlus,
  UserCheck,
  PhoneIncoming,
  PhoneOff,
  ExternalLink,
  Copy,
  Check,
  X,
  Eye,
  EyeOff,
  Pin,
  Trash2,
  Edit3,
  Bookmark,
  KeyRound,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import { ChatMessage, ChatRoom, CallParticipant, IncomingCallPayload, NoiseSuppressionMode, ThemeConfig, UserProfile } from './types';
import {
  apiRequest,
  getStoredToken,
  setStoredToken,
  playUiSound,
  requestNotificationPermissionIfNeeded,
  showDesktopNotification,
  formatAttachmentPreviewText,
  showTopToast,
  copyTextWithToast
} from './services/api';
import { connectSocket, disconnectSocket } from './services/socket';
import { ChatView } from './components/ChatView';
import {
  ThemeCustomizerModal,
  THEME_PRESETS,
  applyThemeToDOM
} from './components/ThemeCustomizerModal';
import { ProfileSettingsModal } from './components/ProfileSettingsModal';
import { AdminPanelModal } from './components/AdminPanelModal';
import { CreateGroupModal } from './components/CreateGroupModal';
import { PublicProfilePage } from './components/PublicProfilePage';
import { CallOverlay, RemoteAudioRenderer, playCallSound } from './components/CallOverlay';
import { DiscordCallBar } from './components/DiscordCallBar';
import { WebRtcCallEngine, RemoteMediaItem } from './services/webrtc.engine';
import {
  AvatarMedia,
  BadgeList,
  InteractiveTitle,
  ProfileMusicPlayer,
  VerifiedBadge
} from './components/BadgeList';
import { formatLastSeen, renderTextWithIosEmojis } from './components/IosEmoji';

const BG_VIDEOS = [
  '/bg/bg1.mp4',
  '/bg/bg2.mp4',
  '/bg/bg3.mp4',
  '/bg/bg4.mp4',
  '/bg/bg5.mp4',
  '/bg/bg6.mp4'
];

// Последовательное воспроизведение фоновых видео из back.zip с 0:00 до конца каждого ролика
const BackgroundVideoCarousel: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);

  const tryPlayActive = useCallback(() => {
    const el = activeVideoRef.current;
    if (!el) return;
    try {
      el.muted = true;
      el.defaultMuted = true;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    tryPlayActive();
    const onFirstTouch = () => tryPlayActive();
    window.addEventListener('touchstart', onFirstTouch, { once: true, passive: true });
    window.addEventListener('click', onFirstTouch, { once: true });
    return () => {
      window.removeEventListener('touchstart', onFirstTouch);
      window.removeEventListener('click', onFirstTouch);
    };
  }, [currentIndex, tryPlayActive]);

  const activeSrc = BG_VIDEOS[currentIndex];

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none select-none bg-black">
      <video
        key={activeSrc}
        ref={activeVideoRef}
        src={activeSrc}
        autoPlay
        muted
        playsInline
        preload="metadata"
        onCanPlay={tryPlayActive}
        onEnded={() => setCurrentIndex((prev) => (prev + 1) % BG_VIDEOS.length)}
        onError={() => setCurrentIndex((prev) => (prev + 1) % BG_VIDEOS.length)}
        className="absolute inset-0 w-full h-full object-cover scale-105 transition-opacity duration-700 ease-out opacity-100"
        style={{
          filter: 'brightness(0.42) contrast(1.08) saturate(1.15)'
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, rgba(13, 13, 18, 0.35) 0%, rgba(8, 6, 14, 0.84) 100%)',
          backdropFilter: 'blur(2px)'
        }}
      />
    </div>
  );
};

// Глобальный верхний интерактивный тост ("скопировано!", "сохранено!" и т.д.)
const GlobalTopToastBar: React.FC = () => {
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string; id: number }>).detail;
      if (detail?.text) {
        setToast(detail);
      }
    };
    window.addEventListener('jessenger:top-toast', handler);
    return () => window.removeEventListener('jessenger:top-toast', handler);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast((prev) => (prev?.id === toast.id ? null : prev));
    }, 2200);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none animate-top-toast max-w-[92vw]">
      <div className="px-4 py-2 rounded-2xl glass-panel border border-jess-accent/60 shadow-2xl flex items-center gap-2 text-xs font-semibold text-white neon-glow">
        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="truncate">{toast.text}</span>
      </div>
    </div>
  );
};

function parseDeepLinkPath(pathname: string): { slug: string | null; msgNumber: number | null } {
  const match = pathname.match(/^\/@([^/]+)(?:\/(\d+))?$/);
  if (!match) return { slug: null, msgNumber: null };
  return {
    slug: decodeURIComponent(match[1]),
    msgNumber: match[2] ? parseInt(match[2], 10) : null
  };
}

export const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const userRingtoneRef = useRef<string | undefined>(undefined);
  userRingtoneRef.current = user?.ringtone_url;

  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'change_password'>('login');

  // Роутинг ссылок mered.ro/@slug и mered.ro/@user/18
  const [deepLink, setDeepLink] = useState<{ slug: string | null; msgNumber: number | null }>(() =>
    parseDeepLinkPath(window.location.pathname)
  );
  const [highlightedMsgNumber, setHighlightedMsgNumber] = useState<number | null>(null);
  const [publicProfileSlug, setPublicProfileSlug] = useState<string | null>(null);

  // Поля формы входа / регистрации / смены пароля
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newAuthPassword, setNewAuthPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const roomsRef = useRef<ChatRoom[]>([]);
  roomsRef.current = rooms;
  const [contacts, setContacts] = useState<UserProfile[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  activeRoomIdRef.current = activeRoomId;

  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  // Постоянный звонок на уровне App (не сбрасывается при переключении чатов)
  const callEngineRef = useRef<WebRtcCallEngine | null>(null);
  const [activeCallRoomId, setActiveCallRoomId] = useState<string | null>(null);
  const [activeCallRoomName, setActiveCallRoomName] = useState<string>('');
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([]);
  const [callRemoteItems, setCallRemoteItems] = useState<RemoteMediaItem[]>([]);
  const [isCallMicMuted, setIsCallMicMuted] = useState(false);
  const [isCallDeafened, setIsCallDeafened] = useState(false);
  const [isCallWebcamOn, setIsCallWebcamOn] = useState(false);
  const [isCallScreenSharing, setIsCallScreenSharing] = useState(false);
  const [localCallWebcamStream, setLocalCallWebcamStream] = useState<MediaStream | null>(null);
  const [localCallScreenStream, setLocalCallScreenStream] = useState<MediaStream | null>(null);
  const [isCallFloatingWindow, setIsCallFloatingWindow] = useState(false);
  const [callPingMs, setCallPingMs] = useState<number | null>(null);

  const [noiseMode, setNoiseMode] = useState<NoiseSuppressionMode>(() => {
    return (localStorage.getItem('jess_noise_mode') as NoiseSuppressionMode) || 'medium';
  });
  const [micThreshold, setMicThreshold] = useState<number>(() => {
    return Number(localStorage.getItem('jess_mic_threshold') || '8');
  });
  const [selectedMicId, setSelectedMicId] = useState<string>(() => {
    return localStorage.getItem('jess_mic_device') || '';
  });
  const [selectedCamId, setSelectedCamId] = useState<string>(() => {
    return localStorage.getItem('jess_cam_device') || '';
  });

  const [sidebarTab, setSidebarTab] = useState<'chats' | 'contacts'>('chats');
  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const longPressRoomTimerRef = useRef<any>(null);

  // Всплывающее уведомление о новом сообщении внутри приложения (СВЕРХУ)
  const [toastNotification, setToastNotification] = useState<{
    roomId: string;
    senderName: string;
    text: string;
    avatarUrl?: string | null;
  } | null>(null);

  // Быстрый поиск по @юзу сверху слева
  const [topSearchOpen, setTopSearchOpen] = useState(false);
  const [topSearchQuery, setTopSearchQuery] = useState('');
  const [topSearchResults, setTopSearchResults] = useState<UserProfile[]>([]);
  const topSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Модальные окна
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [miniProfileUser, setMiniProfileUser] = useState<UserProfile | null>(null);
  const [editingMiniContactName, setEditingMiniContactName] = useState(false);
  const [miniContactCustomName, setMiniContactCustomName] = useState('');
  const [copiedMiniLink, setCopiedMiniLink] = useState(false);

  // Входящий звонок и рингтон + синхронизация между вкладками браузера
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
  const [autoJoinCallRoomId, setAutoJoinCallRoomId] = useState<string | null>(null);
  const ringtoneAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneTimerRef = useRef<any>(null);
  const callBroadcastRef = useRef<BroadcastChannel | null>(null);

  // ПКМ-меню для сайдбара
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{
    x: number;
    y: number;
    room?: ChatRoom;
    targetUser?: UserProfile;
  } | null>(null);

  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(THEME_PRESETS[0]);

  // На странице входа/регистрации всегда держим фирменную фиолетовую тему без автосмены цветов
  useEffect(() => {
    if (!user && !authLoading) {
      applyThemeToDOM(THEME_PRESETS[0]);
    }
  }, [user, authLoading]);

  // Глобальная клавиша Escape для закрытия модалок и меню в App
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sidebarContextMenu) {
          setSidebarContextMenu(null);
          return;
        }
        if (miniProfileUser) {
          setMiniProfileUser(null);
          return;
        }
        if (showCreateGroupModal) {
          setShowCreateGroupModal(false);
          return;
        }
        if (showThemeModal) {
          setShowThemeModal(false);
          return;
        }
        if (showProfileModal) {
          setShowProfileModal(false);
          return;
        }
        if (showAdminModal) {
          setShowAdminModal(false);
          return;
        }
        if (topSearchOpen) {
          setTopSearchOpen(false);
          return;
        }
        if (publicProfileSlug) {
          setPublicProfileSlug(null);
          window.history.pushState({}, '', '/');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    sidebarContextMenu,
    miniProfileUser,
    showCreateGroupModal,
    showThemeModal,
    showProfileModal,
    showAdminModal,
    topSearchOpen,
    publicProfileSlug
  ]);

  useEffect(() => {
    const onPopState = () => {
      setDeepLink(parseDeepLinkPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    const closeMenu = () => setSidebarContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('click', closeMenu);
    };
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    const parsed = parseDeepLinkPath(path);
    setDeepLink(parsed);
    if (!parsed.slug) {
      setPublicProfileSlug(null);
    }
  };

  // Стабильная функция выбора чата (БЕЗ зависимости от state socket, через socketRef — никакого цикла перерендеров!)
  const selectRoom = useCallback((roomId: string | null, syncUrl = true) => {
    setActiveRoomId(roomId);
    activeRoomIdRef.current = roomId;
    if (roomId) {
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, unread_count: 0 } : r))
      );
      socketRef.current?.emit('room:mark_read', { roomId });
      if (syncUrl) {
        const target = roomsRef.current.find((r) => r.id === roomId);
        if (target?.slug) {
          window.history.replaceState({}, '', `/@${target.slug}`);
        }
      }
    } else if (syncUrl) {
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const loadRooms = useCallback(async () => {
    try {
      const res = await apiRequest<{ rooms: ChatRoom[] }>('/chat/rooms');
      const currentOpenId = activeRoomIdRef.current;
      const normalized = res.rooms.map((r) =>
        currentOpenId && r.id === currentOpenId ? { ...r, unread_count: 0 } : r
      );
      setRooms(normalized);
      try {
        localStorage.setItem('jess_cache_rooms', JSON.stringify(normalized));
        const desktop = (window as any).jessengerDesktop;
        if (desktop?.saveOfflineData) desktop.saveOfflineData('rooms', normalized);
      } catch {}
      setActiveRoomId((prev) => {
        if (prev && normalized.some((r) => r.id === prev)) {
          return prev;
        }
        return null;
      });
    } catch (err) {
      console.error('ошибка загрузки чатов:', err);
      try {
        const desktop = (window as any).jessengerDesktop;
        const cached = desktop?.loadOfflineData
          ? await desktop.loadOfflineData('rooms')
          : JSON.parse(localStorage.getItem('jess_cache_rooms') || 'null');
        if (Array.isArray(cached) && cached.length > 0) {
          setRooms(cached);
        }
      } catch {}
    }
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      const res = await apiRequest<{ contacts: UserProfile[] }>('/chat/contacts');
      setContacts(res.contacts);
      try {
        localStorage.setItem('jess_cache_contacts', JSON.stringify(res.contacts));
        const desktop = (window as any).jessengerDesktop;
        if (desktop?.saveOfflineData) desktop.saveOfflineData('contacts', res.contacts);
      } catch {}
    } catch (err) {
      console.error('ошибка загрузки контактов:', err);
      try {
        const desktop = (window as any).jessengerDesktop;
        const cached = desktop?.loadOfflineData
          ? await desktop.loadOfflineData('contacts')
          : JSON.parse(localStorage.getItem('jess_cache_contacts') || 'null');
        if (Array.isArray(cached)) setContacts(cached);
      } catch {}
    }
  }, []);

  // Разрешение глубоких ссылок mered.ro/@j, mered.ro/@group, mered.ro/@group/123, mered.ro/@user/18
  useEffect(() => {
    if (!deepLink.slug) {
      setPublicProfileSlug(null);
      return;
    }

    if (!user) {
      setPublicProfileSlug(deepLink.slug);
      return;
    }

    const targetMsgNum = deepLink.msgNumber;

    apiRequest<{
      type: 'room' | 'user';
      isSaved?: boolean;
      roomId?: string;
      directRoomId?: string;
      user?: UserProfile;
    }>(`/chat/resolve/${encodeURIComponent(deepLink.slug)}`)
      .then(async (res) => {
        if (res.type === 'room' && res.roomId) {
          if (targetMsgNum) {
            setPublicProfileSlug(null);
            await loadRooms();
            selectRoom(res.roomId);
            setHighlightedMsgNumber(targetMsgNum);
            window.history.replaceState({}, '', '/');
            setDeepLink({ slug: null, msgNumber: null });
          } else {
            setPublicProfileSlug(deepLink.slug);
          }
        } else if (res.type === 'user' && res.user) {
          if (targetMsgNum) {
            const dmRoomId =
              res.directRoomId ||
              (
                await apiRequest<{ roomId: string }>('/chat/rooms/direct', {
                  method: 'POST',
                  body: JSON.stringify({ targetUserId: res.user.id })
                })
              ).roomId;
            setPublicProfileSlug(null);
            await loadRooms();
            selectRoom(dmRoomId);
            setHighlightedMsgNumber(targetMsgNum);
            window.history.replaceState({}, '', '/');
            setDeepLink({ slug: null, msgNumber: null });
          } else {
            setPublicProfileSlug(deepLink.slug);
          }
        }
      })
      .catch(() => {
        setPublicProfileSlug(deepLink.slug);
      });
  }, [deepLink.slug, deepLink.msgNumber, user?.id, loadRooms, selectRoom]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthLoading(false);
      return;
    }

    apiRequest<{ user: UserProfile }>('/auth/me')
      .then((res) => {
        setUser(res.user);
        try {
          localStorage.setItem('jess_cache_user', JSON.stringify(res.user));
          const desktop = (window as any).jessengerDesktop;
          if (desktop?.saveOfflineData) desktop.saveOfflineData('user', res.user);
        } catch {}
        requestNotificationPermissionIfNeeded();
        if (res.user.theme_config) {
          try {
            const parsed = JSON.parse(res.user.theme_config);
            setCurrentTheme(parsed);
            applyThemeToDOM(parsed);
          } catch {
            applyThemeToDOM(THEME_PRESETS[0]);
          }
        }
      })
      .catch(async (err) => {
        // Если офлайн или сетевая ошибка — загружаем локальный кэш вместо сброса токена!
        const isAuthFail = err?.message?.includes('401') || err?.message?.includes('недействительн') || err?.message?.includes('аккаунт не найден');
        if (!navigator.onLine || !isAuthFail) {
          try {
            const desktop = (window as any).jessengerDesktop;
            const cachedUser = desktop?.loadOfflineData
              ? await desktop.loadOfflineData('user')
              : JSON.parse(localStorage.getItem('jess_cache_user') || 'null');
            if (cachedUser) {
              setUser(cachedUser);
              setIsOffline(true);
              if (cachedUser.theme_config) {
                try {
                  const parsed = JSON.parse(cachedUser.theme_config);
                  setCurrentTheme(parsed);
                  applyThemeToDOM(parsed);
                } catch {}
              }
              return;
            }
          } catch {}
        }
        if (isAuthFail) {
          setStoredToken(null);
        }
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringtoneAudioRef.current) {
      ringtoneAudioRef.current.pause();
      ringtoneAudioRef.current.currentTime = 0;
      ringtoneAudioRef.current = null;
    }
    if (ringtoneTimerRef.current) {
      clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
  }, []);

  // BroadcastChannel для мгновенной остановки рингтона на всех открытых вкладках браузера
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const bc = new BroadcastChannel('jessenger_call_sync');
    callBroadcastRef.current = bc;
    bc.onmessage = (ev) => {
      if (ev.data?.type === 'dismiss_call') {
        stopRingtone();
        setIncomingCall((prev) =>
          !ev.data.roomId || prev?.roomId === ev.data.roomId ? null : prev
        );
      }
    };
    return () => {
      bc.close();
      callBroadcastRef.current = null;
    };
  }, [stopRingtone]);

  const broadcastDismissCall = useCallback((roomId?: string) => {
    try {
      callBroadcastRef.current?.postMessage({ type: 'dismiss_call', roomId });
    } catch {}
  }, []);

  const startRingtone = useCallback(
    (customRingtoneUrl?: string) => {
      stopRingtone();
      const targetSrc = customRingtoneUrl || userRingtoneRef.current || '/sounds/def.wav';
      try {
        const audio = new Audio(targetSrc);
        audio.loop = true;
        audio.volume = 0.85;
        ringtoneAudioRef.current = audio;
        audio.play().catch(() => {
          const playFallbackTone = () => {
            try {
              const ctx = new AudioContext();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(528, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.25);
              gain.gain.setValueAtTime(0.08, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start();
              osc.stop(ctx.currentTime + 0.65);
              setTimeout(() => ctx.close(), 700);
            } catch {}
          };
          playFallbackTone();
          ringtoneTimerRef.current = setInterval(playFallbackTone, 2200);
        });
      } catch {}
    },
    [stopRingtone]
  );

  // Инициализация сокета строго ОДИН раз при авторизации user.id
  useEffect(() => {
    if (!user?.id) return;

    const currentUserId = user.id;
    const s = connectSocket();
    socketRef.current = s;
    setSocket(s);

    loadRooms();
    loadContacts();

    s.on('room:created', () => loadRooms());
    s.on('room:updated', () => loadRooms());
    s.on('room:deleted', (payload: { roomId: string }) => {
      setActiveRoomId((prev) => (prev === payload.roomId ? null : prev));
      loadRooms();
    });
    s.on('room:member_joined', () => loadRooms());

    // Мгновенный сброс счетчика непрочитанных сообщений во всех вкладках
    s.on('room:unread_cleared', (payload: { roomId: string }) => {
      if (!payload?.roomId) return;
      setRooms((prev) =>
        prev.map((r) => (r.id === payload.roomId ? { ...r, unread_count: 0 } : r))
      );
    });

    s.on('message:new', (msg: ChatMessage) => {
      const isCurrentOpenRoom = activeRoomIdRef.current === msg.room_id;
      if (isCurrentOpenRoom) {
        s.emit('room:mark_read', { roomId: msg.room_id });
      }
      loadRooms();
      if (msg && msg.sender_id !== currentUserId) {
        playUiSound('notify', 0.75);
        if (!isCurrentOpenRoom || !document.hasFocus()) {
          const preview = formatAttachmentPreviewText(msg);
          const senderTitle =
            msg.room_id === 'global-lobby-room'
              ? 'jward'
              : msg.sender?.display_name || 'Новое сообщение';
          if (!isCurrentOpenRoom) {
            setToastNotification({
              roomId: msg.room_id,
              senderName: senderTitle,
              text: preview,
              avatarUrl: msg.sender?.avatar_url
            });
            setTimeout(() => {
              setToastNotification((prev) => (prev?.roomId === msg.room_id ? null : prev));
            }, 4500);
          }

          showDesktopNotification(senderTitle, preview, msg.sender?.avatar_url, () => {
            selectRoom(msg.room_id);
          });
        }
      }
    });

    s.on('message:updated', () => loadRooms());
    s.on('message:deleted', () => loadRooms());

    s.on('presence:update', () => {
      loadRooms();
      loadContacts();
    });

    s.on('user:updated', (updatedUser: UserProfile) => {
      if (updatedUser.id === currentUserId) {
        setUser(updatedUser);
      }
      setMiniProfileUser((prev) => (prev && prev.id === updatedUser.id ? updatedUser : prev));
      loadRooms();
      loadContacts();
    });

    s.on('user:deleted', (payload: { userId: string }) => {
      if (payload.userId === currentUserId) {
        handleLogout();
      } else {
        loadRooms();
        loadContacts();
      }
    });

    s.on('call:incoming', (payload: IncomingCallPayload) => {
      setIncomingCall(payload);
      startRingtone(userRingtoneRef.current);
      showDesktopNotification(
        `Входящий звонок • ${payload.caller.display_name}`,
        payload.isGroup ? `Группа: ${payload.roomName}` : 'Нажмите, чтобы ответить',
        payload.caller.avatar_url
      );
    });

    // Если звонок принят или отклонен на другой вкладке — мгновенно выключаем рингтон везде!
    s.on('call:dismiss_incoming', (payload: { roomId: string }) => {
      stopRingtone();
      setIncomingCall((prev) => {
        if (!payload?.roomId || (prev && prev.roomId === payload.roomId)) {
          return null;
        }
        return prev;
      });
    });

    s.on('call:ended', (payload: { roomId: string }) => {
      setIncomingCall((prev) => {
        if (prev && prev.roomId === payload.roomId) {
          stopRingtone();
          return null;
        }
        return prev;
      });
    });

    s.on('system:force_logout', (payload: { reason: string }) => {
      alert(payload.reason);
      handleLogout();
    });

    return () => {
      stopRingtone();
      socketRef.current = null;
      disconnectSocket();
    };
  }, [user?.id, loadRooms, loadContacts, startRingtone, stopRingtone, selectRoom]);


  // Отслеживание онлайн/офлайн и автосинхронизация при возвращении сети
  useEffect(() => {
    const onOnline = () => {
      setIsOffline(false);
      if (user?.id) {
        loadRooms();
        loadContacts();
      }
    };
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [user?.id, loadRooms, loadContacts]);

  const leaveActiveCall = useCallback(() => {
    if (callEngineRef.current) {
      playCallSound('close');
      callEngineRef.current.destroy();
      callEngineRef.current = null;
    }
    setActiveCallRoomId(null);
    setActiveCallRoomName('');
    setCallParticipants([]);
    setCallRemoteItems([]);
    setIsCallMicMuted(false);
    setIsCallDeafened(false);
    setIsCallWebcamOn(false);
    setIsCallScreenSharing(false);
    setLocalCallWebcamStream(null);
    setLocalCallScreenStream(null);
    setIsCallFloatingWindow(false);
    setCallPingMs(null);
  }, []);

  const startCallInRoom = useCallback((targetRoom: ChatRoom) => {
    if (!socketRef.current || !user) return;
    if (activeCallRoomId === targetRoom.id && callEngineRef.current) return;

    if (callEngineRef.current) {
      callEngineRef.current.destroy();
      callEngineRef.current = null;
    }

    setActiveCallRoomId(targetRoom.id);
    setActiveCallRoomName(targetRoom.name);
    setIsCallFloatingWindow(false);
    playCallSound('open');

    const engine = new WebRtcCallEngine(
      socketRef.current,
      targetRoom.id,
      (items) => setCallRemoteItems([...items]),
      (list) => {
        setCallParticipants([...list]);
        const me = list.find((p) => p.userId === user.id);
        if (me) setIsCallMicMuted(me.isMuted);
      }
    );
    callEngineRef.current = engine;
    engine.joinCall();
  }, [activeCallRoomId, user]);

  // Измерение пинга в активном звонке каждые 2 секунды
  useEffect(() => {
    if (!activeCallRoomId || !callEngineRef.current) {
      setCallPingMs(null);
      return;
    }
    const measure = async () => {
      if (callEngineRef.current) {
        const ms = await callEngineRef.current.getLatencyMs();
        setCallPingMs(ms);
      }
    };
    measure();
    const timer = setInterval(measure, 2500);
    return () => clearInterval(timer);
  }, [activeCallRoomId]);

  // Выход из звонка ТОЛЬКО при закрытии вкладки / сайта / приложения
  useEffect(() => {
    const onUnload = () => {
      if (callEngineRef.current) {
        callEngineRef.current.destroy();
        callEngineRef.current = null;
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const handleToggleCallMic = async () => {
    if (!callEngineRef.current) return;
    try {
      const next = await callEngineRef.current.setMicrophoneMuted(!isCallMicMuted);
      setIsCallMicMuted(next);
      playUiSound(next ? 'mic_off' : 'mic_on');
    } catch (err: any) {
      showTopToast(err.message || 'микрофон недоступен', 'error');
    }
  };

  const handleToggleCallDeafen = () => {
    const next = !isCallDeafened;
    setIsCallDeafened(next);
    callEngineRef.current?.setDeafened(next);
    playUiSound(next ? 'mic_off' : 'mic_on');
  };

  const handleToggleCallWebcam = async () => {
    if (!callEngineRef.current) return;
    if (isCallWebcamOn) {
      callEngineRef.current.stopWebcam();
      setLocalCallWebcamStream(null);
      setIsCallWebcamOn(false);
      playUiSound('cam_off');
    } else {
      try {
        const stream = await callEngineRef.current.startWebcam();
        setLocalCallWebcamStream(stream);
        setIsCallWebcamOn(true);
        playUiSound('cam_on');
      } catch {
        showTopToast('не удалось включить камеру', 'error');
      }
    }
  };

  const handleSwitchCallCamera = async () => {
    if (!callEngineRef.current) return;
    try {
      const stream = await callEngineRef.current.switchCameraFacingMode();
      if (stream) setLocalCallWebcamStream(stream);
    } catch {
      showTopToast('не удалось переключить камеру', 'error');
    }
  };

  const handleToggleCallScreenShare = async () => {
    if (!callEngineRef.current) return;
    if (isCallScreenSharing) {
      callEngineRef.current.stopScreenShare();
      setLocalCallScreenStream(null);
      setIsCallScreenSharing(false);
      playUiSound('screen_off');
    } else {
      try {
        const stream = await callEngineRef.current.startScreenShare(() => {
          setLocalCallScreenStream(null);
          setIsCallScreenSharing(false);
          playUiSound('screen_off');
        });
        setLocalCallScreenStream(stream);
        setIsCallScreenSharing(true);
        playUiSound('screen_on');
      } catch {
        // user cancelled
      }
    }
  };

  const handleChangeNoiseSettings = (mode: NoiseSuppressionMode, threshold: number) => {
    setNoiseMode(mode);
    setMicThreshold(threshold);
    localStorage.setItem('jess_noise_mode', mode);
    localStorage.setItem('jess_mic_threshold', String(threshold));
    callEngineRef.current?.setNoiseSettings(mode, threshold);
  };

  const handleSelectMicDevice = (deviceId: string) => {
    setSelectedMicId(deviceId);
    localStorage.setItem('jess_mic_device', deviceId);
    callEngineRef.current?.setAudioDevice(deviceId);
  };

  const handleSelectCamDevice = async (deviceId: string) => {
    setSelectedCamId(deviceId);
    localStorage.setItem('jess_cam_device', deviceId);
    const stream = await callEngineRef.current?.setVideoDevice(deviceId);
    if (stream) setLocalCallWebcamStream(stream);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    try {
      if (authMode === 'change_password') {
        const res = await apiRequest<{ token: string; user: UserProfile; message: string }>(
          '/auth/change-password-public',
          {
            method: 'POST',
            body: JSON.stringify({
              username: username.replace(/^@/, '').trim(),
              oldPassword: password,
              newPassword: newAuthPassword
            })
          }
        );
        setStoredToken(res.token);
        setActiveRoomId(null);
        setUser(res.user);
        showTopToast('пароль успешно обновлен!');
        requestNotificationPermissionIfNeeded();
        if (res.user.theme_config) {
          try {
            const parsed = JSON.parse(res.user.theme_config);
            setCurrentTheme(parsed);
            applyThemeToDOM(parsed);
          } catch {
            applyThemeToDOM(THEME_PRESETS[0]);
          }
        }
        return;
      }

      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
      const res = await apiRequest<{ token: string; user: UserProfile }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          username: username.replace(/^@/, '').trim(),
          password,
          displayName: authMode === 'register' ? displayName : undefined
        })
      });

      setStoredToken(res.token);
      setActiveRoomId(null);
      setUser(res.user);
      requestNotificationPermissionIfNeeded();
      if (res.user.theme_config) {
        try {
          const parsed = JSON.parse(res.user.theme_config);
          setCurrentTheme(parsed);
          applyThemeToDOM(parsed);
        } catch {
          applyThemeToDOM(THEME_PRESETS[0]);
        }
      } else {
        applyThemeToDOM(THEME_PRESETS[0]);
      }
    } catch (err: any) {
      setAuthError(err.message || 'ошибка авторизации');
    }
  };

  const handleLogout = () => {
    leaveActiveCall();
    stopRingtone();
    socketRef.current = null;
    disconnectSocket();
    setStoredToken(null);
    setUser(null);
    setRooms([]);
    setContacts([]);
    setActiveRoomId(null);
    applyThemeToDOM(THEME_PRESETS[0]);
  };

  const handleOpenSavedMessages = async () => {
    try {
      const res = await apiRequest<{ roomId: string }>('/chat/rooms/saved', {
        method: 'POST'
      });
      await loadRooms();
      selectRoom(res.roomId);
      setMiniProfileUser(null);
      if (publicProfileSlug) navigateTo('/');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleTopSearchChange = async (q: string) => {
    setTopSearchQuery(q);
    const cleaned = q.replace(/^@/, '').trim();
    if (!cleaned) {
      setTopSearchResults([]);
      return;
    }
    try {
      const res = await apiRequest<{ users: UserProfile[] }>(
        `/chat/users/search?q=${encodeURIComponent(cleaned)}`
      );
      setTopSearchResults(res.users);
    } catch {
      setTopSearchResults([]);
    }
  };

  const handleStartDirectChat = async (targetUserId: string) => {
    if (!user) {
      navigateTo('/');
      return;
    }
    if (targetUserId === user.id) {
      handleOpenSavedMessages();
      return;
    }
    try {
      const res = await apiRequest<{ roomId: string }>('/chat/rooms/direct', {
        method: 'POST',
        body: JSON.stringify({ targetUserId })
      });
      await loadRooms();
      selectRoom(res.roomId);
      setTopSearchOpen(false);
      setTopSearchQuery('');
      setTopSearchResults([]);
      setMiniProfileUser(null);
      if (publicProfileSlug) navigateTo('/');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggleContact = async (targetUser: UserProfile) => {
    const exists = contacts.some((c) => c.id === targetUser.id);
    try {
      if (exists) {
        const res = await apiRequest<{ contacts: UserProfile[] }>(`/chat/contacts/${targetUser.id}`, {
          method: 'DELETE'
        });
        setContacts(res.contacts);
        showTopToast('удалено из контактов');
      } else {
        const res = await apiRequest<{ contacts: UserProfile[] }>(`/chat/contacts/${targetUser.id}`, {
          method: 'POST'
        });
        setContacts(res.contacts);
        showTopToast('добавлено в контакты!');
      }
      loadRooms();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRenameContact = async (targetUser: UserProfile, customName: string) => {
    try {
      const res = await apiRequest<{ contacts: UserProfile[]; contact: UserProfile }>(
        `/chat/contacts/${targetUser.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ customName })
        }
      );
      setContacts(res.contacts);
      if (res.contact && miniProfileUser?.id === targetUser.id) {
        setMiniProfileUser(res.contact);
      }
      showTopToast('имя контакта сохранено!');
      loadRooms();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleTogglePinRoom = async (room: ChatRoom) => {
    if (room.is_jward || room.cannot_unpin) return;
    try {
      await apiRequest(`/chat/rooms/${room.id}/pin`, { method: 'PUT' });
      showTopToast(room.is_pinned ? 'чат откреплен' : 'чат закреплен!');
      loadRooms();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Перемещение закрепленных чатов вверх/вниз в сайдбаре
  const handleMovePinnedRoom = async (room: ChatRoom, direction: 'up' | 'down') => {
    const pinnedMovable = rooms.filter((r) => r.is_pinned && !r.is_jward && r.id !== 'global-lobby-room');
    const idx = pinnedMovable.findIndex((r) => r.id === room.id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= pinnedMovable.length) return;

    const reordered = [...pinnedMovable];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);

    try {
      await apiRequest('/chat/rooms/reorder-pins', {
        method: 'PUT',
        body: JSON.stringify({ orderedRoomIds: reordered.map((r) => r.id) })
      });
      showTopToast('порядок закрепов обновлен');
      loadRooms();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteRoom = async (room: ChatRoom) => {
    if (room.is_jward) return;
    const msgText = room.is_saved
      ? 'очистить все сообщения в «Избранном»?'
      : `удалить переписку «${room.name}» у обоих?`;
    if (!window.confirm(msgText)) return;
    try {
      await apiRequest(`/chat/rooms/${room.id}`, { method: 'DELETE' });
      if (!room.is_saved && activeRoomId === room.id) setActiveRoomId(null);
      showTopToast(room.is_saved ? 'избранное очищено' : 'переписка удалена');
      loadRooms();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Горизонтальное растягивание левого сайдбара на ПК
  const startResizeLeftSidebar = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMove = (moveEv: MouseEvent) => {
      const delta = moveEv.clientX - startX;
      setSidebarWidth(Math.max(240, Math.min(500, startW + delta)));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (authLoading) {
    return (
      <div className="h-[100dvh] w-screen flex items-center justify-center bg-jess-bg text-jess-textMain">
        <div className="text-xs text-jess-textMuted animate-pulse">загрузка jessenger...</div>
      </div>
    );
  }

  if (publicProfileSlug) {
    return (
      <>
        <GlobalTopToastBar />
        <PublicProfilePage
          usernameParam={publicProfileSlug}
          currentUser={user}
          contacts={contacts}
          onStartChatWithUser={(target) => {
            if (!user) {
              navigateTo('/');
            } else {
              handleStartDirectChat(target.id);
            }
          }}
          onOpenSavedMessages={handleOpenSavedMessages}
          onOpenRoomById={async (roomId) => {
            setPublicProfileSlug(null);
            await loadRooms();
            setDeepLink({ slug: null, msgNumber: null });
            selectRoom(roomId);
          }}
          onBackToApp={
            user
              ? () => {
                  setPublicProfileSlug(null);
                  navigateTo('/');
                }
              : undefined
          }
          onToggleContact={(target) => handleToggleContact(target)}
          onRenameContact={(target, newName) => handleRenameContact(target, newName)}
        />
      </>
    );
  }

  // ==================== ГЛАВНАЯ СТРАНИЦА ВХОДА / РЕГИСТРАЦИИ / СМЕНЫ ПАРОЛЯ ====================
  if (!user) {
    return (
      <div
        onContextMenu={(e) => e.preventDefault()}
        className="min-h-[100dvh] w-full flex items-center justify-center bg-jess-bg p-4 relative overflow-hidden"
      >
        <GlobalTopToastBar />
        <BackgroundVideoCarousel />

        <div className="ambient-orb absolute -top-32 -left-24 w-96 h-96 rounded-full bg-[#8a2be2]/20 blur-3xl z-[1]" />
        <div className="ambient-orb-2 absolute -bottom-32 -right-24 w-96 h-96 rounded-full bg-[#bb86fc]/15 blur-3xl z-[1]" />

        <div className="w-full max-w-sm glass-panel border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl relative z-10 animate-menu-in">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl overflow-hidden border border-white/20 neon-glow mb-4 shadow-2xl">
              <img
                src="/logo.jpg"
                alt="jessenger logo"
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <InteractiveTitle
                as="h1"
                text="jessenger"
                className="text-3xl font-extrabold text-white tracking-wider heading-glow"
              />
            </div>
            <p className="text-xs text-jess-textMuted mt-1.5">
              dev by{' '}
              <a
                href="https://zoboch.in"
                target="_blank"
                rel="noopener noreferrer"
                className="zbchn-link"
              >
                zbchn
              </a>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-2xl bg-black/40 border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
                setAuthSuccess(null);
              }}
              className={`py-2 rounded-xl font-semibold transition ${
                authMode === 'login' || authMode === 'change_password'
                  ? 'cta-music-btn text-white'
                  : 'text-jess-textMuted hover:text-white'
              }`}
            >
              вход
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setAuthError(null);
                setAuthSuccess(null);
              }}
              className={`py-2 rounded-xl font-semibold transition ${
                authMode === 'register'
                  ? 'cta-music-btn text-white'
                  : 'text-jess-textMuted hover:text-white'
              }`}
            >
              регистрация
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs text-jess-textMuted mb-1">юзернейм</label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-xs text-jess-textMuted select-none">@</span>
                <input
                  type="text"
                  required
                  maxLength={51}
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
                  className="w-full pl-8 pr-4 py-2.5 rounded-2xl bg-black/45 border border-white/15 text-sm text-white focus:outline-none neon-border-focus"
                />
              </div>
            </div>

            {authMode === 'register' && (
              <div>
                <label className="block text-xs text-jess-textMuted mb-1">имя</label>
                <input
                  type="text"
                  required
                  placeholder="Ваше имя"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl bg-black/45 border border-white/15 text-sm text-white focus:outline-none neon-border-focus"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-jess-textMuted">
                  {authMode === 'change_password' ? 'текущий пароль' : 'пароль'}
                </label>
                {authMode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('change_password');
                      setAuthError(null);
                      setAuthSuccess(null);
                    }}
                    className="text-[11px] text-jess-accentHover hover:underline transition"
                  >
                    забыли пароль?
                  </button>
                )}
                {authMode === 'change_password' && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setAuthError(null);
                      setAuthSuccess(null);
                    }}
                    className="text-[11px] text-jess-textMuted hover:text-white transition"
                  >
                    ← назад ко входу
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <input
                  type={showAuthPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-2xl bg-black/45 border border-white/15 text-sm text-white focus:outline-none neon-border-focus"
                />
                <button
                  type="button"
                  onClick={() => setShowAuthPassword(!showAuthPassword)}
                  title={showAuthPassword ? 'скрыть пароль' : 'показать пароль'}
                  className="absolute right-3 text-jess-textMuted hover:text-white transition"
                >
                  {showAuthPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authMode === 'change_password' && (
              <div className="animate-menu-in">
                <label className="block text-xs text-jess-textMuted mb-1">новый пароль</label>
                <div className="relative flex items-center">
                  <input
                    type={showAuthPassword ? 'text' : 'password'}
                    required
                    placeholder="Новый пароль (мин. 4 символа)"
                    value={newAuthPassword}
                    onChange={(e) => setNewAuthPassword(e.target.value)}
                    className="w-full pl-4 pr-10 py-2.5 rounded-2xl bg-black/45 border border-white/15 text-sm text-white focus:outline-none neon-border-focus"
                  />
                  <KeyRound className="w-4 h-4 text-jess-accentHover absolute right-3 pointer-events-none" />
                </div>
              </div>
            )}

            {authError && (
              <div className="p-3 rounded-2xl bg-red-950/60 border border-red-500/30 text-xs text-red-200 animate-menu-in">
                {authError}
              </div>
            )}

            {authSuccess && (
              <div className="p-3 rounded-2xl bg-emerald-950/60 border border-emerald-500/30 text-xs text-emerald-200 animate-menu-in">
                {authSuccess}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 rounded-2xl cta-music-btn text-white font-semibold text-xs transition"
            >
              {authMode === 'register'
                ? 'создать аккаунт'
                : authMode === 'change_password'
                ? 'сменить пароль и войти'
                : 'войти'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const activeRoom = rooms.find((r) => r.id === activeRoomId) || null;
  const isZbchnAdmin = user.is_admin === 1;
  const pinnedMovableRooms = rooms.filter(
    (r) => r.is_pinned && !r.is_jward && r.id !== 'global-lobby-room'
  );

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      className="h-[100dvh] w-screen flex flex-col overflow-hidden bg-jess-bg text-jess-textMain relative"
    >
      <GlobalTopToastBar />

      {isOffline && (
        <div className="px-4 py-1.5 bg-amber-500/20 border-b border-amber-400/35 text-amber-200 text-xs font-medium text-center z-40 shrink-0">
          офлайн-режим • показаны сохраненные переписки и скачанные файлы (синхронизация запустится при подключении)
        </div>
      )}

      {/* Аудиопотоки активного звонка играют всегда, даже при переходе в другие чаты */}
      {callRemoteItems
        .filter((item) => item.stream.getAudioTracks().length > 0)
        .map((a) => (
          <RemoteAudioRenderer key={a.id} stream={a.stream} muted={isCallDeafened} />
        ))}

      {/* Плавающее окно звонка (если включено или если открыт другой чат) */}
      {activeCallRoomId && (isCallFloatingWindow || activeRoomId !== activeCallRoomId) && isCallFloatingWindow && (
        <CallOverlay
          roomName={activeCallRoomName}
          currentUser={user}
          participants={callParticipants}
          remoteItems={callRemoteItems}
          isMicMuted={isCallMicMuted}
          isDeafened={isCallDeafened}
          isWebcamOn={isCallWebcamOn}
          isScreenSharing={isCallScreenSharing}
          localWebcamStream={localCallWebcamStream}
          localScreenStream={localCallScreenStream}
          isFloatingWindow={isCallFloatingWindow}
          onSetFloatingWindow={setIsCallFloatingWindow}
          onToggleMic={handleToggleCallMic}
          onToggleDeafen={handleToggleCallDeafen}
          onToggleWebcam={handleToggleCallWebcam}
          onSwitchCamera={handleSwitchCallCamera}
          onToggleScreenShare={handleToggleCallScreenShare}
          onLeaveCall={leaveActiveCall}
        />
      )}

      {/* Тост-уведомление о новом сообщении СВЕРХУ по центру */}
      {toastNotification && (
        <div
          onClick={() => {
            selectRoom(toastNotification.roomId);
            setToastNotification(null);
          }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-80 max-w-[92vw] glass-panel border border-jess-accent/60 rounded-2xl p-3.5 shadow-2xl cursor-pointer hover:border-jess-accentHover transition animate-top-toast flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-full overflow-hidden bg-jess-surface border border-white/15 flex items-center justify-center text-xs font-bold text-jess-accent shrink-0">
            {toastNotification.avatarUrl ? (
              <AvatarMedia src={toastNotification.avatarUrl} alt={toastNotification.senderName} />
            ) : (
              toastNotification.senderName.slice(0, 2)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-white truncate">{toastNotification.senderName}</div>
            <div className="text-[11px] text-jess-textMuted truncate">{toastNotification.text}</div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setToastNotification(null);
            }}
            className="p-1 text-jess-textMuted hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Входящий вызов СВЕРХУ */}
      {incomingCall && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-5 z-50 w-80 max-w-[92vw] glass-panel border border-jess-accent/50 rounded-3xl p-4 shadow-2xl neon-glow animate-menu-in">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-jess-surface border border-jess-accent flex items-center justify-center text-sm font-bold text-jess-accent shrink-0">
              {incomingCall.caller.avatar_url ? (
                <AvatarMedia
                  src={incomingCall.caller.avatar_url}
                  alt={incomingCall.caller.display_name}
                />
              ) : (
                incomingCall.caller.display_name.slice(0, 2)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <BadgeList badges={incomingCall.caller.badges} size="sm" />
                <span className="text-xs font-semibold text-white truncate">
                  {incomingCall.caller.display_name}
                </span>
                {incomingCall.caller.is_verified && <VerifiedBadge size="sm" />}
              </div>
              <div className="text-[11px] text-jess-accentHover truncate">
                входящий звонок {incomingCall.isGroup ? `• ${incomingCall.roomName}` : ''}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              type="button"
              onClick={() => {
                const targetRoomId = incomingCall.roomId;
                stopRingtone();
                broadcastDismissCall(targetRoomId);
                selectRoom(targetRoomId);
                setAutoJoinCallRoomId(targetRoomId);
                setIncomingCall(null);
              }}
              className="flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold transition"
            >
              <PhoneIncoming className="w-3.5 h-3.5" />
              <span>принять</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const targetRoomId = incomingCall.roomId;
                stopRingtone();
                broadcastDismissCall(targetRoomId);
                socketRef.current?.emit('call:decline', { roomId: targetRoomId });
                setIncomingCall(null);
              }}
              className="flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-red-500/80 hover:bg-red-500 text-white text-xs font-semibold transition"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>отклонить</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Левый сайдбар */}
        <aside
          className={`${
            activeRoom ? 'hidden md:flex' : 'flex'
          } w-full md:w-[var(--sidebar-w)] glass-panel border-r border-white/[0.06] flex-col shrink-0 z-20`}
        >
          <div className="p-3 border-b border-white/[0.06] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div
                onClick={() => selectRoom(null)}
                className="flex items-center gap-2 cursor-pointer shrink-0 group"
                title="на главную"
              >
                <img
                  src="/logo.jpg"
                  alt="logo"
                  className="w-8 h-8 rounded-xl object-cover border border-white/15 group-hover:scale-105 transition"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  const next = !topSearchOpen;
                  setTopSearchOpen(next);
                  setTopSearchQuery('');
                  setTopSearchResults([]);
                  if (next) {
                    setTimeout(() => topSearchInputRef.current?.focus(), 50);
                  }
                }}
                title="поиск по @юзернейму"
                className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-2xl border text-xs transition ${
                  topSearchOpen
                    ? 'bg-jess-accent/20 border-jess-accent text-white neon-glow'
                    : 'bg-black/35 border-white/10 text-jess-textMuted hover:text-white hover:border-white/20'
                }`}
              >
                <Search className="w-3.5 h-3.5 text-jess-accent shrink-0" />
                <span className="truncate">поиск...</span>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={handleOpenSavedMessages}
                  title="избранное (личные заметки и медиа)"
                  className="p-2 rounded-xl bg-white/[0.04] hover:bg-jess-accent text-jess-textMuted hover:text-white border border-white/5 transition"
                >
                  <Bookmark className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowCreateGroupModal(true)}
                  title="создать группу"
                  className="p-2 rounded-xl bg-white/[0.04] hover:bg-jess-accent text-jess-textMuted hover:text-white border border-white/5 transition"
                >
                  <Users className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowThemeModal(true)}
                  title="оформление"
                  className="p-2 rounded-xl bg-white/[0.04] hover:bg-jess-accent text-jess-textMuted hover:text-white border border-white/5 transition"
                >
                  <Palette className="w-4 h-4" />
                </button>
                {isZbchnAdmin && (
                  <button
                    onClick={() => setShowAdminModal(true)}
                    title="админ-панель"
                    className="p-2 rounded-xl bg-jess-accent/20 hover:bg-jess-accent text-jess-accentHover hover:text-white border border-jess-accent/35 transition"
                  >
                    <ShieldAlert className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {topSearchOpen && (
              <div className="p-2.5 rounded-2xl bg-black/50 border border-white/10 space-y-2 animate-menu-in">
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-xs text-jess-accent">@</span>
                  <input
                    ref={topSearchInputRef}
                    type="text"
                    placeholder="Введите имя или @юзернейм..."
                    value={topSearchQuery}
                    onChange={(e) => handleTopSearchChange(e.target.value)}
                    className="w-full pl-7 pr-8 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-jess-accent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setTopSearchOpen(false);
                      setTopSearchQuery('');
                      setTopSearchResults([]);
                    }}
                    className="absolute right-2 text-jess-textMuted hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="max-h-52 overflow-y-auto space-y-1 pr-0.5">
                  {!topSearchQuery.trim() ? (
                    <div className="py-3 text-center text-[11px] text-jess-textMuted">
                      начните вводить имя или @юзернейм
                    </div>
                  ) : topSearchResults.length === 0 ? (
                    <div className="py-3 text-center text-[11px] text-jess-textMuted">
                      никого не найдено
                    </div>
                  ) : (
                    topSearchResults.map((u) => {
                      const isContact = contacts.some((c) => c.id === u.id);
                      const isMe = u.id === user.id;
                      return (
                        <div
                          key={u.id}
                          className="flex items-center justify-between p-2 rounded-xl hover:bg-white/[0.06] transition"
                        >
                          <div
                            onClick={() => {
                              setMiniProfileUser(u);
                              setEditingMiniContactName(false);
                            }}
                            className="flex items-center gap-2 min-w-0 cursor-pointer flex-1"
                          >
                            <div className="relative w-8 h-8 shrink-0">
                              <div className="w-full h-full rounded-full bg-jess-surface flex items-center justify-center text-[11px] font-semibold text-jess-accent overflow-hidden">
                                {u.avatar_url ? (
                                  <AvatarMedia src={u.avatar_url} alt={u.display_name} />
                                ) : (
                                  u.display_name.slice(0, 2)
                                )}
                              </div>
                              {u.is_online && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-jess-bg z-10" />
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
                              <div className="text-[10px] text-jess-accentHover truncate">@{u.username}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {!isMe && (
                              <button
                                type="button"
                                onClick={() => handleToggleContact(u)}
                                title={isContact ? 'в контактах' : 'добавить в контакты'}
                                className={`p-1.5 rounded-lg border transition ${
                                  isContact
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                    : 'bg-white/[0.04] border-white/10 text-jess-textMuted hover:text-white'
                                }`}
                              >
                                {isContact ? <UserCheck className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleStartDirectChat(u.id)}
                              className="px-2.5 py-1 rounded-lg cta-music-btn text-white text-[11px] font-semibold"
                            >
                              {isMe ? 'избранное' : 'чат'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 p-1 rounded-2xl bg-black/30 border border-white/5">
              <button
                type="button"
                onClick={() => setSidebarTab('chats')}
                className={`py-1.5 rounded-xl text-xs font-medium transition ${
                  sidebarTab === 'chats'
                    ? 'bg-jess-surface text-white shadow'
                    : 'text-jess-textMuted hover:text-white'
                }`}
              >
                чаты ({rooms.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('contacts')}
                className={`py-1.5 rounded-xl text-xs font-medium transition ${
                  sidebarTab === 'contacts'
                    ? 'bg-jess-surface text-white shadow'
                    : 'text-jess-textMuted hover:text-white'
                }`}
              >
                контакты ({contacts.length})
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {sidebarTab === 'chats' ? (
              rooms.map((r) => {
                const isSelected = r.id === activeRoomId;
                const isJward = Boolean(r.is_jward || r.id === 'global-lobby-room');
                const isSaved = Boolean(r.is_saved);
                const partner =
                  !r.is_group && !isSaved
                    ? r.members.find((m) => m.id !== user.id) || r.members[0]
                    : null;

                const previewLine = r.last_message
                  ? isJward || isSaved
                    ? formatAttachmentPreviewText(r.last_message)
                    : `${r.last_message.sender.display_name}: ${formatAttachmentPreviewText(r.last_message)}`
                  : isJward
                  ? 'mered.ro/@j'
                  : isSaved
                  ? `mered.ro/@${user.username}`
                  : 'нет сообщений';

                const displayUnread = isSelected ? 0 : r.unread_count;

                return (
                  <button
                    key={r.id}
                    onClick={() => selectRoom(r.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSidebarContextMenu({
                        x: Math.min(Math.max(10, e.clientX), window.innerWidth - 250),
                        y: Math.min(Math.max(10, e.clientY), window.innerHeight - 280),
                        room: r,
                        targetUser: partner || undefined
                      });
                    }}
                    onTouchStart={(e) => {
                      if (e.touches.length !== 1) return;
                      const touch = e.touches[0];
                      const tx = touch.clientX;
                      const ty = touch.clientY;
                      if (longPressRoomTimerRef.current) clearTimeout(longPressRoomTimerRef.current);
                      longPressRoomTimerRef.current = setTimeout(() => {
                        setSidebarContextMenu({
                          x: Math.min(Math.max(10, tx), window.innerWidth - 250),
                          y: Math.min(Math.max(10, ty), window.innerHeight - 280),
                          room: r,
                          targetUser: partner || undefined
                        });
                      }, 500);
                    }}
                    onTouchMove={() => {
                      if (longPressRoomTimerRef.current) {
                        clearTimeout(longPressRoomTimerRef.current);
                        longPressRoomTimerRef.current = null;
                      }
                    }}
                    onTouchEnd={() => {
                      if (longPressRoomTimerRef.current) {
                        clearTimeout(longPressRoomTimerRef.current);
                        longPressRoomTimerRef.current = null;
                      }
                    }}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition-all border ${
                      isSelected
                        ? 'bg-white/[0.08] border-jess-accent/45 soft-glow'
                        : 'bg-transparent border-transparent hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="relative w-11 h-11 shrink-0">
                      <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border border-white/10 flex items-center justify-center font-semibold text-xs text-jess-accent">
                        {isSaved ? (
                          <Bookmark className="w-4 h-4 text-jess-accentHover" />
                        ) : r.avatar_url ? (
                          <AvatarMedia src={r.avatar_url} alt={r.name} />
                        ) : r.is_group ? (
                          <Hash className="w-4 h-4 text-jess-accentHover" />
                        ) : (
                          r.name.slice(0, 2)
                        )}
                      </div>
                      {partner?.is_online && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-jess-bg shadow-[0_0_8px_#34d399] z-10" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center min-w-0 gap-0.5">
                          {partner && <BadgeList badges={partner.badges} size="sm" />}
                          <span className="text-xs font-semibold text-white truncate">
                            {renderTextWithIosEmojis(r.name)}
                          </span>
                          {(r.is_verified || isJward || partner?.is_verified) && (
                            <VerifiedBadge size="sm" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {r.is_pinned && (
                            <Pin className="w-3 h-3 text-jess-accentHover rotate-45" />
                          )}
                          {displayUnread > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-jess-accent text-white text-[10px] font-bold">
                              {displayUnread}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] text-jess-textMuted truncate mt-0.5">
                        {renderTextWithIosEmojis(previewLine)}
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setTopSearchOpen(true);
                    setTopSearchQuery('');
                    setTopSearchResults([]);
                    setTimeout(() => topSearchInputRef.current?.focus(), 50);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-jess-accentHover transition mb-2"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>найти по имени или @юзу</span>
                </button>

                {contacts.length === 0 ? (
                  <div className="py-10 text-center text-xs text-jess-textMuted">
                    список контактов пуст
                  </div>
                ) : (
                  contacts.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => {
                        setMiniProfileUser(c);
                        setEditingMiniContactName(false);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSidebarContextMenu({
                          x: Math.min(Math.max(10, e.clientX), window.innerWidth - 250),
                          y: Math.min(Math.max(10, e.clientY), window.innerHeight - 250),
                          targetUser: c
                        });
                      }}
                      className="flex items-center justify-between p-2.5 rounded-2xl hover:bg-white/[0.04] cursor-pointer transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative w-10 h-10 shrink-0">
                          <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border border-white/10 flex items-center justify-center text-xs font-semibold text-jess-accent">
                            {c.avatar_url ? (
                              <AvatarMedia src={c.avatar_url} alt={c.display_name} />
                            ) : (
                              c.display_name.slice(0, 2)
                            )}
                          </div>
                          {c.is_online && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-jess-bg shadow-[0_0_8px_#34d399] z-10" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center">
                            <BadgeList badges={c.badges} size="sm" />
                            <span className="text-xs font-semibold text-white truncate">
                              {c.display_name}
                            </span>
                            {c.is_verified && <VerifiedBadge size="sm" />}
                          </div>
                          <div className="text-[11px] text-jess-textMuted truncate">
                            {formatLastSeen(c.is_online, c.last_seen_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <DiscordCallBar
            user={user}
            inCall={Boolean(activeCallRoomId)}
            callRoomName={activeCallRoomName}
            pingMs={callPingMs}
            isMicMuted={isCallMicMuted}
            isDeafened={isCallDeafened}
            isWebcamOn={isCallWebcamOn}
            isScreenSharing={isCallScreenSharing}
            isFloatingWindow={isCallFloatingWindow}
            noiseMode={noiseMode}
            micThreshold={micThreshold}
            selectedMicId={selectedMicId}
            selectedCamId={selectedCamId}
            getMicLevel={() => callEngineRef.current?.getMicInputLevel() || 0}
            onJumpToCallRoom={() => {
              if (activeCallRoomId) selectRoom(activeCallRoomId);
            }}
            onToggleFloatingWindow={() => setIsCallFloatingWindow((v) => !v)}
            onToggleMic={handleToggleCallMic}
            onToggleDeafen={handleToggleCallDeafen}
            onToggleWebcam={handleToggleCallWebcam}
            onToggleScreenShare={handleToggleCallScreenShare}
            onLeaveCall={leaveActiveCall}
            onChangeNoiseSettings={handleChangeNoiseSettings}
            onSelectMicDevice={handleSelectMicDevice}
            onSelectCamDevice={handleSelectCamDevice}
            onOpenProfileSettings={() => setShowProfileModal(true)}
            onLogout={handleLogout}
          />
        </aside>

        {/* Ручка изменения ширины левого сайдбара (только на ПК) */}
        <div
          onMouseDown={startResizeLeftSidebar}
          title="потяните влево или вправо, чтобы изменить ширину панели чатов"
          className="hidden md:block resize-handle-x"
        />

        {/* Основная область чата или пустой экран «выберите с кем хотите полагать» */}
        {activeRoom && socket ? (
          <ChatView
            room={activeRoom}
            allRooms={rooms}
            contacts={contacts}
            currentUser={user}
            socket={socket}
            globalTheme={currentTheme}
            highlightedMsgNumber={highlightedMsgNumber}
            onClearHighlightedMsg={() => setHighlightedMsgNumber(null)}
            autoJoinCall={autoJoinCallRoomId === activeRoom.id}
            onAutoJoinHandled={() => setAutoJoinCallRoomId(null)}
            activeCallRoomId={activeCallRoomId}
            activeCallParticipants={callParticipants}
            activeCallRemoteItems={callRemoteItems}
            isCallMicMuted={isCallMicMuted}
            isCallDeafened={isCallDeafened}
            isCallWebcamOn={isCallWebcamOn}
            isCallScreenSharing={isCallScreenSharing}
            localCallWebcamStream={localCallWebcamStream}
            localCallScreenStream={localCallScreenStream}
            isCallFloatingWindow={isCallFloatingWindow}
            onSetCallFloatingWindow={setIsCallFloatingWindow}
            onStartCall={startCallInRoom}
            onLeaveCall={leaveActiveCall}
            onToggleCallMic={handleToggleCallMic}
            onToggleCallDeafen={handleToggleCallDeafen}
            onToggleCallWebcam={handleToggleCallWebcam}
            onSwitchCallCamera={handleSwitchCallCamera}
            onToggleCallScreenShare={handleToggleCallScreenShare}
            isOffline={isOffline}
            onSelectUserMiniProfile={(u) => {
              setMiniProfileUser(u);
              setEditingMiniContactName(false);
            }}
            onRefreshRooms={loadRooms}
            onRoomDeleted={() => {
              selectRoom(null);
              loadRooms();
            }}
            onCloseRoom={() => selectRoom(null)}
          />
        ) : (
          <div className="hidden md:flex flex-1 flex-col items-center justify-center p-6 text-center relative overflow-hidden select-none">
            <div className="ambient-orb absolute w-96 h-96 rounded-full bg-jess-accent/10 blur-3xl pointer-events-none" />
            <div className="w-16 h-16 rounded-3xl overflow-hidden border border-white/15 neon-glow mb-4">
              <img src="/logo.jpg" alt="jessenger" className="w-full h-full object-cover" />
            </div>
            <InteractiveTitle
              as="h2"
              text="выберите с кем хотите полагать"
              className="text-base sm:text-lg font-bold text-white heading-glow"
            />
            <p className="text-xs text-jess-textMuted mt-2">
              откройте диалог слева или найдите друга через поиск
            </p>
          </div>
        )}
      </div>

      {/* ПКМ / удержание на чате в сайдбаре */}
      {sidebarContextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: `${sidebarContextMenu.x}px`, top: `${sidebarContextMenu.y}px` }}
          className="fixed z-50 w-60 rounded-2xl glass-panel border border-white/15 shadow-2xl p-1.5 animate-menu-in"
        >
          {sidebarContextMenu.room && (
            <>
              <button
                type="button"
                onClick={() => {
                  selectRoom(sidebarContextMenu.room!.id);
                  setSidebarContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
              >
                <span>открыть чат</span>
              </button>

              {!sidebarContextMenu.room.cannot_unpin && !sidebarContextMenu.room.is_jward && (
                <button
                  type="button"
                  onClick={() => {
                    handleTogglePinRoom(sidebarContextMenu.room!);
                    setSidebarContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
                >
                  <Pin className="w-3.5 h-3.5 text-jess-accentHover" />
                  <span>{sidebarContextMenu.room.is_pinned ? 'открепить чат' : 'закрепить чат'}</span>
                </button>
              )}

              {sidebarContextMenu.room.is_pinned &&
                !sidebarContextMenu.room.is_jward &&
                pinnedMovableRooms.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const r = sidebarContextMenu.room!;
                        setSidebarContextMenu(null);
                        handleMovePinnedRoom(r, 'up');
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
                    >
                      <ArrowUp className="w-3.5 h-3.5 text-jess-accentHover" />
                      <span>переместить закреп выше</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const r = sidebarContextMenu.room!;
                        setSidebarContextMenu(null);
                        handleMovePinnedRoom(r, 'down');
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
                    >
                      <ArrowDown className="w-3.5 h-3.5 text-jess-accentHover" />
                      <span>переместить закреп ниже</span>
                    </button>
                  </>
                )}

              {sidebarContextMenu.room.slug && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      copyTextWithToast(
                        `https://mered.ro/@${sidebarContextMenu.room!.slug}`,
                        `ссылка mered.ro/@${sidebarContextMenu.room!.slug} скопирована!`
                      );
                      setSidebarContextMenu(null);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-jess-accentHover transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>скопировать mered.ro/@{sidebarContextMenu.room.slug}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const slug = sidebarContextMenu.room!.slug!;
                      setSidebarContextMenu(null);
                      navigateTo(`/@${slug}`);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-jess-accentHover" />
                    <span>открыть карточку @{sidebarContextMenu.room.slug}</span>
                  </button>
                </>
              )}

              {!sidebarContextMenu.room.is_jward && (
                <button
                  type="button"
                  onClick={() => {
                    const targetRoom = sidebarContextMenu.room!;
                    setSidebarContextMenu(null);
                    handleDeleteRoom(targetRoom);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-red-500/20 text-xs text-red-300 transition"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>{sidebarContextMenu.room.is_saved ? 'очистить избранное' : 'удалить переписку'}</span>
                </button>
              )}
            </>
          )}

          {sidebarContextMenu.targetUser && (
            <>
              <button
                type="button"
                onClick={() => {
                  setMiniProfileUser(sidebarContextMenu.targetUser!);
                  setEditingMiniContactName(false);
                  setSidebarContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
              >
                <span>открыть карточку</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const target = sidebarContextMenu.targetUser!;
                  setSidebarContextMenu(null);
                  const nextAlias = window.prompt(
                    `Новое имя для контакта @${target.username}:`,
                    target.display_name
                  );
                  if (nextAlias !== null) {
                    handleRenameContact(target, nextAlias);
                  }
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
              >
                <Edit3 className="w-3.5 h-3.5 text-jess-accentHover" />
                <span>переименовать контакт</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  handleToggleContact(sidebarContextMenu.targetUser!);
                  setSidebarContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
              >
                <span>
                  {contacts.some((c) => c.id === sidebarContextMenu.targetUser!.id)
                    ? 'убрать из контактов'
                    : 'добавить в контакты'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  copyTextWithToast(
                    `https://mered.ro/@${sidebarContextMenu.targetUser!.username}`,
                    `ссылка mered.ro/@${sidebarContextMenu.targetUser!.username} скопирована!`
                  );
                  setSidebarContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-jess-textMuted hover:text-white transition"
              >
                <span>скопировать mered.ro/@{sidebarContextMenu.targetUser.username}</span>
              </button>
            </>
          )}
        </div>
      )}

      {showCreateGroupModal && (
        <CreateGroupModal
          currentUser={user}
          contacts={contacts}
          onClose={() => setShowCreateGroupModal(false)}
          onCreated={async (roomId) => {
            await loadRooms();
            selectRoom(roomId);
            setShowCreateGroupModal(false);
          }}
        />
      )}

      {/* Карточка контакта / мини-профиль */}
      {miniProfileUser && (
        <div
          onClick={() => setMiniProfileUser(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-menu-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-panel border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center gap-4">
              <div className="relative w-16 h-16 shrink-0">
                <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border border-jess-accent/60 flex items-center justify-center text-xl font-bold text-jess-accent soft-glow">
                  {miniProfileUser.avatar_url ? (
                    <AvatarMedia
                      src={miniProfileUser.avatar_url}
                      alt={miniProfileUser.display_name}
                    />
                  ) : (
                    miniProfileUser.display_name.slice(0, 2)
                  )}
                </div>
                {miniProfileUser.is_online && (
                  <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-400 border-2 border-jess-bg shadow-[0_0_8px_#34d399] z-10" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                {editingMiniContactName ? (
                  <div className="flex items-center gap-1.5 mb-1">
                    <input
                      type="text"
                      value={miniContactCustomName}
                      onChange={(e) => setMiniContactCustomName(e.target.value)}
                      placeholder="Имя контакта..."
                      className="w-full px-2.5 py-1 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-jess-accent"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        handleRenameContact(miniProfileUser, miniContactCustomName);
                        setEditingMiniContactName(false);
                      }}
                      className="px-2.5 py-1 rounded-xl bg-jess-accent text-white text-xs font-semibold shrink-0"
                    >
                      ок
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center flex-wrap gap-1">
                    <BadgeList badges={miniProfileUser.badges} size="md" />
                    <h4 className="text-base font-bold text-white">
                      {renderTextWithIosEmojis(miniProfileUser.display_name)}
                    </h4>
                    {miniProfileUser.is_verified && <VerifiedBadge size="md" />}
                    {miniProfileUser.id !== user.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setMiniContactCustomName(miniProfileUser.display_name);
                          setEditingMiniContactName(true);
                        }}
                        title="изменить имя контакта"
                        className="p-1 rounded-lg hover:bg-white/10 text-jess-textMuted hover:text-white transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <div className="text-xs text-jess-accentHover font-mono">@{miniProfileUser.username}</div>
                <div className="text-[11px] text-jess-textMuted mt-0.5">
                  {formatLastSeen(miniProfileUser.is_online, miniProfileUser.last_seen_at)}
                </div>
              </div>
            </div>

            {miniProfileUser.music_url && (
              <ProfileMusicPlayer
                musicUrl={miniProfileUser.music_url}
                musicTitle={miniProfileUser.music_title}
              />
            )}

            {miniProfileUser.bio && (
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-jess-textMain">
                <div className="text-[10px] text-jess-textMuted mb-1">о себе</div>
                <p className="whitespace-pre-wrap">{renderTextWithIosEmojis(miniProfileUser.bio)}</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  copyTextWithToast(
                    `https://mered.ro/@${miniProfileUser.username}`,
                    `ссылка mered.ro/@${miniProfileUser.username} скопирована!`
                  );
                  setCopiedMiniLink(true);
                  setTimeout(() => setCopiedMiniLink(false), 2000);
                }}
                className="flex-1 flex items-center justify-between px-3.5 py-2 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-jess-accentHover transition"
              >
                <span className="font-mono">mered.ro/@{miniProfileUser.username}</span>
                {copiedMiniLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetUsername = miniProfileUser.username;
                  setMiniProfileUser(null);
                  navigateTo(`/@${targetUsername}`);
                }}
                title="открыть публичную карточку профиля"
                className="p-2 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-jess-textMuted hover:text-white transition"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              {miniProfileUser.id === user.id ? (
                <button
                  type="button"
                  onClick={handleOpenSavedMessages}
                  className="px-4 py-2 rounded-2xl cta-music-btn text-white text-xs font-semibold transition"
                >
                  открыть избранное
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleToggleContact(miniProfileUser)}
                    className="px-3.5 py-2 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs text-white transition"
                  >
                    {contacts.some((c) => c.id === miniProfileUser.id) ? 'в контактах ✓' : '+ в контакты'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartDirectChat(miniProfileUser.id)}
                    className="px-4 py-2 rounded-2xl cta-music-btn text-white text-xs font-semibold transition"
                  >
                    написать
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setMiniProfileUser(null)}
                className="px-3.5 py-2 rounded-2xl border border-white/10 text-xs text-jess-textMuted hover:text-white"
              >
                закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {showThemeModal && (
        <ThemeCustomizerModal
          currentTheme={currentTheme}
          onClose={() => setShowThemeModal(false)}
          onSaveTheme={(newTheme) => {
            setCurrentTheme(newTheme);
            applyThemeToDOM(newTheme);
          }}
        />
      )}

      {showProfileModal && (
        <ProfileSettingsModal
          user={user}
          onClose={() => setShowProfileModal(false)}
          onUpdated={(updated) => {
            setUser(updated);
            loadRooms();
          }}
          onAccountDeleted={() => {
            setShowProfileModal(false);
            handleLogout();
          }}
        />
      )}

      {showAdminModal && isZbchnAdmin && (
        <AdminPanelModal
          currentUser={user}
          onClose={() => {
            setShowAdminModal(false);
            loadRooms();
            loadContacts();
          }}
        />
      )}
    </div>
  );
};
