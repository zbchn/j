import React, { useRef, useState } from 'react';
import { X, Palette, Check, RotateCcw, Image as ImageIcon, Trash2, Sun, Droplets } from 'lucide-react';
import { ThemeConfig } from '../types';
import { apiRequest, uploadFileInChunks, showTopToast } from '../services/api';

export const THEME_PRESETS: ThemeConfig[] = [
  {
    presetName: 'ночной аметист',
    bgPrimary: '#0d0d12',
    bgSecondary: '#12121b',
    bgSurface: '#161622',
    accent: '#8a2be2',
    accentHover: '#bb86fc',
    textMain: '#f5f0ff',
    textMuted: '#9890b0',
    msgOwn: '#3d1975',
    msgOther: '#171526',
    radius: '16px',
    glassOpacity: '0.84',
    chatWallpaper: '',
    bgBrightness: 0.45,
    bgBlur: 0
  },
  {
    presetName: 'глубокий индиго',
    bgPrimary: '#060814',
    bgSecondary: '#0c1024',
    bgSurface: '#151c38',
    accent: '#6366f1',
    accentHover: '#818cf8',
    textMain: '#eef2ff',
    textMuted: '#7c86a6',
    msgOwn: '#282c7a',
    msgOther: '#11162e',
    radius: '18px',
    glassOpacity: '0.84',
    chatWallpaper: '',
    bgBrightness: 0.45,
    bgBlur: 0
  },
  {
    presetName: 'изумрудная дымка',
    bgPrimary: '#040d0a',
    bgSecondary: '#081813',
    bgSurface: '#0f2920',
    accent: '#10b981',
    accentHover: '#34d399',
    textMain: '#ecfdf5',
    textMuted: '#6fa892',
    msgOwn: '#064e3b',
    msgOther: '#0b211a',
    radius: '16px',
    glassOpacity: '0.82',
    chatWallpaper: '',
    bgBrightness: 0.45,
    bgBlur: 0
  },
  {
    presetName: 'алый бархат',
    bgPrimary: '#0d0507',
    bgSecondary: '#17090d',
    bgSurface: '#261017',
    accent: '#f43f5e',
    accentHover: '#fb7185',
    textMain: '#fff1f2',
    textMuted: '#a67b84',
    msgOwn: '#6b1229',
    msgOther: '#1f0c12',
    radius: '16px',
    glassOpacity: '0.85',
    chatWallpaper: '',
    bgBrightness: 0.45,
    bgBlur: 0
  },
  {
    presetName: 'кибер-неон',
    bgPrimary: '#050b14',
    bgSecondary: '#091526',
    bgSurface: '#10233d',
    accent: '#06b6d4',
    accentHover: '#22d3ee',
    textMain: '#ecfeff',
    textMuted: '#7aa6b8',
    msgOwn: '#0e4f63',
    msgOther: '#0b1d30',
    radius: '18px',
    glassOpacity: '0.83',
    chatWallpaper: '',
    bgBrightness: 0.45,
    bgBlur: 0
  },
  {
    presetName: 'чистый обсидиан',
    bgPrimary: '#070709',
    bgSecondary: '#0f0f13',
    bgSurface: '#1a1a21',
    accent: '#a855f7',
    accentHover: '#d8b4fe',
    textMain: '#fafafa',
    textMuted: '#8a8a93',
    msgOwn: '#2b1b42',
    msgOther: '#14141c',
    radius: '14px',
    glassOpacity: '0.88',
    chatWallpaper: '',
    bgBrightness: 0.45,
    bgBlur: 0
  }
];

function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = (hex || '').replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }
  return null;
}

