import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  Video,
  Reply,
  Pin,
  Smile,
  PhoneCall,
  Users,
  FileText,
  Download,
  Play,
  Pause,
  Volume2,
  VolumeX,
  X,
  Copy,
  Forward,
  UserPlus,
  ExternalLink,
  Check,
  CheckCheck,
  Edit3,
  Trash2,
  History,
  Eye,
  Plus,
  Palette,
  Lock,
  Bookmark,
  UploadCloud,
  Music,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Heart,
  MoreVertical,
  SwitchCamera,
  PhoneMissed,
  Sticker
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import { CallParticipant, ChatMessage, ChatRoom, StickerPack, ThemeConfig, UserProfile } from '../types';
import {
  apiRequest,
  uploadFileInChunks,
  downloadMediaFile,
  playUiSound,
  formatAttachmentPreviewText,
  showTopToast,
  copyTextWithToast
} from '../services/api';
import { checkMediaDevicesSupport } from '../services/webrtc.engine';
import { AvatarMedia, BadgeList, VerifiedBadge, isVideoAssetUrl } from './BadgeList';
import { CallOverlay } from './CallOverlay';
import { RemoteMediaItem } from '../services/webrtc.engine';
import { GroupProfileModal } from './GroupProfileModal';
import { ThemeCustomizerModal, getReadableTextForBg } from './ThemeCustomizerModal';
import {
  IosEmoji,
  IOS_EMOJI_CATALOG,
  QUICK_REACTIONS,
  formatLastSeen,
  renderTextWithIosEmojis
} from './IosEmoji';

