import React, { useState } from 'react';

export const QUICK_REACTIONS = ['💜', '🔥', '👍', '😂', '⚡', '🎉', '👀', '❤️'];

export const IOS_EMOJI_CATALOG = [
  '😀', '😃', '😄', '😁', '😆', '🥹', '😅', '😂', '🤣', '🥲', '☺️', '😊',
  '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋',
  '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏',
  '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢',
  '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰',
  '🤔', '🫡', '🤫', '🫠', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😴',
  '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑',
  '🤠', '😈', '👿', '👻', '💀', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹',
  '😻', '😼', '😽', '🙀', '😿', '😾', '👋', '🤚', '✋', '🖖', '👌', '🤌',
  '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️',
  '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝',
  '🙏', '💅', '💪', '🧠', '👀', '👁️', '🫦', '❤️', '🩷', '🧡', '💛', '💚',
  '💙', '🩵', '💜', '🖤', '🩶', '🤍', '🤎', '💔', '❤️‍🔥', '💕', '💞', '💓',
  '💗', '💖', '💘', '💝', '✨', '🔥', '⚡', '💥', '💫', '💦', '💨', '🌈',
  '☀️', '🌙', '⭐', '🌟', '☁️', '❄️', '🌸', '🌹', '🌺', '🌻', '🍀', '🍎',
  '🍓', '🍒', '🍑', '🍕', '🍔', '🍟', '🍣', '🍩', '🍪', '🎂', '☕', '🍵',
  '🥤', '🍷', '🥂', '🍻', '⚽', '🏀', '🎮', '🎧', '🎵', '🎶', '🎤', '🎬',
  '🚀', '✈️', '🚗', '💎', '👑', '🎁', '🎈', '🎉', '🎊', '🏆', '🥇', '📌',
  '📎', '🔒', '🔑', '💡', '📢', '💬', '💭', '💯', '✅', '❌', '❓', '❗'
];

export function emojiToAppleCodepoint(emoji: string): string {
  const codePoints: string[] = [];
  for (const symbol of Array.from(emoji)) {
    const cp = symbol.codePointAt(0);
    if (cp !== undefined) {
      codePoints.push(cp.toString(16).toLowerCase());
    }
  }
  return codePoints.join('-');
}

export const IosEmoji: React.FC<{
  emoji: string;
  className?: string;
  size?: number;
}> = ({ emoji, className = '', size }) => {
  const [fallbackMode, setFallbackMode] = useState<0 | 1 | 2>(0);
  const fullHex = emojiToAppleCodepoint(emoji);
  const strippedHex = fullHex
    .split('-')
    .filter((c) => c !== 'fe0f')
    .join('-');

  if (fallbackMode === 2 || !fullHex) {
    return (
      <span
        className={className}
        style={{
          fontFamily: "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
          fontSize: size ? `${size}px` : undefined
        }}
      >
        {emoji}
      </span>
    );
  }

  const currentHex = fallbackMode === 0 ? fullHex : strippedHex;
  const src = `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/${currentHex}.png`;

  return (
    <img
      src={src}
      alt={emoji}
      draggable={false}
      onError={() => {
        if (fallbackMode === 0 && strippedHex && strippedHex !== fullHex) {
          setFallbackMode(1);
        } else {
          setFallbackMode(2);
        }
      }}
      className={`ios-emoji ${className}`}
      style={size ? { width: `${size}px`, height: `${size}px` } : undefined}
    />
  );
};

const EMOJI_REGEX =
  /(\p{RI}\p{RI}|\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F)?(\u200D(\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F)?)+|(\p{RI}\p{RI}|\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F)?/gu;

function renderPlainChunkWithEmojis(text: string, keyPrefix = ''): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(EMOJI_REGEX.source, 'gu');
  while ((match = regex.exec(text)) !== null) {
    const idx = match.index;
    const emojiStr = match[0];
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    parts.push(<IosEmoji key={`${keyPrefix}-${idx}-${emojiStr}`} emoji={emojiStr} />);
    lastIndex = idx + emojiStr.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function renderTextWithIosEmojis(text: string): React.ReactNode {
  if (!text) return null;

  const tokenRegex =
    /(https?:\/\/(?:www\.)?mered\.ro\/@[a-zA-Z0-9_]+(?:\/\d+)?|(?:www\.)?mered\.ro\/@[a-zA-Z0-9_]+(?:\/\d+)?|(?<![a-zA-Z0-9_])@[a-zA-Z0-9_]{1,51}(?:\/\d+)?|https?:\/\/[^\s<]+)/gi;

  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRegex.exec(text)) !== null) {
    const idx = m.index;
    const rawToken = m[0];

    if (idx > lastIdx) {
      nodes.push(renderPlainChunkWithEmojis(text.slice(lastIdx, idx), `txt-${idx}`));
    }

    const internalMatch = rawToken.match(/(?:mered\.ro\/)?@([a-zA-Z0-9_]+)(?:\/(\d+))?$/i);
    if (internalMatch) {
      const slug = internalMatch[1];
      const msgNum = internalMatch[2];
      const targetPath = msgNum ? `/@${slug}/${msgNum}` : `/@${slug}`;
      nodes.push(
        <a
          key={`link-${idx}`}
          href={targetPath}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.history.pushState({}, '', targetPath);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          style={{ color: 'var(--accent-hover)' }}
          className="hover:text-white font-semibold underline underline-offset-2 transition cursor-pointer"
        >
          {rawToken}
        </a>
      );
    } else {
      const cleanUrl = rawToken.replace(/[.,!?;:)]+$/, '');
      const trailing = rawToken.slice(cleanUrl.length);
      nodes.push(
        <React.Fragment key={`ext-${idx}`}>
          <a
            href={cleanUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              const desktop = (window as any).jessengerDesktop;
              if (desktop?.openExternalUrl) {
                e.preventDefault();
                desktop.openExternalUrl(cleanUrl);
              }
            }}
            style={{ color: 'var(--accent-hover)' }}
            className="hover:text-white underline underline-offset-2 transition break-all"
          >
            {cleanUrl}
          </a>
          {trailing}
        </React.Fragment>
      );
    }

    lastIdx = idx + rawToken.length;
  }

  if (lastIdx < text.length) {
    nodes.push(renderPlainChunkWithEmojis(text.slice(lastIdx), `end-${lastIdx}`));
  }

  return nodes.length > 0 ? nodes : text;
}

export function formatLastSeen(isOnline?: boolean, lastSeenAt?: string): string {
  if (isOnline) return 'в сети';
  if (!lastSeenAt) return 'был(а) недавно';

  const normalized = lastSeenAt.endsWith('Z') ? lastSeenAt : `${lastSeenAt.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return 'был(а) недавно';

  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return 'был(а) только что';
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return `был(а) ${mins} мин. назад`;
  }

  const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return `был(а) сегодня в ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return `был(а) вчера в ${timeStr}`;
  }

  const dayMonth = date
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    .toLowerCase();
  return `был(а) ${dayMonth} в ${timeStr}`;
}
