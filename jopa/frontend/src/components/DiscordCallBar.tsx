import React, { useEffect, useState } from 'react';
import {
  Mic,
  MicOff,
  Headphones,
  VolumeX,
  Settings,
  LogOut,
  PhoneOff,
  Video,
  VideoOff,
  MonitorUp,
  ChevronDown,
  Wifi,
  SlidersHorizontal,
  PictureInPicture2
} from 'lucide-react';
import { NoiseSuppressionMode, UserProfile } from '../types';
import { AvatarMedia, BadgeList, VerifiedBadge } from './BadgeList';

interface DiscordCallBarProps {
  user: UserProfile;
  inCall: boolean;
  callRoomName?: string;
  pingMs: number | null;
  isMicMuted: boolean;
  isDeafened: boolean;
  isWebcamOn: boolean;
  isScreenSharing: boolean;
  isFloatingWindow: boolean;
  noiseMode: NoiseSuppressionMode;
  micThreshold: number;
  selectedMicId: string;
  selectedCamId: string;
  getMicLevel?: () => number;
  onJumpToCallRoom: () => void;
  onToggleFloatingWindow: () => void;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onToggleWebcam: () => void;
  onToggleScreenShare: () => void;
  onLeaveCall: () => void;
  onChangeNoiseSettings: (mode: NoiseSuppressionMode, threshold: number) => void;
  onSelectMicDevice: (deviceId: string) => void;
  onSelectCamDevice: (deviceId: string) => void;
  onOpenProfileSettings: () => void;
  onLogout: () => void;
}