function formatDateDivider(isoStr?: string | null): string {
  if (!isoStr) return '';
  const norm = isoStr.endsWith('Z') ? isoStr : `${isoStr.replace(' ', 'T')}Z`;
  const d = new Date(norm);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function getDateKey(isoStr?: string | null): string {
  if (!isoStr) return '';
  const norm = isoStr.endsWith('Z') ? isoStr : `${isoStr.replace(' ', 'T')}Z`;
  const d = new Date(norm);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatCallDuration(sec: number): string {
  if (!sec || sec <= 0) return '0 сек';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} сек`;
  return `${m} мин ${s} сек`;
}

function formatExactDateTime(isoStr?: string | null): string {
  if (!isoStr) return '';
  const norm = isoStr.endsWith('Z') ? isoStr : `${isoStr.replace(' ', 'T')}Z`;
  const d = new Date(norm);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

function getPendingFileKind(file: File): 'image' | 'video' | 'audio' | 'file' {
  const mime = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'apng', 'svg'].includes(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'].includes(ext)) {
    return 'audio';
  }
  return 'file';
}

interface PendingAttachmentItem {
  id: string;
  file: File;
  previewUrl: string;
  kind: 'image' | 'video' | 'audio' | 'file';
}

const VoiceMessagePlayer: React.FC<{
  url: string;
  fileName?: string | null;
  waveform: number[];
  duration: number;
  isAutoPlaying: boolean;
  onPlayStart: () => void;
  onPlayEnded: () => void;
}> = ({ url, fileName, waveform, duration, isAutoPlaying, onPlayStart, onPlayEnded }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!audioRef.current) return;
    if (isAutoPlaying && !playing) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } else if (!isAutoPlaying && playing) {
      audioRef.current.pause();
    }
  }, [isAutoPlaying]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      onPlayStart();
      audioRef.current.play().catch(() => {});
    }
  };

  const bars =
    waveform && waveform.length > 0
      ? waveform
      : [0.25, 0.6, 0.9, 0.4, 0.75, 0.5, 0.85, 0.35, 0.65, 0.95, 0.45, 0.3];

  return (
    <div className="flex items-center gap-2.5 py-1.5 px-3 rounded-2xl bg-black/30 border border-white/10 min-w-[210px] sm:min-w-[235px]">
      <audio
        ref={audioRef}
        src={url}
        onPlay={() => {
          setPlaying(true);
          onPlayStart();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          onPlayEnded();
        }}
        onTimeUpdate={() => {
          if (audioRef.current && audioRef.current.duration) {
            setProgress(audioRef.current.currentTime / audioRef.current.duration);
          }
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        className="w-8 h-8 rounded-full cta-music-btn text-white flex items-center justify-center shrink-0"
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>

      <div
        onClick={(e) => {
          if (!audioRef.current || !audioRef.current.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          audioRef.current.currentTime = ratio * audioRef.current.duration;
          setProgress(ratio);
        }}
        className="flex items-end gap-0.5 h-5 flex-1 cursor-pointer"
      >
        {bars.map((amp, idx) => {
          const filled = idx / bars.length <= progress;
          return (
            <div
              key={idx}
              className="w-1 rounded-full transition-all"
              style={{
                height: `${Math.max(18, Math.round(amp * 100))}%`,
                backgroundColor: filled ? 'var(--accent-hover)' : 'rgba(255,255,255,0.25)'
              }}
            />
          );
        })}
      </div>

      <span className="text-[11px] font-mono text-jess-textMuted shrink-0">
        {duration ? `${duration.toFixed(1)} с` : 'гс'}
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          downloadMediaFile(url, fileName || 'voice_message.webm');
        }}
        title="скачать голосовое сообщение"
        className="p-1.5 rounded-xl hover:bg-white/10 text-jess-textMuted hover:text-white transition shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// Инлайн-плеер для MP3 / WAV / OGG / FLAC / M4A аудиофайлов в чате
const AudioAttachmentPlayer: React.FC<{
  url: string;
  fileName?: string | null;
  fileSize?: number | null;
}> = ({ url, fileName, fileSize }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [curTime, setCurTime] = useState(0);
  const [dur, setDur] = useState(0);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const fmt = (s: number) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <div className="p-3 my-1 rounded-2xl bg-black/40 border border-jess-accent/35 min-w-[220px] sm:min-w-[250px] max-w-sm space-y-2">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDur(audioRef.current.duration || 0);
        }}
        onTimeUpdate={() => {
          if (audioRef.current && audioRef.current.duration) {
            setCurTime(audioRef.current.currentTime);
            setProgress(audioRef.current.currentTime / audioRef.current.duration);
          }
        }}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="w-9 h-9 rounded-xl cta-music-btn text-white flex items-center justify-center shrink-0"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {playing ? (
              <div className="flex items-end gap-0.5 h-3.5 shrink-0">
                <span className="w-0.5 rounded-full eq-bar-1" />
                <span className="w-0.5 rounded-full eq-bar-2" />
                <span className="w-0.5 rounded-full eq-bar-3" />
              </div>
            ) : (
              <Music className="w-3.5 h-3.5 text-jess-accent shrink-0" />
            )}
            <div className="text-xs font-semibold text-white truncate">
              {fileName || 'Аудиозапись.mp3'}
            </div>
          </div>
          <div className="text-[10px] font-mono text-jess-textMuted mt-0.5">
            {fmt(curTime)} / {fmt(dur)} {fileSize ? `• ${formatFileSize(fileSize)}` : ''}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            downloadMediaFile(url, fileName || 'audio.mp3');
          }}
          title="скачать аудиофайл"
          className="p-2 rounded-xl bg-white/[0.06] hover:bg-jess-accent text-white transition shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>

      <div
        onClick={(e) => {
          if (!audioRef.current || !audioRef.current.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          audioRef.current.currentTime = ratio * audioRef.current.duration;
          setProgress(ratio);
        }}
        className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden cursor-pointer"
      >
        <div
          className="h-full rounded-full transition-all duration-100"
          style={{
            width: `${Math.max(3, Math.round(progress * 100))}%`,
            background: 'linear-gradient(90deg, var(--accent), var(--accent-hover))'
          }}
        />
      </div>
    </div>
  );
};

// Инлайн-плеер для MP4 / WebM / MOV видеофайлов в чате
const VideoAttachmentPlayer: React.FC<{
  url: string;
  fileName?: string | null;
  fileSize?: number | null;
}> = ({ url, fileName, fileSize }) => {
  return (
    <div className="my-1.5 rounded-2xl overflow-hidden bg-black/75 border border-white/15 max-w-full sm:max-w-md">
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="max-h-72 sm:max-h-80 w-full object-contain bg-black"
      />
      <div className="px-3 py-2 bg-black/60 border-t border-white/10 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-white truncate">{fileName || 'Видео.mp4'}</div>
          {fileSize ? <div className="text-[10px] text-jess-textMuted">{formatFileSize(fileSize)}</div> : null}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            downloadMediaFile(url, fileName || 'video.mp4');
          }}
          title="скачать видео"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/[0.08] hover:bg-jess-accent text-xs text-white transition shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>скачать</span>
        </button>
      </div>
    </div>
  );
};

// Круглое видеосообщение (кружочек)
const VideoNotePlayer: React.FC<{
  url: string;
  duration: number;
  isAutoPlaying: boolean;
  onPlayStart: () => void;
  onPlayEnded: () => void;
}> = ({ url, duration, isAutoPlaying, onPlayStart, onPlayEnded }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isAutoPlaying) {
      videoRef.current.muted = false;
      setMuted(false);
      videoRef.current.currentTime = 0;
      videoRef.current
        .play()
        .then(() => setPlaying(true))
        .catch(() => {});
    } else if (playing && !muted) {
      videoRef.current.pause();
      setPlaying(false);
    }
  }, [isAutoPlaying]);

  const handleToggle = () => {
    if (!videoRef.current) return;
    if (!playing || muted) {
      onPlayStart();
      videoRef.current.muted = false;
      setMuted(false);
      if (videoRef.current.ended) {
        videoRef.current.currentTime = 0;
      }
      videoRef.current.play().catch(() => {});
      setPlaying(true);
    } else {
      videoRef.current.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="relative inline-block group my-1">
      <div
        onClick={handleToggle}
        className={`relative w-44 h-44 sm:w-52 sm:h-52 rounded-full overflow-hidden border-2 cursor-pointer select-none transition-all ${
          playing && !muted
            ? 'border-jess-accent neon-glow scale-[1.02]'
            : 'border-jess-accent/60 hover:border-jess-accent'
        }`}
      >
        <video
          ref={videoRef}
          src={url}
          muted={muted}
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            onPlayEnded();
          }}
          className="w-full h-full object-cover scale-[1.03]"
        />
        {!playing && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center transition group-hover:bg-black/20">
            <div className="w-11 h-11 rounded-full bg-black/65 border border-white/20 flex items-center justify-center text-white">
              <Play className="w-5 h-5 ml-0.5" />
            </div>
          </div>
        )}
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-black/65 backdrop-blur-md border border-white/10 flex items-center gap-1.5 text-[10px] font-mono text-white">
          {muted || !playing ? (
            <VolumeX className="w-3 h-3 text-jess-accent" />
          ) : (
            <Volume2 className="w-3 h-3 text-emerald-400" />
          )}
          <span>{duration ? `${duration.toFixed(1)} с` : 'кружок'}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          downloadMediaFile(url, 'video_note.webm');
        }}
        title="скачать видеокружок"
        className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-2 rounded-full bg-black/75 hover:bg-jess-accent text-white border border-white/15 transition z-10"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

interface ChatViewProps {
  room: ChatRoom;
  allRooms: ChatRoom[];
  contacts: UserProfile[];
  currentUser: UserProfile;
  socket: Socket;
  globalTheme: ThemeConfig;
  highlightedMsgNumber?: number | null;
  onClearHighlightedMsg?: () => void;
  autoJoinCall?: boolean;
  onAutoJoinHandled?: () => void;
  activeCallRoomId: string | null;
  activeCallParticipants: CallParticipant[];
  activeCallRemoteItems: RemoteMediaItem[];
  isCallMicMuted: boolean;
  isCallDeafened: boolean;
  isCallWebcamOn: boolean;
  isCallScreenSharing: boolean;
  localCallWebcamStream: MediaStream | null;
  localCallScreenStream: MediaStream | null;
  isCallFloatingWindow: boolean;
  onSetCallFloatingWindow: (f: boolean) => void;
  onStartCall: (room: ChatRoom) => void;
  onLeaveCall: () => void;
  onToggleCallMic: () => void;
  onToggleCallDeafen: () => void;
  onToggleCallWebcam: () => void;
  onSwitchCallCamera: () => void;
  onToggleCallScreenShare: () => void;
  isOffline?: boolean;
  onSelectUserMiniProfile: (user: UserProfile) => void;
  onRefreshRooms: () => void;
  onRoomDeleted: () => void;
  onCloseRoom?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  room,
  allRooms,
  contacts,
  currentUser,
  socket,
  globalTheme,
  highlightedMsgNumber,
  onClearHighlightedMsg,
  autoJoinCall,
  onAutoJoinHandled,
  activeCallRoomId,
  activeCallParticipants: globalCallParticipants,
  activeCallRemoteItems,
  isCallMicMuted,
  isCallDeafened,
  isCallWebcamOn,
  isCallScreenSharing,
  localCallWebcamStream,
  localCallScreenStream,
  isCallFloatingWindow,
  onSetCallFloatingWindow,
  onStartCall,
  onLeaveCall,
  onToggleCallMic,
  onToggleCallDeafen,
  onToggleCallWebcam,
  onSwitchCallCamera,
  onToggleCallScreenShare,
  isOffline = false,
  onSelectUserMiniProfile,
  onRefreshRooms,
  onRoomDeleted,
  onCloseRoom
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);

  // Очередь прикрепленных медиафайлов для предпросмотра и добавления подписи перед отправкой!
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachmentItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragOverWatchdogRef = useRef<any>(null);
  const [uploadProgress, setUploadProgress] = useState<{ fileName: string; percent: number } | null>(null);

  // Анимация красного сердечка по двойному нажатию
  const [heartBurstMsgId, setHeartBurstMsgId] = useState<string | null>(null);
  const lastTouchTapRef = useRef<{ msgId: string; time: number } | null>(null);
  const longPressTimerRef = useRef<any>(null);

  // Расположение панели закрепленных сообщений (сверху или снизу над полем ввода) и переключение между закрепами
  const [pinnedBarPosition, setPinnedBarPosition] = useState<'top' | 'bottom'>(() => {
    return (localStorage.getItem('jess_pin_bar_pos') as 'top' | 'bottom') || 'top';
  });
  const [activePinnedIdx, setActivePinnedIdx] = useState<number>(0);

  const [membersDrawerWidth, setMembersDrawerWidth] = useState<number>(288);
  const [activePlayingMediaId, setActivePlayingMediaId] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: ChatMessage;
  } | null>(null);
  const [showAllReactionsInMenu, setShowAllReactionsInMenu] = useState(false);
  const [customReactionInput, setCustomReactionInput] = useState('');
  const [showReadListInMenu, setShowReadListInMenu] = useState(false);

  const [editHistoryModalMsg, setEditHistoryModalMsg] = useState<ChatMessage | null>(null);
  const [forwardModalMsg, setForwardModalMsg] = useState<ChatMessage | null>(null);
  const [showGroupProfileModal, setShowGroupProfileModal] = useState(false);
  const [showRoomThemeModal, setShowRoomThemeModal] = useState(false);

  const [showAddGroupMemberModal, setShowAddGroupMemberModal] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState<UserProfile[]>([]);

  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [showMembersDrawer, setShowMembersDrawer] = useState(false);

  const inCall = activeCallRoomId === room.id;
  const [roomCallParticipants, setRoomCallParticipants] = useState<CallParticipant[]>([]);
  const activeCallParticipants = inCall ? globalCallParticipants : roomCallParticipants;

  // Стикеры
  const [pickerTab, setPickerTab] = useState<'emoji' | 'stickers'>('emoji');
  const [stickerPacks, setStickerPacks] = useState<StickerPack[]>([]);
  const [newStickerPackName, setNewStickerPackName] = useState('');
  const [creatingPack, setCreatingPack] = useState(false);
  const [uploadingStickerPackId, setUploadingStickerPackId] = useState<string | null>(null);
  const stickerFileInputRef = useRef<HTMLInputElement | null>(null);
  const targetStickerPackIdRef = useRef<string | null>(null);

  // Поворот камеры для видеокружка
  const [videoNoteFacingMode, setVideoNoteFacingMode] = useState<'user' | 'environment'>('user');

  // Запись ГС
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isVoicePaused, setIsVoicePaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const waveformSamplesRef = useRef<number[]>([]);
  const recordTimerRef = useRef<any>(null);
  const voiceCancelledRef = useRef<boolean>(false);
  const recordedElapsedMsRef = useRef<number>(0);
  const lastResumeTimestampRef = useRef<number>(0);

  // Запись видеокружка
  const [isRecordingVideoNote, setIsRecordingVideoNote] = useState(false);
  const [videoNoteSeconds, setVideoNoteSeconds] = useState(0);
  const videoNotePreviewRef = useRef<HTMLVideoElement | null>(null);
  const videoNoteStreamRef = useRef<MediaStream | null>(null);
  const videoNoteRecorderRef = useRef<MediaRecorder | null>(null);
  const videoNoteChunksRef = useRef<Blob[]>([]);
  const videoNoteTimerRef = useRef<any>(null);
  const videoNoteCancelledRef = useRef<boolean>(false);

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaInputRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  const highlightLockUntilRef = useRef<number>(0);

  const isJward = Boolean(room.is_jward || room.id === 'global-lobby-room');
  const isSaved = Boolean(room.is_saved);
  const isAdmin = currentUser.is_admin === 1;
  const canPostInRoom = !isJward || isAdmin;

  const activeRoomTheme: ThemeConfig = React.useMemo(() => {
    let base = { ...globalTheme };
    if (room.theme_config) {
      try {
        const parsed = JSON.parse(room.theme_config);
        base = { ...base, ...parsed };
      } catch {
        // fallback
      }
    }
    const effectiveWallpaper = room.wallpaper_url || base.chatWallpaper || globalTheme.chatWallpaper || '';
    return {
      ...base,
      chatWallpaper: effectiveWallpaper,
      bgBrightness: base.bgBrightness ?? globalTheme.bgBrightness ?? 0.45,
      bgBlur: base.bgBlur ?? globalTheme.bgBlur ?? 0
    };
  }, [room.theme_config, room.wallpaper_url, globalTheme]);

  const ownBubbleTextColor = getReadableTextForBg(activeRoomTheme.msgOwn).main;
  const otherBubbleTextColor = getReadableTextForBg(activeRoomTheme.msgOther).main;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Полная защита от зависания окна перетаскивания файла (активна только во время перетаскивания!)
  useEffect(() => {
    if (!isDraggingOver) return;

    const clearDrag = () => {
      if (dragOverWatchdogRef.current) {
        clearTimeout(dragOverWatchdogRef.current);
        dragOverWatchdogRef.current = null;
      }
      setIsDraggingOver(false);
    };

    const onWindowDragLeave = (e: DragEvent) => {
      if (
        !e.relatedTarget ||
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        clearDrag();
      }
    };

    window.addEventListener('dragend', clearDrag);
    window.addEventListener('drop', clearDrag);
    window.addEventListener('dragleave', onWindowDragLeave);
    window.addEventListener('mousemove', clearDrag);
    window.addEventListener('blur', clearDrag);

    return () => {
      window.removeEventListener('dragend', clearDrag);
      window.removeEventListener('drop', clearDrag);
      window.removeEventListener('dragleave', onWindowDragLeave);
      window.removeEventListener('mousemove', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, [isDraggingOver]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDraggingOver) {
          setIsDraggingOver(false);
          return;
        }
        if (lightboxImage) {
          setLightboxImage(null);
          return;
        }
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        if (showEmojiPicker) {
          setShowEmojiPicker(false);
          return;
        }
        if (pendingAttachments.length > 0) {
          pendingAttachments.forEach((p) => URL.revokeObjectURL(p.previewUrl));
          setPendingAttachments([]);
          return;
        }
        if (editHistoryModalMsg) {
          setEditHistoryModalMsg(null);
          return;
        }
        if (forwardModalMsg) {
          setForwardModalMsg(null);
          return;
        }
        if (showAddGroupMemberModal) {
          setShowAddGroupMemberModal(false);
          return;
        }
        if (showRoomThemeModal) {
          setShowRoomThemeModal(false);
          return;
        }
        if (showGroupProfileModal) {
          setShowGroupProfileModal(false);
          return;
        }
        if (editingMessage || replyTo) {
          setEditingMessage(null);
          setReplyTo(null);
          return;
        }
        if (showMembersDrawer) {
          setShowMembersDrawer(false);
          return;
        }
        if (onCloseRoom) {
          onCloseRoom();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isDraggingOver,
    lightboxImage,
    contextMenu,
    showEmojiPicker,
    pendingAttachments,
    editHistoryModalMsg,
    forwardModalMsg,
    showAddGroupMemberModal,
    showRoomThemeModal,
    showGroupProfileModal,
    editingMessage,
    replyTo,
    showMembersDrawer,
    onCloseRoom
  ]);

  // Реакция красного сердечка по двойному клику (ПК) или двойному тапу (телефон)
  const handleDoubleTapHeart = (msg: ChatMessage) => {
    if (msg.is_deleted || msg.type === 'system') return;

    setHeartBurstMsgId(msg.id);
    setTimeout(() => {
      setHeartBurstMsgId((prev) => (prev === msg.id ? null : prev));
    }, 680);

    // Оптимистичное обновление в UI без ожидания ответа сервера
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msg.id) return m;
        const existingReactions = m.reactions ? [...m.reactions] : [];
        const heartIdx = existingReactions.findIndex((r) => r.emoji === '❤️');
        if (heartIdx >= 0) {
          const heartGroup = existingReactions[heartIdx];
          const alreadyHasMe = heartGroup.users.some((u) => u.id === currentUser.id);
          if (alreadyHasMe) {
            const nextUsers = heartGroup.users.filter((u) => u.id !== currentUser.id);
            if (nextUsers.length === 0) {
              existingReactions.splice(heartIdx, 1);
            } else {
              existingReactions[heartIdx] = { ...heartGroup, users: nextUsers };
            }
          } else {
            existingReactions[heartIdx] = {
              ...heartGroup,
              users: [
                ...heartGroup.users,
                {
                  id: currentUser.id,
                  username: currentUser.username,
                  display_name: currentUser.display_name
                }
              ]
            };
          }
        } else {
          existingReactions.push({
            emoji: '❤️',
            users: [
              {
                id: currentUser.id,
                username: currentUser.username,
                display_name: currentUser.display_name
              }
            ]
          });
        }
        return { ...m, reactions: existingReactions };
      })
    );

    socket.emit('message:toggle_reaction', {
      messageId: msg.id,
      emoji: '❤️'
    });
  };

  const handleMediaEnded = (finishedMsgId: string) => {
    const idx = messages.findIndex((m) => m.id === finishedMsgId);
    if (idx === -1) {
      setActivePlayingMediaId(null);
      return;
    }
    for (let i = idx + 1; i < messages.length; i++) {
      const candidate = messages[i];
      if (!candidate.is_deleted && (candidate.type === 'voice' || candidate.type === 'video_note') && candidate.file_url) {
        setActivePlayingMediaId(candidate.id);
        return;
      }
    }
    setActivePlayingMediaId(null);
  };

  useEffect(() => {
    if (autoJoinCall) {
      onStartCall(room);
      if (onAutoJoinHandled) onAutoJoinHandled();
    }
  }, [autoJoinCall, room.id]);

  useEffect(() => {
    const closeMenus = () => {
      setContextMenu(null);
      setShowAllReactionsInMenu(false);
      setShowReadListInMenu(false);
    };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  useEffect(() => {
    setLoading(true);
    setReplyTo(null);
    setEditingMessage(null);
    setContextMenu(null);
    setShowEmojiPicker(false);
    setShowMembersDrawer(false);
    setActivePlayingMediaId(null);
    setIsDraggingOver(false);
    setPendingAttachments((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });

    socket.emit('room:join_channel', { roomId: room.id });
    socket.emit('room:mark_read', { roomId: room.id });

    apiRequest<{ messages: ChatMessage[] }>(`/chat/rooms/${room.id}/messages?limit=500`)
      .then((res) => {
        setMessages(res.messages);
        try {
          localStorage.setItem(`jess_cache_msgs_${room.id}`, JSON.stringify(res.messages.slice(-150)));
          const desktop = (window as any).jessengerDesktop;
          if (desktop?.saveOfflineData) {
            desktop.saveOfflineData(`msgs_${room.id}`, res.messages.slice(-150));
          }
        } catch {}
        setTimeout(() => {
          if (highlightedMsgNumber) {
            highlightLockUntilRef.current = Date.now() + 1800;
            const el = document.querySelector(`[data-msg-number="${highlightedMsgNumber}"]`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return;
            }
          }
          scrollToBottom();
        }, 120);
      })
      .catch(async (err) => {
        console.error('ошибка загрузки сообщений:', err);
        try {
          const desktop = (window as any).jessengerDesktop;
          const cached = desktop?.loadOfflineData
            ? await desktop.loadOfflineData(`msgs_${room.id}`)
            : JSON.parse(localStorage.getItem(`jess_cache_msgs_${room.id}`) || 'null');
          if (Array.isArray(cached)) {
            setMessages(cached);
          }
        } catch {
          // ignore
        }
      })
      .finally(() => setLoading(false));

    socket.emit('call:get_state', { roomId: room.id }, (res: any) => {
      if (res && Array.isArray(res.participants)) {
        setRoomCallParticipants(res.participants);
      } else {
        setRoomCallParticipants([]);
      }
    });
  }, [room.id]);

  useEffect(() => {
    if (!highlightedMsgNumber || messages.length === 0) return;
    highlightLockUntilRef.current = Date.now() + 1800;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-msg-number="${highlightedMsgNumber}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [highlightedMsgNumber, messages.length]);

  useEffect(() => {
    const handleNewMessage = (msg: ChatMessage) => {
      if (!msg || msg.room_id !== room.id) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      socket.emit('room:mark_read', { roomId: room.id });
      setTimeout(scrollToBottom, 60);
    };

    const handleUpdatedMessage = (msg: ChatMessage) => {
      if (!msg || msg.room_id !== room.id) return;
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
    };

    const handleDeletedMessage = (payload: { roomId: string; messageId: string }) => {
      if (payload.roomId !== room.id) return;
      setMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
    };

    const handleMessagesRead = (payload: {
      roomId: string;
      userId: string;
      readAt: string;
      reader: { user_id: string; username: string; display_name: string; avatar_url: string | null };
    }) => {
      if (payload.roomId !== room.id) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.sender_id === payload.userId) return m;
          const existing = m.read_by || [];
          if (existing.some((r) => r.user_id === payload.userId)) return m;
          return {
            ...m,
            read_by: [
              {
                user_id: payload.reader.user_id,
                username: payload.reader.username,
                display_name: payload.reader.display_name,
                avatar_url: payload.reader.avatar_url,
                read_at: payload.readAt
              },
              ...existing
            ]
          };
        })
      );
    };

    const handleTypingUpdate = (payload: {
      roomId: string;
      userId: string;
      displayName?: string;
      isTyping: boolean;
    }) => {
      if (payload.roomId !== room.id || payload.userId === currentUser.id) return;
      setTypingUsers((prev) => {
        const next = { ...prev };
        if (payload.isTyping && payload.displayName) {
          next[payload.userId] = payload.displayName;
        } else {
          delete next[payload.userId];
        }
        return next;
      });
    };

    const handleCallParticipants = (payload: { roomId: string; participants: CallParticipant[] }) => {
      if (payload.roomId === room.id) {
        setRoomCallParticipants(payload.participants);
      }
    };

    const handleCallEnded = (payload: { roomId: string }) => {
      if (payload.roomId === room.id) {
        setRoomCallParticipants([]);
      }
    };

    socket.on('message:new', handleNewMessage);
    socket.on('message:updated', handleUpdatedMessage);
    socket.on('message:deleted', handleDeletedMessage);
    socket.on('room:messages_read', handleMessagesRead);
    socket.on('typing:update', handleTypingUpdate);
    socket.on('call:participants_updated', handleCallParticipants);
    socket.on('call:ended', handleCallEnded);

    const loadStickerPacks = () => {
      apiRequest<{ packs: StickerPack[] }>('/chat/stickers/packs')
        .then((res) => setStickerPacks(res.packs || []))
        .catch(() => {});
    };
    loadStickerPacks();
    socket.on('stickers:updated', loadStickerPacks);

    return () => {
      socket.off('stickers:updated', loadStickerPacks);
      socket.off('message:new', handleNewMessage);
      socket.off('message:updated', handleUpdatedMessage);
      socket.off('message:deleted', handleDeletedMessage);
      socket.off('room:messages_read', handleMessagesRead);
      socket.off('typing:update', handleTypingUpdate);
      socket.off('call:participants_updated', handleCallParticipants);
      socket.off('call:ended', handleCallEnded);
    };
  }, [room.id, currentUser.id, socket]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (!isJward && !isSaved) {
      socket.emit('typing:start', { roomId: room.id });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing:stop', { roomId: room.id });
      }, 1800);
    }
  };

  // Добавление файлов в окно предпросмотра перед отправкой
  const addFilesToStaging = (files: File[]) => {
    if (!canPostInRoom || files.length === 0) return;
    const newItems: PendingAttachmentItem[] = files.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      kind: getPendingFileKind(file)
    }));
    setPendingAttachments((prev) => [...prev, ...newItems]);
    setTimeout(() => textareaInputRef.current?.focus(), 40);
  };

  const removeStagedAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const submitCurrentMessage = async () => {
    const trimmed = inputText.trim();

    if (pendingAttachments.length > 0) {
      const queue = [...pendingAttachments];
      setPendingAttachments([]);
      const captionToUse = trimmed;
      const replyIdToUse = replyTo?.id || null;
      setInputText('');
      setReplyTo(null);
      setShowEmojiPicker(false);

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        setUploadProgress({ fileName: item.file.name, percent: 0 });
        try {
          const uploaded = await uploadFileInChunks(item.file, 'attachments', item.file.name, (pct) => {
            setUploadProgress({ fileName: item.file.name, percent: pct });
          });

          await apiRequest(`/chat/rooms/${room.id}/attachments`, {
            method: 'POST',
            body: JSON.stringify({
              content: i === 0 ? captionToUse : '',
              replyToId: i === 0 ? replyIdToUse : null,
              chunkedFileUrl: uploaded.fileUrl,
              chunkedFileName: uploaded.fileName,
              chunkedFileSize: uploaded.fileSize,
              chunkedMimeType: uploaded.mimeType
            })
          });
          URL.revokeObjectURL(item.previewUrl);
        } catch (err: any) {
          showTopToast('ошибка отправки файла: ' + err.message, 'error');
        }
      }
      setUploadProgress(null);
      playUiSound('msg_send', 0.45);
      return;
    }

    if (!trimmed) return;

    if (editingMessage) {
      socket.emit('message:edit', {
        messageId: editingMessage.id,
        newContent: trimmed
      });
      setEditingMessage(null);
      setInputText('');
      setShowEmojiPicker(false);
      showTopToast('сообщение изменено', 'success');
      return;
    }

    socket.emit('message:send', {
      roomId: room.id,
      content: trimmed,
      replyToId: replyTo?.id
    });
    playUiSound('msg_send', 0.45);
    setReplyTo(null);
    setInputText('');
    setShowEmojiPicker(false);
    socket.emit('typing:stop', { roomId: room.id });
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    submitCurrentMessage();
  };

  const handleFileAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      addFilesToStaging(files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDropFiles = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverWatchdogRef.current) {
      clearTimeout(dragOverWatchdogRef.current);
      dragOverWatchdogRef.current = null;
    }
    setIsDraggingOver(false);
    if (!canPostInRoom) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      addFilesToStaging(files);
    }
  };

  // Запись ГС
  const startVoiceRecording = async () => {
    const secErr = checkMediaDevicesSupport();
    if (secErr) {
      showTopToast(secErr, 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      waveformSamplesRef.current = [];
      voiceCancelledRef.current = false;
      recordedElapsedMsRef.current = 0;
      lastResumeTimestampRef.current = Date.now();

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      setRecordingSeconds(0);
      setIsVoicePaused(false);
      setIsRecordingVoice(true);

      recordTimerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          const totalMs =
            recordedElapsedMsRef.current + (Date.now() - lastResumeTimestampRef.current);
          setRecordingSeconds(Math.floor(totalMs / 1000));
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          waveformSamplesRef.current.push(Number(Math.min(1, Math.max(0.15, avg / 180)).toFixed(2)));
        }
      }, 200);

      mediaRecorder.onstop = async () => {
        clearInterval(recordTimerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});

        if (voiceCancelledRef.current) return;

        const finalMs =
          recordedElapsedMsRef.current +
          (mediaRecorder.state === 'paused' ? 0 : Date.now() - lastResumeTimestampRef.current);
        const durationSec = Math.max(0.8, finalMs / 1000);
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        const raw = waveformSamplesRef.current;
        const normalized = Array.from({ length: 24 }, (_, idx) => {
          if (raw.length === 0) return 0.4;
          const pos = Math.floor((idx / 24) * raw.length);
          return raw[pos] || 0.35;
        });

        try {
          const uploaded = await uploadFileInChunks(blob, 'voice', 'voice.webm');
          await apiRequest(`/chat/rooms/${room.id}/voice`, {
            method: 'POST',
            body: JSON.stringify({
              chunkedFileUrl: uploaded.fileUrl,
              chunkedFileSize: uploaded.fileSize,
              waveform: JSON.stringify(normalized),
              duration: String(durationSec.toFixed(1)),
              replyToId: replyTo?.id || null
            })
          });
          playUiSound('msg_send', 0.45);
          setReplyTo(null);
        } catch (err: any) {
          showTopToast('ошибка отправки голосового: ' + err.message, 'error');
        }
      };

      mediaRecorder.start(200);
    } catch (err: any) {
      showTopToast('не удалось получить доступ к микрофону: ' + err.message, 'error');
    }
  };

  const togglePauseResumeVoice = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      recordedElapsedMsRef.current += Date.now() - lastResumeTimestampRef.current;
      setIsVoicePaused(true);
    } else if (rec.state === 'paused') {
      lastResumeTimestampRef.current = Date.now();
      rec.resume();
      setIsVoicePaused(false);
    }
  };

  const finishAndSendVoiceRecording = () => {
    voiceCancelledRef.current = false;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      if (rec.state === 'recording') {
        recordedElapsedMsRef.current += Date.now() - lastResumeTimestampRef.current;
      }
      rec.stop();
    }
    setIsRecordingVoice(false);
    setIsVoicePaused(false);
  };

  const cancelVoiceRecording = () => {
    voiceCancelledRef.current = true;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
    }
    setIsRecordingVoice(false);
    setIsVoicePaused(false);
  };

  // Запись видеокружка
  const startVideoNoteRecording = async (overrideFacing?: 'user' | 'environment') => {
    const targetFacing = overrideFacing || videoNoteFacingMode;
    const secErr = checkMediaDevicesSupport();
    if (secErr) {
      showTopToast(secErr, 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480 },
          height: { ideal: 480 },
          facingMode: targetFacing
        },
        audio: true
      });

      videoNoteStreamRef.current = stream;
      videoNoteChunksRef.current = [];
      videoNoteCancelledRef.current = false;

      const recorder = new MediaRecorder(stream);
      videoNoteRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) videoNoteChunksRef.current.push(ev.data);
      };

      const startTime = Date.now();
      setVideoNoteSeconds(0);
      setIsRecordingVideoNote(true);

      setTimeout(() => {
        if (videoNotePreviewRef.current) {
          videoNotePreviewRef.current.srcObject = stream;
        }
      }, 40);

      videoNoteTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setVideoNoteSeconds(elapsed);
        if (elapsed >= 60) {
          stopAndSendVideoNote(false);
        }
      }, 250);

      recorder.onstop = async () => {
        clearInterval(videoNoteTimerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        videoNoteStreamRef.current = null;

        if (videoNoteCancelledRef.current) return;

        const durationSec = Math.max(1.0, (Date.now() - startTime) / 1000);
        const blob = new Blob(videoNoteChunksRef.current, { type: 'video/webm' });

        try {
          const uploaded = await uploadFileInChunks(blob, 'video_notes', 'video_note.webm');
          await apiRequest(`/chat/rooms/${room.id}/video-note`, {
            method: 'POST',
            body: JSON.stringify({
              chunkedFileUrl: uploaded.fileUrl,
              chunkedFileSize: uploaded.fileSize,
              duration: String(durationSec.toFixed(1)),
              replyToId: replyTo?.id || null
            })
          });
          playUiSound('msg_send', 0.45);
          setReplyTo(null);
        } catch (err: any) {
          showTopToast('ошибка отправки видеосообщения: ' + err.message, 'error');
        }
      };

      recorder.start();
    } catch (err: any) {
      showTopToast('не удалось включить камеру: ' + err.message, 'error');
    }
  };


  const flipVideoNoteCamera = async () => {
    const nextFacing = videoNoteFacingMode === 'user' ? 'environment' : 'user';
    setVideoNoteFacingMode(nextFacing);
    if (!isRecordingVideoNote) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: nextFacing },
        audio: true
      });
      if (videoNoteStreamRef.current) {
        videoNoteStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      videoNoteStreamRef.current = newStream;
      if (videoNotePreviewRef.current) {
        videoNotePreviewRef.current.srcObject = newStream;
      }
    } catch {
      showTopToast('не удалось переключить камеру', 'error');
    }
  };

  const stopAndSendVideoNote = (cancel: boolean = false) => {
    videoNoteCancelledRef.current = cancel;
    if (videoNoteRecorderRef.current && videoNoteRecorderRef.current.state !== 'inactive') {
      videoNoteRecorderRef.current.stop();
    } else if (videoNoteStreamRef.current) {
      videoNoteStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    setIsRecordingVideoNote(false);
  };

  const openMessageMenuAt = (clientX: number, clientY: number, msg: ChatMessage) => {
    const x = Math.min(Math.max(10, clientX), window.innerWidth - 268);
    const y = Math.min(Math.max(10, clientY), window.innerHeight - 360);
    setShowAllReactionsInMenu(false);
    setShowReadListInMenu(false);
    setCustomReactionInput('');
    setContextMenu({ x, y, message: msg });
  };

  const handleMessageContextMenu = (e: React.MouseEvent, msg: ChatMessage) => {
    e.preventDefault();
    e.stopPropagation();
    openMessageMenuAt(e.clientX, e.clientY, msg);
  };

  const handleForwardToRoom = (targetRoomId: string) => {
    if (!forwardModalMsg) return;
    socket.emit('message:forward', {
      messageId: forwardModalMsg.id,
      targetRoomId
    });
    playUiSound('msg_send', 0.45);
    showTopToast('сообщение переслано!', 'success');
    setForwardModalMsg(null);
  };

  const handleSearchAddMembers = async (q: string) => {
    setMemberSearchQuery(q);
    if (!q.trim()) {
      setMemberSearchResults([]);
      return;
    }
    try {
      const res = await apiRequest<{ users: UserProfile[] }>(
        `/chat/users/search?q=${encodeURIComponent(q.replace(/^@/, ''))}`
      );
      const existingIds = new Set(room.members.map((m) => m.id));
      setMemberSearchResults(res.users.filter((u) => !existingIds.has(u.id)));
    } catch {
      setMemberSearchResults([]);
    }
  };

  const handleAddMemberToGroup = async (uid: string) => {
    try {
      await apiRequest(`/chat/rooms/${room.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userIds: [uid] })
      });
      onRefreshRooms();
      setMemberSearchResults((prev) => prev.filter((u) => u.id !== uid));
      showTopToast('участник добавлен!', 'success');
    } catch (err: any) {
      showTopToast(err.message, 'error');
    }
  };

  const handleDeleteConversation = async () => {
    if (isJward) return;
    const msgText = isSaved
      ? 'очистить все сообщения в «Избранном»?'
      : 'удалить эту переписку у обоих собеседников?';
    if (!window.confirm(msgText)) return;
    try {
      await apiRequest(`/chat/rooms/${room.id}`, { method: 'DELETE' });
      if (isSaved) {
        setMessages([]);
        onRefreshRooms();
        showTopToast('избранное очищено', 'info');
      } else {
        showTopToast('переписка удалена', 'info');
        onRoomDeleted();
      }
    } catch (err: any) {
      showTopToast(err.message, 'error');
    }
  };

  const startResizeMembersDrawer = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = membersDrawerWidth;

    const onMove = (moveEv: MouseEvent) => {
      const delta = startX - moveEv.clientX;
      setMembersDrawerWidth(Math.max(210, Math.min(480, startW + delta)));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const pinnedInRoom = messages.filter((m) => m.is_pinned && !m.is_deleted);
  const currentPinnedMsg =
    pinnedInRoom.length > 0
      ? pinnedInRoom[Math.min(activePinnedIdx, pinnedInRoom.length - 1)]
      : null;

  const togglePinnedBarPosition = () => {
    const nextPos = pinnedBarPosition === 'top' ? 'bottom' : 'top';
    setPinnedBarPosition(nextPos);
    localStorage.setItem('jess_pin_bar_pos', nextPos);
    showTopToast(
      nextPos === 'top' ? 'закреп перемещен наверх' : 'закреп перемещен вниз над полем ввода',
      'info'
    );
  };

  const renderPinnedBar = () => {
    if (!currentPinnedMsg) return null;
    return (
      <div className="px-3 sm:px-6 py-2 bg-black/45 backdrop-blur-md border-y border-white/10 flex items-center justify-between text-xs z-10">
        <div
          onClick={() => {
            const el = document.querySelector(`[data-msg-number="${currentPinnedMsg.msg_number}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          className="flex items-center gap-2 min-w-0 cursor-pointer flex-1"
        >
          <Pin className="w-3.5 h-3.5 text-jess-accent shrink-0" />
          <div className="truncate">
            <span className="font-semibold mr-1.5" style={{ color: 'var(--accent-hover)' }}>
              закреплено{pinnedInRoom.length > 1 ? ` (${activePinnedIdx + 1}/${pinnedInRoom.length})` : ''}:
            </span>
            <span className="text-jess-textMain">
              {renderTextWithIosEmojis(formatAttachmentPreviewText(currentPinnedMsg))}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 ml-2 shrink-0">
          {pinnedInRoom.length > 1 && (
            <>
              <button
                type="button"
                onClick={() =>
                  setActivePinnedIdx((prev) => (prev - 1 + pinnedInRoom.length) % pinnedInRoom.length)
                }
                title="предыдущий закреп"
                className="p-1 rounded-lg hover:bg-white/10 text-jess-textMuted hover:text-white"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setActivePinnedIdx((prev) => (prev + 1) % pinnedInRoom.length)}
                title="следующий закреп"
                className="p-1 rounded-lg hover:bg-white/10 text-jess-textMuted hover:text-white"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={togglePinnedBarPosition}
            title="изменить расположение панели закрепов (сверху / снизу)"
            className="p-1 rounded-lg hover:bg-white/10 text-jess-textMuted hover:text-white transition"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>

          {canPostInRoom && (
            <button
              type="button"
              onClick={() => {
                socket.emit('message:toggle_pin', { messageId: currentPinnedMsg.id });
                showTopToast('сообщение откреплено', 'info');
              }}
              className="text-[11px] text-jess-textMuted hover:text-white ml-1"
            >
              открепить
            </button>
          )}
        </div>
      </div>
    );
  };

  const typingNames = Object.values(typingUsers);

  const directPartner = !room.is_group && !isSaved
    ? room.members.find((m) => m.id !== currentUser.id) || room.members[0]
    : null;

  const roomSlug = isJward ? 'j' : isSaved ? currentUser.username : room.slug || directPartner?.username || room.id;
  const wallpaperUrl = activeRoomTheme.chatWallpaper;
  const wallpaperBrightness = activeRoomTheme.bgBrightness ?? 0.45;
  const wallpaperBlur = activeRoomTheme.bgBlur ?? 0;

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!canPostInRoom) return;
        if (!e.dataTransfer?.types?.includes('Files')) return;
        setIsDraggingOver(true);
        if (dragOverWatchdogRef.current) clearTimeout(dragOverWatchdogRef.current);
        dragOverWatchdogRef.current = setTimeout(() => {
          setIsDraggingOver(false);
        }, 550);
      }}
      onDragLeave={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const related = e.relatedTarget as Node | null;
        if (
          !related ||
          !e.currentTarget.contains(related) ||
          e.clientX <= rect.left + 2 ||
          e.clientX >= rect.right - 2 ||
          e.clientY <= rect.top + 2 ||
          e.clientY >= rect.bottom - 2
        ) {
          if (dragOverWatchdogRef.current) {
            clearTimeout(dragOverWatchdogRef.current);
            dragOverWatchdogRef.current = null;
          }
          setIsDraggingOver(false);
        }
      }}
      onDrop={handleDropFiles}
      className="flex-1 flex flex-col h-full w-full bg-jess-bg relative overflow-hidden"
      style={{
        backgroundColor: activeRoomTheme.bgPrimary
      }}
    >
      {/* Слой общих или личных обоев чата с регулируемой яркостью и размытием */}
      {wallpaperUrl && (
        <div
          className="absolute inset-0 pointer-events-none z-0 overflow-hidden transition-all duration-300"
          style={{
            opacity: wallpaperBrightness,
            filter: wallpaperBlur > 0 ? `blur(${wallpaperBlur}px)` : 'none',
            transform: wallpaperBlur > 0 ? 'scale(1.06)' : 'none'
          }}
        >
          {isVideoAssetUrl(wallpaperUrl) ? (
            <video
              src={wallpaperUrl}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <img
              src={wallpaperUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
        </div>
      )}

      {/* Оверлей Drag-and-Drop перетаскивания файлов (никогда не зависает!) */}
      {isDraggingOver && canPostInRoom && (
        <div
          onClick={() => setIsDraggingOver(false)}
          className="absolute inset-3 z-50 rounded-3xl bg-[#0d0d12]/85 backdrop-blur-xl border-2 border-dashed border-jess-accent flex flex-col items-center justify-center gap-3 pointer-events-none neon-glow animate-menu-in"
        >
          <UploadCloud className="w-12 h-12 text-jess-accent animate-bounce" />
          <div className="text-sm sm:text-base font-bold text-white font-title text-center px-4">
            отпустите файлы, чтобы прикрепить и подписать
          </div>
          <div className="text-xs text-jess-textMuted text-center px-4">
            фото, видео mp4, музыка mp3, гифки и документы
          </div>
        </div>
      )}

      {/* Индикатор прогресса загрузки файла СВЕРХУ */}
      {uploadProgress && (
        <div className="px-4 sm:px-6 py-2 bg-black/80 border-b border-jess-accent/40 flex items-center justify-between text-xs z-30">
          <span className="text-white truncate">
            отправка «{uploadProgress.fileName}»...
          </span>
          <span className="font-mono text-jess-accent font-semibold ml-3">{uploadProgress.percent}%</span>
        </div>
      )}

      {/* Шапка чата (с кнопкой Назад для телефонов!) */}
      <div className="h-14 sm:h-16 px-3 sm:px-6 border-b border-white/[0.06] glass-panel flex items-center justify-between gap-2 shrink-0 z-10">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {onCloseRoom && (
            <button
              type="button"
              onClick={onCloseRoom}
              title="назад к списку чатов"
              className="md:hidden p-2 -ml-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          <div
            onClick={() => {
              if (isSaved) return;
              if (room.is_group || isJward) {
                setShowGroupProfileModal(true);
              } else if (directPartner) {
                onSelectUserMiniProfile(directPartner);
              }
            }}
            className="flex items-center gap-2.5 sm:gap-3 min-w-0 cursor-pointer group flex-1"
          >
            <div className="relative w-9 h-9 sm:w-10 sm:h-10 shrink-0">
              <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border border-white/10 flex items-center justify-center font-semibold text-xs text-jess-accent group-hover:border-jess-accent/60 transition">
                {isSaved ? (
                  <Bookmark className="w-4 h-4 text-jess-accent" />
                ) : room.avatar_url ? (
                  <AvatarMedia src={room.avatar_url} alt={room.name} />
                ) : (
                  room.name.slice(0, 2)
                )}
              </div>
              {directPartner?.is_online && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-jess-bg shadow-[0_0_8px_#34d399] z-10" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                {directPartner && <BadgeList badges={directPartner.badges} size="sm" />}
                <h2 className="font-semibold text-xs sm:text-sm text-white truncate">
                  {renderTextWithIosEmojis(room.name)}
                </h2>
                {(room.is_verified || isJward || directPartner?.is_verified) && (
                  <VerifiedBadge size="sm" />
                )}
              </div>
              <div className="text-[10px] sm:text-[11px] text-jess-textMuted truncate">
                {isSaved
                  ? `личное облако • mered.ro/@${currentUser.username}`
                  : isJward
                  ? isAdmin
                    ? `главный канал • mered.ro/@j • участников: ${room.members.length}`
                    : 'главный канал • mered.ro/@j'
                  : room.is_group
                  ? `группа • участников: ${room.members.length}`
                  : formatLastSeen(directPartner?.is_online, directPartner?.last_seen_at)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {(!isJward || isAdmin) && !isSaved && (
            <>
              {!inCall ? (
                <button
                  type="button"
                  onClick={() => onStartCall(room)}
                  className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-2xl cta-music-btn text-white text-xs font-semibold transition"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {activeCallParticipants.length > 0
                      ? `в звонок (${activeCallParticipants.length})`
                      : 'позвонить'}
                  </span>
                  {activeCallParticipants.length > 0 && (
                    <span className="sm:hidden">{activeCallParticipants.length}</span>
                  )}
                </button>
              ) : (
                <span className="px-2.5 sm:px-3 py-1.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] sm:text-xs font-medium">
                  в звонке
                </span>
              )}
            </>
          )}

          {(!isJward || isAdmin) && (
            <button
              type="button"
              onClick={() => setShowRoomThemeModal(true)}
              title="тема, обои и размытие фона"
              className="p-2 rounded-2xl bg-white/[0.04] hover:bg-white/[0.1] text-jess-textMuted hover:text-white border border-white/10 transition"
            >
              <Palette className="w-4 h-4" />
            </button>
          )}

          {room.is_group && (!isJward || isAdmin) && (
            <button
              type="button"
              onClick={() => setShowMembersDrawer(!showMembersDrawer)}
              title="участники группы"
              className={`p-2 rounded-2xl border transition ${
                showMembersDrawer
                  ? 'bg-jess-accent text-white border-jess-accent neon-glow'
                  : 'bg-white/[0.04] text-jess-textMuted hover:text-white border-white/10'
              }`}
            >
              <Users className="w-4 h-4" />
            </button>
          )}

          {!isJward && (
            <button
              type="button"
              onClick={handleDeleteConversation}
              title={isSaved ? 'очистить избранное' : 'удалить переписку'}
              className="p-2 rounded-2xl bg-red-500/10 hover:bg-red-500/25 text-red-300 border border-red-500/20 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Панель закрепленного сообщения сверху */}
      {pinnedBarPosition === 'top' && renderPinnedBar()}

      {/* Оверлей активного звонка (встроенный, если не вынесен в плавающее окно) */}
      {inCall && !isCallFloatingWindow && (
        <CallOverlay
          roomName={room.name}
          currentUser={currentUser}
          participants={globalCallParticipants}
          remoteItems={activeCallRemoteItems}
          isMicMuted={isCallMicMuted}
          isDeafened={isCallDeafened}
          isWebcamOn={isCallWebcamOn}
          isScreenSharing={isCallScreenSharing}
          localWebcamStream={localCallWebcamStream}
          localScreenStream={localCallScreenStream}
          isFloatingWindow={isCallFloatingWindow}
          onSetFloatingWindow={onSetCallFloatingWindow}
          onToggleMic={onToggleCallMic}
          onToggleDeafen={onToggleCallDeafen}
          onToggleWebcam={onToggleCallWebcam}
          onSwitchCamera={onSwitchCallCamera}
          onToggleScreenShare={onToggleCallScreenShare}
          onLeaveCall={onLeaveCall}
        />
      )}

      {/* Основная область сообщений + Боковая панель участников */}
      <div className="flex-1 flex min-h-0 relative z-10">
        <div
          ref={messagesContainerRef}
          onScroll={() => {
            if (
              highlightedMsgNumber &&
              onClearHighlightedMsg &&
              Date.now() > highlightLockUntilRef.current
            ) {
              const el = document.querySelector(`[data-msg-number="${highlightedMsgNumber}"]`);
              if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.bottom < 80 || rect.top > window.innerHeight - 100) {
                  onClearHighlightedMsg();
                }
              }
            }
          }}
          className="flex-1 overflow-y-auto px-3 sm:px-7 py-4 sm:py-5 space-y-3"
        >
          {loading ? (
            <div className="text-center py-12 text-xs text-jess-textMuted">загрузка сообщений...</div>
          ) : messages.length === 0 ? (
            <div className="text-center py-20">
              <div className="inline-flex px-5 py-3 rounded-2xl bg-white/[0.04] backdrop-blur-md border border-white/10 text-xs text-jess-textMuted">
                {isSaved ? 'сохраняйте сюда важные сообщения, фото, видео и треки' : 'сообщений пока нет'}
              </div>
            </div>
          ) : (
            messages.map((msg, msgIdx) => {
              const isMe = !isJward && msg.sender_id === currentUser.id;
              const isVideoCircle = msg.type === 'video_note' && msg.file_url;
              const isStickerMsg = msg.type === 'sticker' && msg.file_url;
              const isCallMsg = msg.type === 'call';
              const isHighlighted = highlightedMsgNumber === msg.msg_number;
              const isReadBySomeone = isJward && !isAdmin
                ? false
                : Boolean((msg.read_by && msg.read_by.length > 0) || isSaved);

              const currDateKey = getDateKey(msg.created_at);
              const prevDateKey = msgIdx > 0 ? getDateKey(messages[msgIdx - 1].created_at) : '';
              const showDateDivider = currDateKey && currDateKey !== prevDateKey;
              const dateDividerNode = showDateDivider ? (
                <div key={`date-${currDateKey}-${msg.id}`} className="flex justify-center my-3 select-none">
                  <span className="px-3.5 py-1 rounded-full bg-black/45 backdrop-blur-md border border-white/10 text-[11px] font-medium text-jess-textMuted">
                    {formatDateDivider(msg.created_at)}
                  </span>
                </div>
              ) : null;

              if (msg.type === 'system') {
                return (
                  <React.Fragment key={msg.id}>
                    {dateDividerNode}
                    <div
                      data-msg-number={msg.msg_number}
                      className="flex justify-center my-2 animate-msg-in"
                    >
                      <div className="px-4 py-1.5 rounded-full bg-black/50 border border-white/15 text-xs text-jess-textMain text-center">
                        {renderTextWithIosEmojis(msg.content)}
                      </div>
                    </div>
                  </React.Fragment>
                );
              }

              return (
                <React.Fragment key={msg.id}>
                  {dateDividerNode}
                <div
                  data-msg-number={msg.msg_number}
                  onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleDoubleTapHeart(msg);
                  }}
                  onTouchStart={(e) => {
                    if (e.touches.length !== 1) return;
                    const touch = e.touches[0];
                    const tx = touch.clientX;
                    const ty = touch.clientY;
                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = setTimeout(() => {
                      openMessageMenuAt(tx, ty, msg);
                    }, 480);
                  }}
                  onTouchMove={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onTouchEnd={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                    const now = Date.now();
                    if (
                      lastTouchTapRef.current &&
                      lastTouchTapRef.current.msgId === msg.id &&
                      now - lastTouchTapRef.current.time < 300
                    ) {
                      lastTouchTapRef.current = null;
                      handleDoubleTapHeart(msg);
                    } else {
                      lastTouchTapRef.current = { msgId: msg.id, time: now };
                    }
                  }}
                  className={`group flex gap-2 sm:gap-3 animate-msg-in transition-all rounded-2xl p-1 ${
                    isMe ? 'flex-row-reverse' : 'flex-row'
                  } ${msg.is_deleted ? 'opacity-65' : ''}`}
                >
                  {/* Аватар отправителя */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isJward) {
                        setShowGroupProfileModal(true);
                        return;
                      }
                      const found = room.members.find((m) => m.id === msg.sender.id) || {
                        id: msg.sender.id,
                        username: msg.sender.username,
                        display_name: msg.sender.display_name,
                        avatar_url: msg.sender.avatar_url,
                        bio: '',
                        is_online: false,
                        last_seen_at: msg.created_at,
                        is_admin: 0,
                        is_verified: msg.sender.is_verified,
                        theme_config: '',
                        created_at: msg.created_at,
                        badges: msg.sender.badges
                      };
                      onSelectUserMiniProfile(found);
                    }}
                    className="w-8 h-8 rounded-full overflow-hidden bg-jess-surface border border-white/10 shrink-0 mt-1 hover:scale-105 transition"
                  >
                    {isJward ? (
                      <img src="/jward-avatar.jpg" alt="jward" className="w-full h-full object-cover" />
                    ) : msg.sender.avatar_url ? (
                      <AvatarMedia src={msg.sender.avatar_url} alt={msg.sender.display_name} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] font-semibold text-jess-accent">
                        {msg.sender.display_name.slice(0, 2)}
                      </div>
                    )}
                  </button>

                  {/* Пузырь сообщения */}
                  <div className={`max-w-[82%] sm:max-w-[66%] flex flex-col relative ${isMe ? 'items-end' : 'items-start'}`}>
                    {/* Всплывающее красное сердечко при двойном клике/тапе */}
                    {heartBurstMsgId === msg.id && (
                      <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 animate-heart-burst">
                        <Heart className="w-12 h-12 text-red-500 fill-red-500 drop-shadow-[0_0_18px_rgba(239,68,68,0.85)]" />
                      </div>
                    )}

                    <div className="flex items-center flex-wrap gap-1 mb-1 px-1">
                      {!isJward && (
                        <>
                          <BadgeList badges={msg.sender.badges} size="sm" />
                          <button
                            type="button"
                            onClick={() => {
                              const found = room.members.find((m) => m.id === msg.sender.id);
                              if (found) onSelectUserMiniProfile(found);
                            }}
                            className="text-xs font-semibold text-jess-textMain hover:text-jess-accent transition"
                          >
                            {renderTextWithIosEmojis(msg.sender.display_name)}
                          </button>
                          {msg.sender.is_verified && <VerifiedBadge size="sm" />}
                        </>
                      )}
                      {isJward && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>
                            jward
                          </span>
                          <VerifiedBadge size="sm" />
                        </div>
                      )}

                      <span className="text-[10px] text-jess-textMuted ml-0.5">
                        {new Date(
                          msg.created_at.endsWith('Z') ? msg.created_at : msg.created_at.replace(' ', 'T') + 'Z'
                        ).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>

                      {msg.is_edited && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isAdmin && msg.edit_history && msg.edit_history.length > 0) {
                              setEditHistoryModalMsg(msg);
                            }
                          }}
                          className={`text-[10px] text-jess-textMuted ${
                            isAdmin ? 'hover:text-white underline cursor-pointer' : ''
                          }`}
                        >
                          изменено
                        </button>
                      )}

                      {msg.is_deleted && isAdmin && (
                        <span className="px-2 py-0.5 rounded-full bg-red-500/25 border border-red-500/40 text-[10px] font-semibold text-red-300">
                          удалено
                        </span>
                      )}

                      {msg.is_pinned && <Pin className="w-3 h-3 text-jess-accent" />}

                      <span
                        title={
                          isReadBySomeone
                            ? `просмотрено: ${formatExactDateTime(msg.read_by?.[0]?.read_at)}`
                            : 'доставлено'
                        }
                        className="inline-flex items-center ml-0.5"
                      >
                        {isReadBySomeone ? (
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-jess-textMuted" />
                        )}
                      </span>

                      {/* Кнопка быстрого меню действий для мобильных устройств */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openMessageMenuAt(e.clientX, e.clientY, msg);
                        }}
                        className="md:opacity-0 md:group-hover:opacity-100 p-0.5 rounded-lg text-jess-textMuted hover:text-white transition"
                        title="действия с сообщением"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {isVideoCircle ? (
                      <div className={isHighlighted ? 'highlighted-message rounded-full p-1' : ''}>
                        <VideoNotePlayer
                          url={msg.file_url!}
                          duration={msg.voice_duration || 1}
                          isAutoPlaying={activePlayingMediaId === msg.id}
                          onPlayStart={() => setActivePlayingMediaId(msg.id)}
                          onPlayEnded={() => handleMediaEnded(msg.id)}
                        />
                      </div>
                    ) : isStickerMsg ? (
                      <div className={`my-1 ${isHighlighted ? 'highlighted-message rounded-2xl p-1' : ''}`}>
                        {isVideoAssetUrl(msg.file_url) ? (
                          <video
                            src={msg.file_url!}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-36 h-36 sm:w-44 sm:h-44 object-contain rounded-2xl pointer-events-none"
                          />
                        ) : (
                          <img
                            src={msg.file_url!}
                            alt="sticker"
                            className="w-36 h-36 sm:w-44 sm:h-44 object-contain rounded-2xl pointer-events-none"
                          />
                        )}
                      </div>
                    ) : isCallMsg ? (() => {
                      let callInfo: { status?: string; durationSec?: number } = {};
                      try { callInfo = JSON.parse(msg.content || '{}'); } catch {}
                      const isMissed = callInfo.status === 'missed' || callInfo.status === 'declined';
                      return (
                        <div
                          className="flex items-center gap-3 px-4 py-2.5 rounded-2xl border border-white/10 shadow-lg"
                          style={{
                            backgroundColor: isMe ? activeRoomTheme.msgOwn : activeRoomTheme.msgOther,
                            color: isMe ? ownBubbleTextColor : otherBubbleTextColor
                          }}
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                            isMissed ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            {isMissed ? <PhoneMissed className="w-4 h-4" /> : <PhoneCall className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="text-xs font-semibold">
                              {callInfo.status === 'completed'
                                ? 'звонок'
                                : callInfo.status === 'declined'
                                ? 'отклоненный звонок'
                                : 'пропущенный звонок'}
                            </div>
                            <div className="text-[11px] opacity-75">
                              {callInfo.status === 'completed'
                                ? `длительность: ${formatCallDuration(callInfo.durationSec || 0)}`
                                : 'не отвечен'}
                            </div>
                          </div>
                        </div>
                      );
                    })() : (
                      <div
                        className={`relative px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl border shadow-lg text-sm break-words transition-all ${
                          isHighlighted
                            ? 'highlighted-message'
                            : msg.is_deleted
                            ? 'border-red-500/40'
                            : 'border-white/[0.08] hover:border-white/15'
                        }`}
                        style={{
                          backgroundColor: isMe ? activeRoomTheme.msgOwn : activeRoomTheme.msgOther,
                          color: isMe ? ownBubbleTextColor : otherBubbleTextColor
                        }}
                      >
                        {msg.forwarded_from && (
                          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] opacity-85">
                            <Forward className="w-3 h-3 shrink-0" />
                            <span>
                              переслано от{' '}
                              <a
                                href={`/@${msg.forwarded_from.sender_username || msg.forwarded_from.sender_display_name}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  window.history.pushState(
                                    {},
                                    '',
                                    `/@${msg.forwarded_from!.sender_username || msg.forwarded_from!.sender_display_name}`
                                  );
                                  window.dispatchEvent(new PopStateEvent('popstate'));
                                }}
                                style={{ color: 'var(--accent-hover)' }}
                                className="font-semibold hover:underline"
                              >
                                @{msg.forwarded_from.sender_username || msg.forwarded_from.sender_display_name}
                              </a>
                            </span>
                          </div>
                        )}

                        {msg.reply_preview && (
                          <div
                            onClick={() => {
                              if (msg.reply_preview?.msg_number) {
                                const el = document.querySelector(`[data-msg-number="${msg.reply_preview.msg_number}"]`);
                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            }}
                            style={{ borderLeftColor: 'var(--accent-hover)' }}
                            className="mb-2 pl-2.5 py-1 border-l-2 bg-black/25 rounded-r-xl text-xs cursor-pointer hover:bg-black/35 transition"
                          >
                            <div className="font-semibold" style={{ color: 'var(--accent-hover)' }}>
                              {renderTextWithIosEmojis(msg.reply_preview.sender_display_name)}
                            </div>
                            <div className="opacity-85 truncate">
                              {renderTextWithIosEmojis(msg.reply_preview.content)}
                            </div>
                          </div>
                        )}

                        {msg.type === 'image' && msg.file_url && (
                          <div className="mb-2 relative group/img">
                            <img
                              src={msg.file_url}
                              alt={msg.file_name || 'изображение'}
                              onClick={() =>
                                setLightboxImage({
                                  url: msg.file_url!,
                                  name: msg.file_name || 'изображение.jpg'
                                })
                              }
                              className="max-h-64 sm:max-h-72 rounded-xl object-cover cursor-zoom-in border border-white/10 hover:opacity-95 transition"
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadMediaFile(msg.file_url!, msg.file_name || 'image.jpg');
                              }}
                              title="скачать изображение"
                              className="opacity-0 group-hover/img:opacity-100 absolute top-2 right-2 p-2 rounded-xl bg-black/75 hover:bg-jess-accent text-white border border-white/15 transition"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            {msg.file_name && (
                              <div className="text-[10px] text-white/70 mt-1 truncate">{msg.file_name}</div>
                            )}
                          </div>
                        )}

                        {msg.type === 'video' && msg.file_url && (
                          <VideoAttachmentPlayer
                            url={msg.file_url}
                            fileName={msg.file_name}
                            fileSize={msg.file_size}
                          />
                        )}

                        {msg.type === 'audio' && msg.file_url && (
                          <AudioAttachmentPlayer
                            url={msg.file_url}
                            fileName={msg.file_name}
                            fileSize={msg.file_size}
                          />
                        )}

                        {msg.type === 'file' && msg.file_url && (
                          <div
                            onClick={() => downloadMediaFile(msg.file_url!, msg.file_name || 'file')}
                            className="flex items-center gap-3 p-2.5 mb-1.5 rounded-xl bg-black/30 border border-white/10 hover:border-jess-accent/60 cursor-pointer transition"
                          >
                            <FileText className="w-5 h-5 text-jess-accent shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-white truncate">
                                {msg.file_name || 'Файл'}
                              </div>
                              <div className="text-[10px] text-jess-textMuted">
                                {formatFileSize(msg.file_size) || 'скачать файл'}
                              </div>
                            </div>
                            <Download className="w-4 h-4 text-jess-accent shrink-0" />
                          </div>
                        )}

                        {msg.type === 'voice' && msg.file_url && (
                          <VoiceMessagePlayer
                            url={msg.file_url}
                            fileName={msg.file_name}
                            waveform={msg.voice_waveform || []}
                            duration={msg.voice_duration || 1}
                            isAutoPlaying={activePlayingMediaId === msg.id}
                            onPlayStart={() => setActivePlayingMediaId(msg.id)}
                            onPlayEnded={() => handleMediaEnded(msg.id)}
                          />
                        )}

                        {msg.content && msg.type !== 'voice' && msg.type !== 'video_note' && (
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {renderTextWithIosEmojis(msg.content)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Реакции под сообщением (красное сердечко подсвечивается красным свечением!) */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {msg.reactions.map((r) => {
                          const iReacted = r.users.some((u) => u.id === currentUser.id);
                          const isRedHeart = r.emoji === '❤️' || r.emoji === '❤';
                          return (
                            <button
                              key={r.emoji}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isRedHeart) {
                                  handleDoubleTapHeart(msg);
                                } else {
                                  socket.emit('message:toggle_reaction', {
                                    messageId: msg.id,
                                    emoji: r.emoji
                                  });
                                }
                              }}
                              title={r.users.map((u) => u.display_name).join(', ')}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs border transition ${
                                iReacted
                                  ? isRedHeart
                                    ? 'bg-red-500/25 border-red-500/60 text-red-100 shadow-[0_0_12px_rgba(239,68,68,0.4)]'
                                    : 'bg-jess-accent/25 border-jess-accent text-white soft-glow'
                                  : 'bg-white/[0.04] border-white/10 text-jess-textMuted hover:text-white'
                              }`}
                            >
                              {isRedHeart ? (
                                <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 shrink-0" />
                              ) : (
                                <IosEmoji emoji={r.emoji} size={14} />
                              )}
                              <span className="font-semibold text-[11px]">{r.users.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Боковая панель участников (на мобильных — оверлей на весь экран, на ПК — сайдбар) */}
        {showMembersDrawer && room.is_group && (!isJward || isAdmin) && (
          <>
            <div
              onMouseDown={startResizeMembersDrawer}
              title="потяните влево или вправо для изменения ширины"
              className="hidden md:block resize-handle-x"
            />
            <div
              style={{ width: window.innerWidth < 768 ? '100%' : `${membersDrawerWidth}px` }}
              className="fixed inset-0 z-40 md:static md:z-auto border-l border-white/[0.06] glass-panel p-4 overflow-y-auto shrink-0 animate-menu-in flex flex-col"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-jess-textMuted">
                  участники ({room.members.length})
                </h3>
                <div className="flex items-center gap-2">
                  {!isJward && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddGroupMemberModal(true);
                        setMemberSearchQuery('');
                        setMemberSearchResults([]);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-jess-accent/20 hover:bg-jess-accent text-white text-[11px] transition"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>добавить</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowMembersDrawer(false)}
                    className="md:hidden p-1.5 rounded-xl bg-white/10 text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 flex-1 overflow-y-auto">
                {room.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      setShowMembersDrawer(false);
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
          </>
        )}
      </div>

      {/* Панель закрепленного сообщения снизу */}
      {pinnedBarPosition === 'bottom' && renderPinnedBar()}

      {/* Запись видеокружка */}
      {isRecordingVideoNote && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-menu-in">
          <div className="relative w-64 h-64 rounded-full overflow-hidden border-4 border-jess-accent neon-glow bg-black flex items-center justify-center">
            <video
              ref={videoNotePreviewRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover scale-x-[-1]"
            />
            <div className="absolute top-4 px-3 py-1 rounded-full bg-black/70 border border-white/10 flex items-center gap-1.5 text-xs font-mono text-white">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span>{videoNoteSeconds} с</span>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              onClick={flipVideoNoteCamera}
              title="перевернуть камеру"
              className="p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => stopAndSendVideoNote(true)}
              className="px-5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-xs text-white transition"
            >
              отмена
            </button>
            <button
              type="button"
              onClick={() => stopAndSendVideoNote(false)}
              className="px-6 py-2.5 rounded-2xl cta-music-btn text-white text-xs font-semibold transition"
            >
              отправить кружок
            </button>
          </div>
        </div>
      )}

      {/* Индикатор «печатает...» */}
      {typingNames.length > 0 && (
        <div className="px-4 sm:px-6 py-1 text-xs bg-jess-bg/90 z-10" style={{ color: 'var(--accent-hover)' }}>
          {typingNames.join(', ')} {typingNames.length === 1 ? 'печатает...' : 'печатают...'}
        </div>
      )}

      {/* Плашка ответа (Reply) или Редактирования (Edit) */}
      {(replyTo || editingMessage) && (
        <div className="px-4 sm:px-6 py-2 bg-white/[0.04] border-t border-white/10 flex items-center justify-between text-xs z-20">
          <div className="truncate">
            {editingMessage ? (
              <>
                <span className="font-semibold text-amber-300">редактирование сообщения: </span>
                <span className="text-jess-textMuted">
                  {renderTextWithIosEmojis(formatAttachmentPreviewText(editingMessage))}
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold" style={{ color: 'var(--accent-hover)' }}>
                  ответ {replyTo!.sender.display_name}:{' '}
                </span>
                <span className="text-jess-textMuted">
                  {renderTextWithIosEmojis(formatAttachmentPreviewText(replyTo))}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setReplyTo(null);
              if (editingMessage) {
                setEditingMessage(null);
                setInputText('');
              }
            }}
            className="p-1 text-jess-textMuted hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Окно предпросмотра прикрепленных медиафайлов перед отправкой */}
      {pendingAttachments.length > 0 && (
        <div className="px-3 sm:px-5 py-3 bg-black/65 backdrop-blur-xl border-t border-jess-accent/40 z-20 animate-menu-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-white truncate">
              прикрепленные файлы ({pendingAttachments.length}) — можно добавить подпись ниже
            </span>
            <button
              type="button"
              onClick={() => {
                pendingAttachments.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                setPendingAttachments([]);
              }}
              className="text-xs text-red-300 hover:text-red-200 shrink-0 ml-2"
            >
              очистить всё
            </button>
          </div>
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
            {pendingAttachments.map((item) => (
              <div
                key={item.id}
                className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-jess-surface border border-white/15 shrink-0 flex flex-col items-center justify-center group"
              >
                {item.kind === 'image' ? (
                  <img src={item.previewUrl} alt={item.file.name} className="w-full h-full object-cover" />
                ) : item.kind === 'video' ? (
                  <video src={item.previewUrl} className="w-full h-full object-cover" muted />
                ) : item.kind === 'audio' ? (
                  <div className="flex flex-col items-center justify-center p-2 text-center">
                    <Music className="w-6 h-6 text-jess-accent mb-1" />
                    <span className="text-[10px] text-white truncate w-16 sm:w-20">{item.file.name}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-2 text-center">
                    <FileText className="w-6 h-6 text-jess-accent mb-1" />
                    <span className="text-[10px] text-white truncate w-16 sm:w-20">{item.file.name}</span>
                  </div>
                )}

                <div className="absolute bottom-0 inset-x-0 bg-black/70 px-1.5 py-0.5 text-[9px] text-white truncate">
                  {item.file.name}
                </div>

                <button
                  type="button"
                  onClick={() => removeStagedAttachment(item.id)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-black/80 hover:bg-red-500 text-white transition"
                  title="убрать файл"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border border-dashed border-white/20 hover:border-jess-accent flex flex-col items-center justify-center gap-1 text-jess-textMuted hover:text-white transition shrink-0"
            >
              <Plus className="w-5 h-5" />
              <span className="text-[10px]">ещё файл</span>
            </button>
          </div>
        </div>
      )}

      {/* Скрытый input для загрузки стикера */}
      <input
        ref={stickerFileInputRef}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime,.gif,.webp,.apng"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          const packId = targetStickerPackIdRef.current;
          e.target.value = '';
          if (!file || !packId) return;
          setUploadingStickerPackId(packId);
          try {
            const up = await uploadFileInChunks(file, 'stickers');
            await apiRequest(`/chat/stickers/packs/${packId}/items`, {
              method: 'POST',
              body: JSON.stringify({ chunkedFileUrl: up.fileUrl })
            });
            showTopToast('стикер добавлен!');
          } catch (err: any) {
            showTopToast(err.message || 'ошибка загрузки стикера', 'error');
          } finally {
            setUploadingStickerPackId(null);
          }
        }}
      />

      {/* Панель выбора iOS-эмодзи и стикерпаков */}
      {showEmojiPicker && (
        <div className="absolute bottom-20 left-2 right-2 sm:left-6 sm:right-auto sm:w-80 max-h-80 rounded-3xl glass-panel border border-white/15 shadow-2xl flex flex-col overflow-hidden animate-menu-in z-40">
          <div className="grid grid-cols-2 p-1.5 border-b border-white/10 bg-black/30 shrink-0">
            <button
              type="button"
              onClick={() => setPickerTab('emoji')}
              className={`py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                pickerTab === 'emoji' ? 'cta-music-btn text-white' : 'text-jess-textMuted hover:text-white'
              }`}
            >
              <Smile className="w-3.5 h-3.5" />
              <span>эмодзи</span>
            </button>
            <button
              type="button"
              onClick={() => setPickerTab('stickers')}
              className={`py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                pickerTab === 'stickers' ? 'cta-music-btn text-white' : 'text-jess-textMuted hover:text-white'
              }`}
            >
              <Sticker className="w-3.5 h-3.5" />
              <span>стикеры ({stickerPacks.length})</span>
            </button>
          </div>

          {pickerTab === 'emoji' ? (
            <div className="p-3 overflow-y-auto grid grid-cols-7 gap-1.5">
              {IOS_EMOJI_CATALOG.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => {
                    setInputText((prev) => prev + em);
                    textareaInputRef.current?.focus();
                  }}
                  className="p-1.5 rounded-xl hover:bg-white/10 flex items-center justify-center transition hover:scale-110"
                >
                  <IosEmoji emoji={em} size={22} />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-3 overflow-y-auto space-y-3">
              {/* Создание нового стикерпака */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="новый набор стикеров..."
                  value={newStickerPackName}
                  onChange={(e) => setNewStickerPackName(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-jess-accent"
                />
                <button
                  type="button"
                  disabled={creatingPack || !newStickerPackName.trim()}
                  onClick={async () => {
                    if (!newStickerPackName.trim()) return;
                    setCreatingPack(true);
                    try {
                      await apiRequest('/chat/stickers/packs', {
                        method: 'POST',
                        body: JSON.stringify({ name: newStickerPackName.trim() })
                      });
                      setNewStickerPackName('');
                      showTopToast('набор стикеров создан!');
                    } catch (err: any) {
                      showTopToast(err.message || 'ошибка создания набора', 'error');
                    } finally {
                      setCreatingPack(false);
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-xl cta-music-btn text-white text-xs font-semibold disabled:opacity-50"
                >
                  +
                </button>
              </div>

              {stickerPacks.length === 0 ? (
                <div className="py-6 text-center text-xs text-jess-textMuted">
                  пока нет стикерпаков — создайте свой выше!
                </div>
              ) : (
                stickerPacks.map((pack) => {
                  const canEditPack = pack.owner_id === currentUser.id || isAdmin;
                  return (
                    <div key={pack.id} className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white truncate">{pack.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {canEditPack && (
                            <>
                              <button
                                type="button"
                                disabled={uploadingStickerPackId === pack.id}
                                onClick={() => {
                                  targetStickerPackIdRef.current = pack.id;
                                  stickerFileInputRef.current?.click();
                                }}
                                title="добавить стикер (фото/gif/видео без звука)"
                                className="px-2 py-0.5 rounded-lg bg-jess-accent/25 hover:bg-jess-accent text-[10px] text-white transition"
                              >
                                {uploadingStickerPackId === pack.id ? '...' : '+ стикер'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!window.confirm(`удалить набор «${pack.name}»?`)) return;
                                  try {
                                    await apiRequest(`/chat/stickers/packs/${pack.id}`, { method: 'DELETE' });
                                    showTopToast('набор удален');
                                  } catch (err: any) {
                                    showTopToast(err.message, 'error');
                                  }
                                }}
                                title="удалить набор"
                                className="p-1 rounded-lg hover:bg-red-500/20 text-red-300 transition"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {pack.stickers.length === 0 ? (
                        <div className="text-[10px] text-jess-textMuted">пусто</div>
                      ) : (
                        <div className="grid grid-cols-4 gap-1.5">
                          {pack.stickers.map((st) => (
                            <div key={st.id} className="relative group/stk aspect-square rounded-xl bg-black/40 border border-white/5 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  socket.emit('message:send_sticker', {
                                    roomId: room.id,
                                    fileUrl: st.file_url,
                                    replyToId: replyTo?.id || undefined
                                  });
                                  setReplyTo(null);
                                  setShowEmojiPicker(false);
                                }}
                                className="w-full h-full p-1 hover:scale-105 transition flex items-center justify-center"
                              >
                                {st.is_video || isVideoAssetUrl(st.file_url) ? (
                                  <video
                                    src={st.file_url}
                                    autoPlay
                                    loop
                                    muted
                                    playsInline
                                    className="w-full h-full object-contain pointer-events-none"
                                  />
                                ) : (
                                  <img
                                    src={st.file_url}
                                    alt="sticker"
                                    className="w-full h-full object-contain pointer-events-none"
                                  />
                                )}
                              </button>
                              {canEditPack && (
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await apiRequest(`/chat/stickers/${st.id}`, { method: 'DELETE' });
                                    } catch {}
                                  }}
                                  className="opacity-0 group-hover/stk:opacity-100 absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/80 text-red-300 hover:bg-red-500 hover:text-white transition"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* Панель ввода сообщения */}
      {!canPostInRoom ? (
        <div className="px-4 sm:px-6 py-4 border-t border-white/[0.06] glass-panel flex items-center justify-center gap-2 text-xs text-jess-textMuted z-20">
          <Lock className="w-3.5 h-3.5 text-jess-accent" />
          <span>канал jward • публиковать сообщения может только администратор</span>
        </div>
      ) : (
        <form
          onSubmit={handleSendMessage}
          className="px-2.5 sm:px-5 py-2.5 sm:py-3 border-t border-white/[0.06] glass-panel flex items-end gap-1.5 sm:gap-2 relative z-20"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileAttachment}
            className="hidden"
          />

          {!isRecordingVoice && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="прикрепить медиа или файл"
                className="p-2 sm:p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] text-jess-textMuted hover:text-white border border-white/10 transition shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title="эмодзи"
                className={`p-2 sm:p-2.5 rounded-2xl border transition shrink-0 ${
                  showEmojiPicker
                    ? 'bg-jess-accent text-white border-jess-accent'
                    : 'bg-white/[0.04] hover:bg-white/[0.09] text-jess-textMuted hover:text-white border-white/10'
                }`}
              >
                <Smile className="w-4 h-4" />
              </button>
            </>
          )}

          {isRecordingVoice ? (
            <div className="flex-1 flex items-center justify-between px-3 sm:px-4 py-2 rounded-2xl bg-black/50 border border-jess-accent/50 text-xs text-white animate-menu-in">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    isVoicePaused ? 'bg-amber-400' : 'bg-red-500 animate-ping'
                  }`}
                />
                <span className="font-medium truncate">
                  {isVoicePaused ? 'пауза' : 'запись...'} {recordingSeconds} с
                </span>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={cancelVoiceRecording}
                  title="отменить запись"
                  className="p-2 rounded-xl bg-white/10 hover:bg-red-500/30 text-red-300 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={togglePauseResumeVoice}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition"
                >
                  {isVoicePaused ? (
                    <>
                      <Play className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="hidden sm:inline">продолжить</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5 text-amber-300" />
                      <span className="hidden sm:inline">пауза</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={finishAndSendVoiceRecording}
                  className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl cta-music-btn text-white font-semibold transition"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">отправить</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <textarea
                ref={textareaInputRef}
                rows={1}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitCurrentMessage();
                  } else if (e.key === 'ArrowUp' && !inputText.trim() && !editingMessage && pendingAttachments.length === 0) {
                    const myLastMsg = [...messages]
                      .reverse()
                      .find((m) => m.sender_id === currentUser.id && m.type === 'text' && !m.is_deleted);
                    if (myLastMsg) {
                      e.preventDefault();
                      setEditingMessage(myLastMsg);
                      setInputText(myLastMsg.content);
                    }
                  }
                }}
                placeholder="написать сообщение..."
                className="flex-1 min-w-0 max-h-32 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl bg-black/40 border border-white/10 text-sm text-white focus:outline-none neon-border-focus resize-none"
              />

              {!editingMessage && pendingAttachments.length === 0 && (
                <>
                  <button
                    type="button"
                    onClick={startVoiceRecording}
                    title="голосовое сообщение"
                    className="p-2 sm:p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] text-jess-textMuted hover:text-white border border-white/10 transition shrink-0"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startVideoNoteRecording()}
                    title="видеосообщение (кружок)"
                    className="p-2 sm:p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] text-jess-textMuted hover:text-white border border-white/10 transition shrink-0"
                  >
                    <Video className="w-4 h-4" />
                  </button>
                </>
              )}

              <button
                type="submit"
                className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl cta-music-btn text-white font-semibold text-xs flex items-center gap-1.5 transition shrink-0"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">{editingMessage ? 'сохранить' : 'отправить'}</span>
              </button>
            </>
          )}
        </form>
      )}

      {/* Контекстное меню ПКМ / удержания на сообщении */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          className="fixed z-50 w-72 max-w-[92vw] rounded-2xl glass-panel border border-white/15 shadow-2xl p-2 animate-menu-in max-h-[82dvh] overflow-y-auto"
        >
          <div className="flex items-center justify-between px-1.5 py-1.5 mb-1 border-b border-white/10">
            <button
              type="button"
              onClick={() => {
                handleDoubleTapHeart(contextMenu.message);
                setContextMenu(null);
              }}
              className="hover:scale-125 transition p-0.5"
              title="красное сердечко (двойной клик)"
            >
              <Heart className="w-4 h-4 text-red-500 fill-red-500" />
            </button>
            {QUICK_REACTIONS.slice(1, 6).map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => {
                  socket.emit('message:toggle_reaction', {
                    messageId: contextMenu.message.id,
                    emoji: em
                  });
                  setContextMenu(null);
                }}
                className="hover:scale-125 transition p-0.5"
              >
                <IosEmoji emoji={em} size={18} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowAllReactionsInMenu(!showAllReactionsInMenu)}
              title="выбрать любое эмодзи"
              className="w-6 h-6 rounded-lg bg-white/10 hover:bg-jess-accent text-white flex items-center justify-center transition"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {showAllReactionsInMenu && (
            <div className="mb-2 p-2 rounded-xl bg-black/50 border border-white/10 space-y-2">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Вставьте любое эмодзи..."
                  value={customReactionInput}
                  onChange={(e) => setCustomReactionInput(e.target.value)}
                  className="flex-1 px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-white focus:outline-none"
                />
                {customReactionInput.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      socket.emit('message:toggle_reaction', {
                        messageId: contextMenu.message.id,
                        emoji: customReactionInput.trim()
                      });
                      setContextMenu(null);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-jess-accent text-white text-xs font-semibold"
                  >
                    ок
                  </button>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto grid grid-cols-7 gap-1">
                {IOS_EMOJI_CATALOG.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      socket.emit('message:toggle_reaction', {
                        messageId: contextMenu.message.id,
                        emoji: em
                      });
                      setContextMenu(null);
                    }}
                    className="p-1 rounded-lg hover:bg-white/10 flex items-center justify-center"
                  >
                    <IosEmoji emoji={em} size={18} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Информация о прочтении (в канале jward видит только админ!) */}
          {(!isJward || isAdmin) && (
          <div className="px-2.5 py-2 mb-1 rounded-xl bg-white/[0.03] border border-white/5 text-[11px]">
            {contextMenu.message.read_by && contextMenu.message.read_by.length > 0 ? (
              room.is_group ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowReadListInMenu(!showReadListInMenu)}
                    className="w-full flex items-center justify-between text-emerald-300 font-medium"
                  >
                    <span className="flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      <span>просмотрели: {contextMenu.message.read_by.length}</span>
                    </span>
                    <span className="text-[10px] underline">
                      {showReadListInMenu ? 'скрыть' : 'кто и когда'}
                    </span>
                  </button>
                  {showReadListInMenu && (
                    <div className="mt-2 max-h-32 overflow-y-auto space-y-1 border-t border-white/10 pt-1.5">
                      {contextMenu.message.read_by.map((r) => (
                        <div key={r.user_id} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-white font-medium truncate">{r.display_name}</span>
                          <span className="text-jess-textMuted shrink-0">
                            {formatExactDateTime(r.read_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-emerald-300">
                  <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-normal break-words leading-snug">просмотрено: {formatExactDateTime(contextMenu.message.read_by[0].read_at)}</span>
                </div>
              )
            ) : (
              <div className="flex items-center gap-1.5 text-jess-textMuted">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>еще не просмотрено</span>
              </div>
            )}
          </div>
          )}

          {canPostInRoom && (
            <button
              type="button"
              onClick={() => {
                setReplyTo(contextMenu.message);
                setEditingMessage(null);
                setContextMenu(null);
                textareaInputRef.current?.focus();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
            >
              <Reply className="w-3.5 h-3.5 text-jess-accent" />
              <span>ответить</span>
            </button>
          )}

          {contextMenu.message.file_url && (
            <button
              type="button"
              onClick={() => {
                downloadMediaFile(
                  contextMenu.message.file_url!,
                  contextMenu.message.file_name ||
                    (contextMenu.message.type === 'voice'
                      ? 'voice.webm'
                      : contextMenu.message.type === 'video_note'
                      ? 'video_note.webm'
                      : 'media')
                );
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-emerald-300 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>скачать медиафайл</span>
            </button>
          )}

          {(contextMenu.message.sender.id === currentUser.id || isAdmin) &&
            contextMenu.message.type === 'text' &&
            !contextMenu.message.is_deleted && (
              <button
                type="button"
                onClick={() => {
                  setEditingMessage(contextMenu.message);
                  setInputText(contextMenu.message.content);
                  setReplyTo(null);
                  setContextMenu(null);
                  textareaInputRef.current?.focus();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
              >
                <Edit3 className="w-3.5 h-3.5 text-amber-300" />
                <span>изменить сообщение</span>
              </button>
            )}

          {isAdmin &&
            contextMenu.message.edit_history &&
            contextMenu.message.edit_history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setEditHistoryModalMsg(contextMenu.message);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-amber-200 transition"
              >
                <History className="w-3.5 h-3.5 text-amber-300" />
                <span>история изменений ({contextMenu.message.edit_history.length})</span>
              </button>
            )}

          <button
            type="button"
            onClick={() => {
              setForwardModalMsg(contextMenu.message);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
          >
            <Forward className="w-3.5 h-3.5 text-jess-accent" />
            <span>переслать</span>
          </button>

          {canPostInRoom && (
            <button
              type="button"
              onClick={() => {
                socket.emit('message:toggle_pin', { messageId: contextMenu.message.id });
                showTopToast(
                  contextMenu.message.is_pinned ? 'сообщение откреплено' : 'сообщение закреплено!',
                  'success'
                );
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
            >
              <Pin className="w-3.5 h-3.5 text-jess-accent" />
              <span>{contextMenu.message.is_pinned ? 'открепить' : 'закрепить'}</span>
            </button>
          )}

          {contextMenu.message.content && (
            <button
              type="button"
              onClick={() => {
                copyTextWithToast(contextMenu.message.content, 'текст сообщения скопирован!');
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
            >
              <Copy className="w-3.5 h-3.5 text-jess-accent" />
              <span>копировать текст</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              copyTextWithToast(
                `https://mered.ro/@${roomSlug}/${contextMenu.message.msg_number}`,
                `ссылка mered.ro/@${roomSlug}/${contextMenu.message.msg_number} скопирована!`
              );
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/10 text-xs text-white transition"
          >
            <ExternalLink className="w-3.5 h-3.5 text-jess-accent shrink-0" />
            <span>копировать ссылку</span>
          </button>

          {(contextMenu.message.sender.id === currentUser.id || isAdmin) &&
            !contextMenu.message.is_deleted && (
              <button
                type="button"
                onClick={() => {
                  socket.emit('message:delete', { messageId: contextMenu.message.id });
                  showTopToast('сообщение удалено у обоих', 'info');
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-red-500/20 text-xs text-red-300 transition mt-1 border-t border-white/5"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>удалить у обоих</span>
              </button>
            )}
        </div>
      )}

      {/* Модальное окно истории изменений сообщения */}
      {editHistoryModalMsg && (
        <div
          onClick={() => setEditHistoryModalMsg(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-menu-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-panel border border-white/10 rounded-3xl w-full max-w-md p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">история изменений сообщения</h4>
              <button
                onClick={() => setEditHistoryModalMsg(null)}
                className="p-1 text-jess-textMuted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {editHistoryModalMsg.edit_history?.map((item, i) => (
                <div
                  key={item.id || i}
                  className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs space-y-1"
                >
                  <div className="text-[10px] text-jess-textMuted">
                    версия #{i + 1} • {formatExactDateTime(item.edited_at)}
                  </div>
                  <div className="text-white whitespace-pre-wrap">
                    {renderTextWithIosEmojis(item.old_content)}
                  </div>
                </div>
              ))}

              <div className="p-3 rounded-2xl bg-white/[0.06] border border-jess-accent/40 text-xs space-y-1">
                <div className="text-[10px] text-jess-accent">текущая версия</div>
                <div className="text-white whitespace-pre-wrap">
                  {renderTextWithIosEmojis(editHistoryModalMsg.content)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGroupProfileModal && (
        <GroupProfileModal
          room={room}
          currentUser={currentUser}
          contacts={contacts}
          onClose={() => setShowGroupProfileModal(false)}
          onUpdated={onRefreshRooms}
          onDeletedRoom={() => {
            setShowGroupProfileModal(false);
            onRoomDeleted();
          }}
          onOpenRoomTheme={() => {
            setShowGroupProfileModal(false);
            setShowRoomThemeModal(true);
          }}
          onSelectUserMiniProfile={(u) => {
            setShowGroupProfileModal(false);
            onSelectUserMiniProfile(u);
          }}
        />
      )}

      {showRoomThemeModal && (
        <ThemeCustomizerModal
          currentTheme={activeRoomTheme}
          roomId={room.id}
          roomName={room.name}
          onClose={() => setShowRoomThemeModal(false)}
          onSaveTheme={() => {}}
          onRoomThemeUpdated={() => {
            onRefreshRooms();
          }}
        />
      )}

      {forwardModalMsg && (
        <div
          onClick={() => setForwardModalMsg(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4 animate-menu-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-panel border border-white/10 rounded-3xl w-full max-w-sm p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">переслать сообщение</h4>
              <button
                onClick={() => setForwardModalMsg(null)}
                className="p-1 text-jess-textMuted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded-2xl bg-black/30 border border-white/5 text-xs text-jess-textMuted truncate">
              {renderTextWithIosEmojis(formatAttachmentPreviewText(forwardModalMsg))}
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {allRooms
                .filter((r) => !(r.is_jward && !isAdmin))
                .map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleForwardToRoom(r.id)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.03] hover:bg-jess-accent/20 border border-white/5 hover:border-jess-accent/40 text-left transition"
                  >
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-jess-surface flex items-center justify-center text-xs font-semibold text-jess-accent shrink-0">
                      {r.is_saved ? (
                        <Bookmark className="w-4 h-4 text-jess-accent" />
                      ) : r.avatar_url ? (
                        <AvatarMedia src={r.avatar_url} alt={r.name} />
                      ) : (
                        r.name.slice(0, 2)
                      )}
                    </div>
                    <span className="text-xs font-semibold text-white truncate">{r.name}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {showAddGroupMemberModal && (
        <div
          onClick={() => setShowAddGroupMemberModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4 animate-menu-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-panel border border-white/10 rounded-3xl w-full max-w-sm p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">добавить в группу</h4>
              <button
                onClick={() => setShowAddGroupMemberModal(false)}
                className="p-1 text-jess-textMuted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="text"
              placeholder="Введите имя или @юзернейм..."
              value={memberSearchQuery}
              onChange={(e) => handleSearchAddMembers(e.target.value)}
              className="w-full px-3.5 py-2 rounded-2xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none neon-border-focus"
            />

            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {(memberSearchQuery.trim()
                ? memberSearchResults
                : contacts.filter((c) => !room.members.some((m) => m.id === c.id))
              ).map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between p-2 rounded-2xl bg-white/[0.03] border border-white/5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-jess-surface flex items-center justify-center text-xs font-semibold text-jess-accent shrink-0">
                      {u.avatar_url ? (
                        <AvatarMedia src={u.avatar_url} alt={u.display_name} />
                      ) : (
                        u.display_name.slice(0, 2)
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center">
                        <BadgeList badges={u.badges} size="sm" />
                        <div className="text-xs font-semibold text-white truncate">{u.display_name}</div>
                        {u.is_verified && <VerifiedBadge size="sm" />}
                      </div>
                      <div className="text-[10px] text-jess-textMuted truncate">@{u.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddMemberToGroup(u.id)}
                    className="px-3 py-1 rounded-xl bg-jess-accent text-white text-xs font-semibold"
                  >
                    добавить
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-4"
        >
          <img
            src={lightboxImage.url}
            alt={lightboxImage.name}
            className="max-w-full max-h-[82dvh] rounded-2xl object-contain shadow-2xl border border-white/10"
          />
          <div className="mt-3 flex items-center gap-4">
            <span className="text-xs text-white truncate max-w-[200px] sm:max-w-md">{lightboxImage.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadMediaFile(lightboxImage.url, lightboxImage.name);
              }}
              className="px-4 py-1.5 rounded-xl cta-music-btn text-white text-xs font-semibold"
            >
              скачать
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
