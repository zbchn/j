import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Volume2 } from 'lucide-react';
import { Badge } from '../types';

export function isVideoAssetUrl(url?: string | null): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.mov');
}

export const AvatarMedia: React.FC<{
  src?: string | null;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ src, alt = '', className = 'w-full h-full object-cover', style }) => {
  if (!src) return null;
  if (isVideoAssetUrl(src)) {
    return (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        className={className}
        style={style}
      />
    );
  }
  return <img src={src} alt={alt} className={className} style={style} />;
};

export const VerifiedBadge: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ size = 'sm', className = '' }) => {
  const [hovered, setHovered] = useState<{ x: number; y: number } | null>(null);
  const px = { sm: 15, md: 17, lg: 20 }[size];

  return (
    <>
      <span
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHovered({ x: rect.left + rect.width / 2, y: rect.top });
        }}
        onMouseLeave={() => setHovered(null)}
        className={`inline-flex items-center justify-center shrink-0 select-none align-middle mx-0.5 transition-transform duration-200 ease-out hover:scale-110 cursor-pointer ${className}`}
        style={{ width: `${px}px`, height: `${px}px` }}
      >
        <svg
          viewBox="0 0 24 24"
          width={px}
          height={px}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            filter: 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.75))'
          }}
        >
          <path
            d="M12 2L14.8 4.5L18.5 4.2L19.8 7.7L23 9.7L21.8 13.3L23.5 16.6L20.2 18.4L19.2 22L15.5 21.4L12 23.5L8.5 21.4L4.8 22L3.8 18.4L0.5 16.6L2.2 13.3L1 9.7L4.2 7.7L5.5 4.2L9.2 4.5L12 2Z"
            fill="url(#verifiedGrad)"
          />
          <path
            d="M8.5 12.5L10.8 14.8L15.8 9.5"
            stroke="#ffffff"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id="verifiedGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      {hovered &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full pb-2"
            style={{ left: `${hovered.x}px`, top: `${Math.max(36, hovered.y)}px` }}
          >
            <div className="animate-tooltip-in flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-1 text-[11px] font-semibold backdrop-blur-xl bg-[#0d1526]/95 text-sky-300 border border-sky-400/50 shadow-[0_0_16px_rgba(56,189,248,0.45)]">
              <span>верифицирован</span>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

interface BadgeListProps {
  badges?: Badge[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const BadgeList: React.FC<BadgeListProps> = ({ badges = [], size = 'sm', className = '' }) => {
  const [hoveredBadge, setHoveredBadge] = useState<{
    badge: Badge;
    x: number;
    y: number;
  } | null>(null);

  if (!badges || badges.length === 0) return null;

  const pxSize = {
    sm: 15,
    md: 18,
    lg: 20
  }[size];

  const boxPxSize = pxSize + 5;

  const handleMouseEnter = (e: React.MouseEvent<HTMLSpanElement>, badge: Badge) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredBadge({
      badge,
      x: rect.left + rect.width / 2,
      y: rect.top
    });
  };

  return (
    <>
      <span className={`inline-flex items-center gap-1 mr-1.5 align-middle select-none shrink-0 ${className}`}>
        {badges.map((badge) => (
          <span
            key={badge.id}
            onMouseEnter={(e) => handleMouseEnter(e, badge)}
            onMouseLeave={() => setHoveredBadge(null)}
            className="badge-icon-box relative rounded-lg transition-transform duration-200 hover:scale-110 cursor-pointer"
            style={{
              width: `${boxPxSize}px`,
              height: `${boxPxSize}px`,
              minWidth: `${boxPxSize}px`,
              minHeight: `${boxPxSize}px`,
              maxWidth: `${boxPxSize}px`,
              maxHeight: `${boxPxSize}px`,
              padding: '2px',
              border: `1px solid ${badge.border_color || 'var(--accent)'}`,
              boxShadow: `0 0 10px -1px ${badge.glow_color || 'color-mix(in srgb, var(--accent) 50%, transparent)'}`,
              backgroundColor: 'rgba(13, 13, 18, 0.92)'
            }}
          >
            <AvatarMedia
              src={badge.image_url}
              alt={badge.name}
              className="badge-icon-img rounded-sm"
              style={{
                width: `${pxSize}px`,
                height: `${pxSize}px`,
                maxWidth: `${pxSize}px`,
                maxHeight: `${pxSize}px`,
                objectFit: 'contain'
              }}
            />
          </span>
        ))}
      </span>

      {hoveredBadge &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full pb-2"
            style={{
              left: `${hoveredBadge.x}px`,
              top: `${Math.max(36, hoveredBadge.y)}px`
            }}
          >
            <div
              className="animate-tooltip-in flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-1 text-[11px] font-medium backdrop-blur-xl"
              style={{
                backgroundColor: 'rgba(13, 13, 18, 0.96)',
                color: '#f5f0ff',
                border: `1px solid ${hoveredBadge.badge.border_color || 'var(--accent)'}`,
                boxShadow: `0 4px 16px ${hoveredBadge.badge.glow_color || 'color-mix(in srgb, var(--accent) 55%, transparent)'}`
              }}
            >
              <AvatarMedia
                src={hoveredBadge.badge.image_url}
                alt={hoveredBadge.badge.name}
                style={{ width: '14px', height: '14px', maxWidth: '14px', maxHeight: '14px', objectFit: 'contain' }}
              />
              <span>{hoveredBadge.badge.name}</span>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export const InteractiveTitle: React.FC<{
  text: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'span' | 'div';
}> = ({ text, className = '', as: Tag = 'span' }) => {
  const words = text.split(' ');
  return (
    <Tag className={`font-title cursor-default select-none ${className}`}>
      {words.map((word, wordIdx) => (
        <span key={wordIdx} className="inline-block whitespace-nowrap">
          {word.split('').map((char, charIdx) => (
            <span key={charIdx} className="interactive-char">
              {char}
            </span>
          ))}
          {wordIdx < words.length - 1 && <span className="inline-block">&nbsp;</span>}
        </span>
      ))}
    </Tag>
  );
};

export const ProfileMusicPlayer: React.FC<{
  musicUrl?: string | null;
  musicTitle?: string | null;
  className?: string;
}> = ({ musicUrl, musicTitle, className = '' }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  if (!musicUrl) return null;

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!audioRef.current || !audioRef.current.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * audioRef.current.duration;
    setProgress(ratio);
  };

  const fmt = (sec: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`w-full p-3 rounded-2xl bg-black/40 border border-jess-accent/35 soft-glow transition-all hover:border-jess-accent/70 ${className}`}
    >
      <audio
        ref={audioRef}
        src={musicUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration || 0);
        }}
        onTimeUpdate={() => {
          if (audioRef.current && audioRef.current.duration) {
            setCurrentTime(audioRef.current.currentTime);
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {playing ? (
                <div className="flex items-end gap-0.5 h-3.5 shrink-0">
                  <span className="w-0.5 rounded-full eq-bar-1" />
                  <span className="w-0.5 rounded-full eq-bar-2" />
                  <span className="w-0.5 rounded-full eq-bar-3" />
                </div>
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-jess-accent shrink-0" />
              )}
              <span className="text-xs font-semibold text-white truncate">
                {musicTitle || 'meredro - kasual'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-jess-textMuted shrink-0">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </div>

          <div
            onClick={handleSeek}
            className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden cursor-pointer relative"
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
      </div>
    </div>
  );
};