export const DiscordCallBar: React.FC<DiscordCallBarProps> = ({
  user,
  inCall,
  callRoomName,
  pingMs,
  isMicMuted,
  isDeafened,
  isWebcamOn,
  isScreenSharing,
  isFloatingWindow,
  noiseMode,
  micThreshold,
  selectedMicId,
  selectedCamId,
  getMicLevel,
  onJumpToCallRoom,
  onToggleFloatingWindow,
  onToggleMic,
  onToggleDeafen,
  onToggleWebcam,
  onToggleScreenShare,
  onLeaveCall,
  onChangeNoiseSettings,
  onSelectMicDevice,
  onSelectCamDevice,
  onOpenProfileSettings,
  onLogout
}) => {
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [liveMicLevel, setLiveMicLevel] = useState(0);

  useEffect(() => {
    if (!showAudioMenu) return;
    const loadDevices = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        setMics(list.filter((d) => d.kind === 'audioinput'));
        setCams(list.filter((d) => d.kind === 'videoinput'));
      } catch {
        // ignore
      }
    };
    loadDevices();

    const timer = setInterval(() => {
      if (getMicLevel) {
        setLiveMicLevel(getMicLevel());
      }
    }, 60);
    return () => clearInterval(timer);
  }, [showAudioMenu, getMicLevel]);

  const pingColor =
    pingMs === null
      ? 'text-emerald-400'
      : pingMs < 90
      ? 'text-emerald-400'
      : pingMs < 180
      ? 'text-amber-300'
      : 'text-red-400';

  return (
    <div className="relative border-t border-white/[0.06] bg-black/35 shrink-0 select-none">
      {/* Всплывающее меню настроек шумодава, порога и устройств */}
      {showAudioMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full left-2 right-2 mb-2 p-4 rounded-2xl glass-panel border border-jess-accent/45 shadow-2xl z-50 space-y-3.5 animate-menu-in"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-jess-accentHover" />
              <span>звук, шумодав и устройства</span>
            </span>
            <button
              type="button"
              onClick={() => setShowAudioMenu(false)}
              className="text-[11px] text-jess-textMuted hover:text-white"
            >
              закрыть
            </button>
          </div>

          {/* Выбор микрофона */}
          <div>
            <label className="block text-[10px] text-jess-textMuted mb-1">микрофон</label>
            <select
              value={selectedMicId}
              onChange={(e) => onSelectMicDevice(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-jess-accent preserve-case"
            >
              <option value="">по умолчанию</option>
              {mics.map((m, i) => (
                <option key={m.deviceId || i} value={m.deviceId}>
                  {m.label || `Микрофон ${i + 1}`}
                </option>
              ))}
            </select>
          </div>

          {/* Выбор камеры */}
          <div>
            <label className="block text-[10px] text-jess-textMuted mb-1">веб-камера</label>
            <select
              value={selectedCamId}
              onChange={(e) => onSelectCamDevice(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-jess-accent preserve-case"
            >
              <option value="">по умолчанию</option>
              {cams.map((c, i) => (
                <option key={c.deviceId || i} value={c.deviceId}>
                  {c.label || `Камера ${i + 1}`}
                </option>
              ))}
            </select>
          </div>

          {/* Режим шумоподавления */}
          <div>
            <label className="block text-[10px] text-jess-textMuted mb-1">шумоподавление</label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/50 border border-white/10 text-[11px]">
              {(
                [
                  { id: 'off', label: 'выкл' },
                  { id: 'medium', label: 'среднее' },
                  { id: 'strong', label: 'сильное' }
                ] as { id: NoiseSuppressionMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeNoiseSettings(opt.id, micThreshold)}
                  className={`py-1.5 rounded-lg font-medium transition ${
                    noiseMode === opt.id
                      ? 'cta-music-btn text-white'
                      : 'text-jess-textMuted hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Порог срабатывания микрофона */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-jess-textMuted mb-1">
              <span>порог микрофона</span>
              <span className="font-mono text-white">{micThreshold}%</span>
            </div>
            <div className="relative h-2 rounded-full bg-white/10 overflow-hidden mb-1.5">
              <div
                className="h-full transition-all duration-75 rounded-full"
                style={{
                  width: `${liveMicLevel}%`,
                  backgroundColor: liveMicLevel >= micThreshold ? '#34d399' : '#9890b0'
                }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-jess-accentHover"
                style={{ left: `${micThreshold}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={micThreshold}
              onChange={(e) => onChangeNoiseSettings(noiseMode, Number(e.target.value))}
              className="w-full accent-jess-accent cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Секция активного звонка (как в Discord снизу слева) */}
      {inCall && (
        <div className="px-3 pt-2.5 pb-2 border-b border-white/[0.06] space-y-2 animate-menu-in">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onJumpToCallRoom}
              className="flex items-center gap-2 min-w-0 text-left group"
              title="вернуться в чат звонка"
            >
              <div className="w-7 h-7 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Wifi className={`w-3.5 h-3.5 ${pingColor}`} />
              </div>
              <div className="min-w-0">
                <div className={`text-[11px] font-semibold flex items-center gap-1.5 ${pingColor}`}>
                  <span>голосовая связь подключена</span>
                  {pingMs !== null && (
                    <span className="text-[10px] font-mono opacity-90">{pingMs} мс</span>
                  )}
                </div>
                <div className="text-[11px] text-jess-textMuted group-hover:text-white truncate transition">
                  {callRoomName || 'звонок'}
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowAudioMenu((v) => !v)}
                title="настройки звука и шумодава"
                className={`p-1.5 rounded-xl transition ${
                  showAudioMenu
                    ? 'bg-jess-accent text-white'
                    : 'text-jess-textMuted hover:text-white hover:bg-white/10'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onLeaveCall}
                title="отключиться от звонка"
                className="p-1.5 rounded-xl text-red-400 hover:text-white hover:bg-red-500/80 transition"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={onToggleWebcam}
              title="камера"
              className={`py-1.5 rounded-xl flex items-center justify-center border transition ${
                isWebcamOn
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/10 text-jess-textMuted hover:text-white'
              }`}
            >
              {isWebcamOn ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onToggleScreenShare}
              title="демонстрация экрана"
              className={`py-1.5 rounded-xl flex items-center justify-center border transition ${
                isScreenSharing
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/10 text-jess-textMuted hover:text-white'
              }`}
            >
              <MonitorUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleFloatingWindow}
              title={isFloatingWindow ? 'свернуть плавающее окно' : 'показать в отдельном окне'}
              className={`py-1.5 rounded-xl flex items-center justify-center border transition ${
                isFloatingWindow
                  ? 'bg-jess-accent/30 border-jess-accent text-white'
                  : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/10 text-jess-textMuted hover:text-white'
              }`}
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Нижняя панель профиля + микрофон + звук + настройки */}
      <div className="p-2.5 flex items-center justify-between gap-1.5">
        <div
          onClick={onOpenProfileSettings}
          className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer p-1 rounded-2xl hover:bg-white/[0.05] transition"
        >
          <div className="relative w-9 h-9 shrink-0">
            <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border border-white/15">
              {user.avatar_url ? (
                <AvatarMedia src={user.avatar_url} alt={user.display_name} />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-semibold text-xs text-jess-accent">
                  {user.display_name.slice(0, 2)}
                </div>
              )}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-jess-bg bg-emerald-400 z-10" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center">
              <BadgeList badges={user.badges} size="sm" />
              <span className="text-xs font-semibold text-white truncate">{user.display_name}</span>
              {user.is_verified && <VerifiedBadge size="sm" />}
            </div>
            <div className="text-[10px] text-jess-textMuted truncate">@{user.username}</div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {inCall && (
            <>
              <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/5">
                <button
                  type="button"
                  onClick={onToggleMic}
                  title={isMicMuted ? 'включить микрофон' : 'выключить микрофон'}
                  className={`p-1.5 rounded-l-xl transition ${
                    isMicMuted ? 'text-red-400 hover:bg-red-500/15' : 'text-white hover:bg-white/10'
                  }`}
                >
                  {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAudioMenu((v) => !v)}
                  title="выбор микрофона и шумодав"
                  className="px-0.5 py-1.5 rounded-r-xl text-jess-textMuted hover:text-white hover:bg-white/10 transition"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>

              <button
                type="button"
                onClick={onToggleDeafen}
                title={isDeafened ? 'включить звук' : 'выключить звук'}
                className={`p-1.5 rounded-xl transition ${
                  isDeafened ? 'text-red-400 bg-red-500/15' : 'text-jess-textMuted hover:text-white hover:bg-white/10'
                }`}
              >
                {isDeafened ? <VolumeX className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
              </button>
            </>
          )}

          {!inCall && (
            <button
              type="button"
              onClick={() => setShowAudioMenu((v) => !v)}
              title="настройки микрофона, камеры и шумодава"
              className="p-2 rounded-xl text-jess-textMuted hover:text-white hover:bg-white/10 transition"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenProfileSettings}
            title="настройки профиля"
            className="p-2 rounded-xl text-jess-textMuted hover:text-white hover:bg-white/10 transition"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onLogout}
            title="выйти"
            className="p-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-950/40 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
