import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  PictureInPicture2,
  GripHorizontal,
  SwitchCamera
} from 'lucide-react';
import { RemoteMediaItem } from '../services/webrtc.engine';
import { CallParticipant, UserProfile } from '../types';
import { playUiSound } from '../services/api';
import { AvatarMedia, BadgeList, VerifiedBadge } from './BadgeList';

export function playCallSound(type: 'open' | 'close'): void {
  playUiSound(type, 0.7);
}

interface CallOverlayProps {
  roomName: string;
  currentUser: UserProfile;
  participants: CallParticipant[];
  remoteItems: RemoteMediaItem[];
  isMicMuted: boolean;
  isDeafened: boolean;
  isWebcamOn: boolean;
  isScreenSharing: boolean;
  localWebcamStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  isFloatingWindow: boolean;
  onSetFloatingWindow: (floating: boolean) => void;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onToggleWebcam: () => void;
  onSwitchCamera: () => void;
  onToggleScreenShare: () => void;
  onLeaveCall: () => void;
}

const VideoTile: React.FC<{
  stream: MediaStream;
  label: string;
  user?: UserProfile;
  muted?: boolean;
  isLarge?: boolean;
  showFlipCamera?: boolean;
  onFlipCamera?: () => void;
}> = ({ stream, label, user, muted = false, isLarge = false, showFlipCamera = false, onFlipCamera }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleToggleFullscreen = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else if (containerRef.current?.requestFullscreen) {
        await containerRef.current.requestFullscreen();
      } else if (videoRef.current?.requestFullscreen) {
        await videoRef.current.requestFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const handlePopOutPiP = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (videoRef.current && 'requestPictureInPicture' in videoRef.current) {
        if ((document as any).pictureInPictureElement === videoRef.current) {
          await (document as any).exitPictureInPicture();
        } else {
          await (videoRef.current as any).requestPictureInPicture();
        }
      }
    } catch {
      // ignore
    }
  };

  return (
    <div
      ref={containerRef}
      onDoubleClick={() => handleToggleFullscreen()}
      className={`fullscreen-clean-video relative rounded-2xl overflow-hidden bg-[#07070b] border border-white/15 group flex items-center justify-center ${
        isFullscreen
          ? 'w-screen h-screen rounded-none border-0 bg-black'
          : isLarge
          ? 'col-span-full min-h-0 h-full'
          : 'min-h-0 h-full'
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`w-full h-full ${isFullscreen || isLarge ? 'object-contain' : 'object-cover'}`}
      />

      {/* Кнопки управления поверх окна — всегда доступны сверху справа при любом растяжении */}
      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-20 opacity-85 hover:opacity-100 transition-opacity">
        {showFlipCamera && onFlipCamera && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFlipCamera();
            }}
            title="перевернуть камеру"
            className="p-2 rounded-xl bg-black/75 hover:bg-jess-accent text-white border border-white/10 transition"
          >
            <SwitchCamera className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handlePopOutPiP}
          title="открыть видео поверх окон (PiP)"
          className="p-2 rounded-xl bg-black/75 hover:bg-jess-accent text-white border border-white/10 transition"
        >
          <PictureInPicture2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleToggleFullscreen}
          title={isFullscreen ? 'выйти из полноэкранного режима' : 'на весь экран'}
          className="p-2 rounded-xl bg-black/75 hover:bg-jess-accent text-white border border-white/10 transition"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="absolute bottom-2.5 left-2.5 pointer-events-none z-10">
        <div className="px-3 py-1 rounded-xl bg-black/75 border border-white/10 flex items-center gap-1.5">
          {user && <BadgeList badges={user.badges} size="sm" />}
          <span className="text-xs font-medium text-white">{label}</span>
          {user?.is_verified && <VerifiedBadge size="sm" />}
        </div>
      </div>
    </div>
  );
};

export const RemoteAudioRenderer: React.FC<{ stream: MediaStream; muted: boolean }> = ({ stream, muted }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.muted = muted;
      audioRef.current.play().catch(() => {});
    }
  }, [stream, muted]);

  return <audio ref={audioRef} autoPlay playsInline />;
};

export const CallOverlay: React.FC<CallOverlayProps> = ({
  roomName,
  currentUser,
  participants,
  remoteItems,
  isMicMuted,
  isDeafened,
  isWebcamOn,
  isScreenSharing,
  localWebcamStream,
  localScreenStream,
  isFloatingWindow,
  onSetFloatingWindow,
  onToggleMic,
  onToggleDeafen,
  onToggleWebcam,
  onSwitchCamera,
  onToggleScreenShare,
  onLeaveCall
}) => {
  const [callHeight, setCallHeight] = useState<number>(320);
  const [floatPos, setFloatPos] = useState<{ x: number; y: number; w: number; h: number }>({
    x: Math.max(20, typeof window !== 'undefined' ? window.innerWidth - 520 : 200),
    y: 70,
    w: 480,
    h: 380
  });

  const callStatusText = participants.length > 1 ? 'в звонке' : 'ожидание собеседника...';

  const startVerticalResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = callHeight;

    const onMove = (moveEv: MouseEvent) => {
      const delta = moveEv.clientY - startY;
      const maxH = Math.round(window.innerHeight * 0.82);
      setCallHeight(Math.max(150, Math.min(maxH, startH + delta)));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startDragFloating = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const startX = e.clientX - floatPos.x;
    const startY = e.clientY - floatPos.y;

    const onMove = (moveEv: MouseEvent) => {
      setFloatPos((prev) => ({
        ...prev,
        x: Math.max(8, Math.min(window.innerWidth - prev.w - 8, moveEv.clientX - startX)),
        y: Math.max(8, Math.min(window.innerHeight - 80, moveEv.clientY - startY))
      }));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startResizeFloating = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = floatPos.w;
    const startH = floatPos.h;

    const onMove = (moveEv: MouseEvent) => {
      setFloatPos((prev) => ({
        ...prev,
        w: Math.max(280, Math.min(window.innerWidth - 24, startW + (moveEv.clientX - startX))),
        h: Math.max(200, Math.min(window.innerHeight - 24, startH + (moveEv.clientY - startY)))
      }));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const remoteVideos = remoteItems.filter((item) => item.stream.getVideoTracks().length > 0);
  const hasAnyVideo = Boolean(localScreenStream || localWebcamStream || remoteVideos.length > 0);

  return (
    <div
      style={
        isFloatingWindow
          ? {
              position: 'fixed',
              left: `${floatPos.x}px`,
              top: `${floatPos.y}px`,
              width: `${floatPos.w}px`,
              height: `${floatPos.h}px`,
              zIndex: 60
            }
          : {
              height: hasAnyVideo ? `${callHeight}px` : undefined
            }
      }
      className={`${
        isFloatingWindow
          ? 'glass-panel border border-jess-accent/50 rounded-3xl shadow-2xl neon-glow overflow-hidden'
          : 'glass-panel border-b border-white/10 shrink-0'
      } px-5 py-3.5 flex flex-col justify-between gap-2.5 relative select-none animate-menu-in`}
    >
      <div
        onMouseDown={isFloatingWindow ? startDragFloating : undefined}
        className={`flex items-center justify-between gap-3 shrink-0 ${
          isFloatingWindow ? 'cursor-move pb-2 border-b border-white/10' : ''
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
          </span>
          <span className="text-xs font-semibold text-white truncate">{roomName}</span>
          <span className="text-xs text-jess-textMuted shrink-0">• {callStatusText}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-jess-textMuted">участников: {participants.length}</span>
          <button
            type="button"
            onClick={() => onSetFloatingWindow(!isFloatingWindow)}
            title={isFloatingWindow ? 'вернуть звонок в чат' : 'открыть звонок в отдельном плавающем окне'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] border transition ${
              isFloatingWindow
                ? 'bg-jess-accent text-white border-jess-accent'
                : 'bg-white/[0.06] hover:bg-white/[0.12] text-jess-textMuted hover:text-white border-white/10'
            }`}
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
            <span>{isFloatingWindow ? 'встроить' : 'в окне'}</span>
          </button>
        </div>
      </div>

      {hasAnyVideo && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 min-h-0 overflow-hidden">
          {localScreenStream && (
            <VideoTile
              stream={localScreenStream}
              label={`${currentUser.display_name} • экран`}
              user={currentUser}
              muted
              isLarge
            />
          )}

          {localWebcamStream && (
            <VideoTile
              stream={localWebcamStream}
              label={currentUser.display_name}
              user={currentUser}
              muted
              showFlipCamera
              onFlipCamera={onSwitchCamera}
            />
          )}

          {remoteVideos.map((v) => {
            const p = participants.find((part) => part.socketId === v.socketId);
            const u = v.user || p?.user;
            return (
              <VideoTile
                key={v.id}
                stream={v.stream}
                label={u ? `${u.display_name}${p?.isScreenSharing ? ' • экран' : ''}` : 'участник'}
                user={u}
                muted={isDeafened}
                isLarge={Boolean(p?.isScreenSharing || v.isScreen)}
              />
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {participants.map((p) => (
          <div
            key={p.socketId}
            className="flex items-center gap-2 px-3 py-1 rounded-2xl bg-white/[0.04] border border-white/10 transition-all"
          >
            <div className="relative w-6 h-6 shrink-0">
              <div className="w-full h-full rounded-full overflow-hidden bg-jess-surface border border-white/15 flex items-center justify-center text-[10px] font-semibold text-jess-accent">
                {p.user.avatar_url ? (
                  <AvatarMedia src={p.user.avatar_url} alt={p.user.display_name} />
                ) : (
                  p.user.display_name.slice(0, 2)
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <BadgeList badges={p.user.badges} size="sm" />
              <span className="text-xs font-medium text-white">{p.user.display_name}</span>
              {p.user.is_verified && <VerifiedBadge size="sm" />}
            </div>
            {p.isMuted ? (
              <MicOff className="w-3.5 h-3.5 text-red-400 ml-1" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-emerald-400 ml-1 shadow-[0_0_8px_#34d399]" />
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-white/5 shrink-0">
        <button
          type="button"
          onClick={onToggleMic}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-medium transition-all ${
            isMicMuted
              ? 'bg-red-500/20 text-red-300 border border-red-500/30'
              : 'bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/10'
          }`}
        >
          {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-400" />}
          <span>{isMicMuted ? 'микрофон выкл' : 'микрофон'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleDeafen}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-medium transition-all ${
            isDeafened
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/10'
          }`}
        >
          {isDeafened ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          <span>{isDeafened ? 'звук выкл' : 'звук'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleWebcam}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-medium transition-all ${
            isWebcamOn
              ? 'cta-music-btn text-white'
              : 'bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/10'
          }`}
        >
          {isWebcamOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          <span>камера</span>
        </button>

        {isWebcamOn && (
          <button
            type="button"
            onClick={onSwitchCamera}
            title="перевернуть камеру"
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/10 text-xs font-medium transition-all"
          >
            <SwitchCamera className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onToggleScreenShare}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-medium transition-all ${
            isScreenSharing
              ? 'cta-music-btn text-white'
              : 'bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/10'
          }`}
        >
          <MonitorUp className="w-4 h-4" />
          <span>{isScreenSharing ? 'остановить экран' : 'экран'}</span>
        </button>

        <button
          type="button"
          onClick={onLeaveCall}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-red-500/80 hover:bg-red-500 text-white text-xs font-medium transition-all"
        >
          <PhoneOff className="w-4 h-4" />
          <span>завершить</span>
        </button>
      </div>

      {!isFloatingWindow && hasAnyVideo && (
        <div
          onMouseDown={startVerticalResize}
          title="потяните вверх или вниз, чтобы изменить высоту окна звонка"
          className="absolute bottom-0 left-0 right-0 h-2.5 cursor-row-resize flex items-center justify-center hover:bg-[#8a2be2]/30 transition group"
        >
          <GripHorizontal className="w-4 h-3 text-white/30 group-hover:text-white/80" />
        </div>
      )}

      {isFloatingWindow && (
        <div
          onMouseDown={startResizeFloating}
          title="потяните, чтобы изменить размер окна звонка"
          className="absolute bottom-1 right-1 w-4 h-4 cursor-nwse-resize rounded-sm bg-white/15 hover:bg-jess-accent transition"
        />
      )}
    </div>
  );
};