export function getLuminance(hex: string): number {
  const rgb = parseHexToRgb(hex);
  if (!rgb) return 0.05;
  const srgb = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function getReadableTextForBg(bgHex: string): { main: string; muted: string } {
  const lum = getLuminance(bgHex);
  if (lum > 0.42) {
    return {
      main: '#120b1d',
      muted: '#4b3f61'
    };
  }
  return {
    main: '#f5f0ff',
    muted: '#9b90b3'
  };
}

function shiftColorBrightness(hex: string, delta: number): string {
  const rgb = parseHexToRgb(hex);
  if (!rgb) return hex;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(rgb.r + delta);
  const g = clamp(rgb.g + delta);
  const b = clamp(rgb.b + delta);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function normalizeThemeWithAutoContrast(theme: ThemeConfig): ThemeConfig {
  const bgColors = getReadableTextForBg(theme.bgPrimary);
  const bgLum = getLuminance(theme.bgPrimary);
  const secondaryShift = bgLum > 0.42 ? -14 : 8;
  const surfaceShift = bgLum > 0.42 ? -26 : 16;
  const cleanName = (theme.presetName || 'ночной аметист').replace(/\s*\(zoboch\.in\)/gi, '');

  return {
    ...theme,
    presetName: cleanName,
    bgSecondary: shiftColorBrightness(theme.bgPrimary, secondaryShift),
    bgSurface: shiftColorBrightness(theme.bgPrimary, surfaceShift),
    accentHover: shiftColorBrightness(theme.accent, 34),
    textMain: bgColors.main,
    textMuted: bgColors.muted,
    bgBrightness: theme.bgBrightness !== undefined ? Number(theme.bgBrightness) : 0.45,
    bgBlur: theme.bgBlur !== undefined ? Number(theme.bgBlur) : 0
  };
}

export function applyThemeToDOM(theme: ThemeConfig): void {
  const normalized = normalizeThemeWithAutoContrast(theme);
  const ownText = getReadableTextForBg(normalized.msgOwn).main;
  const otherText = getReadableTextForBg(normalized.msgOther).main;

  const root = document.documentElement;
  root.style.setProperty('--bg-primary', normalized.bgPrimary);
  root.style.setProperty('--bg-secondary', normalized.bgSecondary);
  root.style.setProperty('--bg-surface', normalized.bgSurface);
  root.style.setProperty('--accent', normalized.accent);
  root.style.setProperty('--accent-hover', normalized.accentHover);
  root.style.setProperty('--text-main', normalized.textMain);
  root.style.setProperty('--text-muted', normalized.textMuted);
  root.style.setProperty('--msg-own', normalized.msgOwn);
  root.style.setProperty('--msg-other', normalized.msgOther);
  root.style.setProperty('--msg-own-text', ownText);
  root.style.setProperty('--msg-other-text', otherText);
  root.style.setProperty('--radius', normalized.radius || '16px');
  root.style.setProperty('--glass-opacity', normalized.glassOpacity || '0.84');
  root.style.setProperty('--bg-brightness', String(normalized.bgBrightness ?? 0.45));
  root.style.setProperty('--bg-blur', `${normalized.bgBlur ?? 0}px`);
  root.style.setProperty(
    '--chat-wallpaper',
    normalized.chatWallpaper ? `url("${normalized.chatWallpaper}")` : 'none'
  );
}

interface ThemeCustomizerModalProps {
  currentTheme: ThemeConfig;
  roomId?: string;
  roomName?: string;
  onClose: () => void;
  onSaveTheme: (newTheme: ThemeConfig) => void;
  onRoomThemeUpdated?: () => void;
}

export const ThemeCustomizerModal: React.FC<ThemeCustomizerModalProps> = ({
  currentTheme,
  roomId,
  roomName,
  onClose,
  onSaveTheme,
  onRoomThemeUpdated
}) => {
  const [draft, setDraft] = useState<ThemeConfig>(() => normalizeThemeWithAutoContrast({ ...currentTheme }));
  const [saving, setSaving] = useState(false);
  const [uploadingWallpaper, setUploadingWallpaper] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const wallpaperInputRef = useRef<HTMLInputElement | null>(null);

  const updateField = (key: keyof ThemeConfig, value: any) => {
    const isEffectOnly = key === 'bgBrightness' || key === 'bgBlur';
    const nextRaw = {
      ...draft,
      [key]: value,
      presetName: isEffectOnly ? draft.presetName : 'своя тема'
    };
    const next = normalizeThemeWithAutoContrast(nextRaw);
    setDraft(next);
    if (!roomId) {
      applyThemeToDOM(next);
    }
  };

  const selectPreset = (preset: ThemeConfig) => {
    const next = normalizeThemeWithAutoContrast({
      ...preset,
      chatWallpaper: draft.chatWallpaper,
      bgBrightness: draft.bgBrightness ?? 0.45,
      bgBlur: draft.bgBlur ?? 0
    });
    setDraft(next);
    if (!roomId) {
      applyThemeToDOM(next);
    }
    const msg = `выбрана тема «${preset.presetName}»`;
    setStatusMsg(msg);
    showTopToast(msg, 'info');
  };

  const handleWallpaperFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingWallpaper(true);
    setStatusMsg(null);
    try {
      const uploaded = await uploadFileInChunks(file, 'wallpapers');
      const next = normalizeThemeWithAutoContrast({
        ...draft,
        chatWallpaper: uploaded.fileUrl
      });
      setDraft(next);

      if (roomId) {
        await apiRequest(`/chat/rooms/${roomId}/theme`, {
          method: 'PUT',
          body: JSON.stringify({
            themeConfig: next,
            wallpaperUrl: uploaded.fileUrl
          })
        });
        setStatusMsg('общие обои чата установлены!');
        showTopToast('общие обои чата установлены!', 'success');
        if (onRoomThemeUpdated) onRoomThemeUpdated();
      } else {
        await apiRequest('/auth/theme', {
          method: 'PUT',
          body: JSON.stringify({ themeConfig: next })
        });
        onSaveTheme(next);
        applyThemeToDOM(next);
        setStatusMsg('обои загружены и сохранены!');
        showTopToast('обои загружены и сохранены!', 'success');
      }
    } catch (err: any) {
      const errText = err.message || 'ошибка загрузки обоев';
      setStatusMsg(errText);
      showTopToast(errText, 'error');
    } finally {
      setUploadingWallpaper(false);
      if (wallpaperInputRef.current) wallpaperInputRef.current.value = '';
    }
  };

  const handleClearWallpaper = async () => {
    const next = normalizeThemeWithAutoContrast({ ...draft, chatWallpaper: '' });
    setDraft(next);
    if (roomId) {
      await apiRequest(`/chat/rooms/${roomId}/theme`, {
        method: 'PUT',
        body: JSON.stringify({
          themeConfig: next,
          removeWallpaper: true
        })
      }).catch(() => {});
      if (onRoomThemeUpdated) onRoomThemeUpdated();
    } else {
      await apiRequest('/auth/theme', {
        method: 'PUT',
        body: JSON.stringify({ themeConfig: next })
      }).catch(() => {});
      onSaveTheme(next);
      applyThemeToDOM(next);
    }
    setStatusMsg('обои убраны');
    showTopToast('обои убраны', 'info');
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      const normalized = normalizeThemeWithAutoContrast(draft);
      if (roomId) {
        await apiRequest(`/chat/rooms/${roomId}/theme`, {
          method: 'PUT',
          body: JSON.stringify({
            themeConfig: normalized,
            wallpaperUrl: normalized.chatWallpaper || null
          })
        });
        if (onRoomThemeUpdated) onRoomThemeUpdated();
        setStatusMsg('тема и обои чата сохранены');
        showTopToast('тема и обои чата сохранены!', 'success');
      } else {
        await apiRequest('/auth/theme', {
          method: 'PUT',
          body: JSON.stringify({ themeConfig: normalized })
        });
        onSaveTheme(normalized);
        applyThemeToDOM(normalized);
        setStatusMsg('тема сохранена');
        showTopToast('тема оформления сохранена!', 'success');
      }
    } catch (err: any) {
      const errText = err.message || 'ошибка сохранения темы';
      setStatusMsg(errText);
      showTopToast(errText, 'error');
    } finally {
      setSaving(false);
    }
  };

  const simpleColorFields: { key: keyof ThemeConfig; label: string }[] = [
    { key: 'bgPrimary', label: 'основной фон' },
    { key: 'accent', label: 'акцент и свечение' },
    { key: 'msgOwn', label: 'мои сообщения' },
    { key: 'msgOther', label: 'сообщения собеседника' }
  ];

  const previewOwnText = getReadableTextForBg(draft.msgOwn).main;
  const previewOtherText = getReadableTextForBg(draft.msgOther).main;
  const brightnessVal = draft.bgBrightness !== undefined ? Number(draft.bgBrightness) : 0.45;
  const blurVal = draft.bgBlur !== undefined ? Number(draft.bgBlur) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl p-4 animate-menu-in">
      <div className="glass-panel border border-white/10 rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <Palette className="w-4 h-4 text-jess-accent" />
            <h2 className="text-sm font-semibold text-white">
              {roomId ? `тема и общие обои чата • ${roomName || ''}` : 'оформление'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-jess-textMuted hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Статус-уведомление СВЕРХУ модального окна */}
        {statusMsg && (
          <div className="mx-6 mt-3 px-4 py-2 rounded-2xl bg-black/50 border border-jess-accent/40 text-xs text-white flex items-center justify-between animate-menu-in">
            <span>{statusMsg}</span>
            <button type="button" onClick={() => setStatusMsg(null)} className="text-jess-textMuted hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Живой предпросмотр темы */}
          <div>
            <label className="block text-xs text-jess-textMuted mb-2">предпросмотр темы и обоев</label>
            <div
              className="rounded-2xl border border-white/15 p-4 space-y-2.5 relative overflow-hidden transition-all"
              style={{
                backgroundColor: draft.bgPrimary,
                color: draft.textMain
              }}
            >
              {draft.chatWallpaper && (
                <div
                  className="absolute inset-0 pointer-events-none transition-all"
                  style={{
                    backgroundImage: `url("${draft.chatWallpaper}")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    opacity: brightnessVal,
                    filter: blurVal > 0 ? `blur(${blurVal}px)` : 'none',
                    transform: blurVal > 0 ? 'scale(1.06)' : 'none'
                  }}
                />
              )}

              <div className="relative z-10 flex items-center justify-between pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: draft.accent, boxShadow: `0 0 10px ${draft.accent}` }}
                  />
                  <span className="text-xs font-bold" style={{ color: draft.textMain }}>
                    {draft.presetName}
                  </span>
                </div>
                <span className="text-[10px]" style={{ color: draft.textMuted }}>
                  яркость: {Math.round(brightnessVal * 100)}% • размытие: {blurVal}px
                </span>
              </div>

              <div className="relative z-10 flex justify-start">
                <div
                  className="px-3.5 py-2 rounded-2xl text-xs max-w-[75%] shadow"
                  style={{
                    backgroundColor: draft.msgOther,
                    color: previewOtherText,
                    borderRadius: draft.radius
                  }}
                >
                  Привет! Как выглядит эта тема и размытие фона? 👀
                </div>
              </div>

              <div className="relative z-10 flex justify-end">
                <div
                  className="px-3.5 py-2 rounded-2xl text-xs max-w-[75%] shadow"
                  style={{
                    backgroundColor: draft.msgOwn,
                    color: previewOwnText,
                    borderRadius: draft.radius,
                    boxShadow: `0 0 18px -4px ${draft.accent}`
                  }}
                >
                  Выглядит отлично, все кнопки подстраиваются под цвет темы ✨
                </div>
              </div>
            </div>
          </div>

          {/* Готовые темы */}
          <div>
            <label className="block text-xs text-jess-textMuted mb-2">готовые темы</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {THEME_PRESETS.map((preset) => {
                const isSelected = draft.presetName.toLowerCase() === preset.presetName.toLowerCase();
                return (
                  <button
                    key={preset.presetName}
                    type="button"
                    onClick={() => selectPreset(preset)}
                    className={`flex items-center justify-between p-2.5 rounded-2xl border text-left transition ${
                      isSelected
                        ? 'border-jess-accent bg-white/[0.08] soft-glow'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold text-white">{preset.presetName}</div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ background: preset.bgPrimary }} />
                        <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ background: preset.accent }} />
                        <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ background: preset.msgOwn }} />
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-jess-accent shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Настройка основных цветов */}
          <div>
            <label className="block text-xs text-jess-textMuted mb-2">основные цвета</label>
            <div className="grid grid-cols-2 gap-2.5">
              {simpleColorFields.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.03] border border-white/10"
                >
                  <div className="pr-2">
                    <div className="text-xs text-white">{label}</div>
                    <div className="text-[10px] font-mono text-jess-textMuted">{String(draft[key])}</div>
                  </div>
                  <input
                    type="color"
                    value={String(draft[key]).startsWith('#') ? String(draft[key]) : '#8a2be2'}
                    onChange={(e) => updateField(key, e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Ползунки яркости и размытия фона чата */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-white">
                  <Sun className="w-3.5 h-3.5 text-jess-accent" />
                  <span>яркость обоев</span>
                </div>
                <span className="text-xs font-mono text-jess-accent">{Math.round(brightnessVal * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.08"
                max="0.95"
                step="0.02"
                value={brightnessVal}
                onChange={(e) => updateField('bgBrightness', parseFloat(e.target.value))}
                style={{ accentColor: draft.accent }}
                className="w-full cursor-pointer"
              />
            </div>

            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-white">
                  <Droplets className="w-3.5 h-3.5 text-jess-accent" />
                  <span>размытие фона</span>
                </div>
                <span className="text-xs font-mono text-jess-accent">{blurVal} px</span>
              </div>
              <input
                type="range"
                min="0"
                max="24"
                step="1"
                value={blurVal}
                onChange={(e) => updateField('bgBlur', parseInt(e.target.value, 10))}
                style={{ accentColor: draft.accent }}
                className="w-full cursor-pointer"
              />
            </div>
          </div>

          {/* Выбор обоев чата из проводника */}
          <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-white">
                {roomId ? 'общие обои для обоих в этом чате' : 'личные обои фона чата'}
              </div>
              <div className="text-[11px] text-jess-textMuted">
                выберите фото, гифку или видео из проводника
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={wallpaperInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm"
                onChange={handleWallpaperFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploadingWallpaper}
                onClick={() => wallpaperInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl cta-music-btn text-white text-xs font-medium transition"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>{uploadingWallpaper ? 'загрузка...' : 'выбрать обои'}</span>
              </button>

              {draft.chatWallpaper && (
                <button
                  type="button"
                  onClick={handleClearWallpaper}
                  className="p-2 rounded-2xl bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition"
                  title="убрать обои"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => selectPreset(THEME_PRESETS[0])}
                className="p-2 rounded-2xl bg-white/[0.04] hover:bg-white/[0.1] text-jess-textMuted hover:text-white border border-white/10 transition"
                title="сбросить по умолчанию"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-2xl border border-white/10 text-xs text-jess-textMuted hover:text-white transition"
          >
            закрыть
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-2xl cta-music-btn text-white text-xs font-semibold transition"
          >
            {saving ? 'сохранение...' : 'сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};
