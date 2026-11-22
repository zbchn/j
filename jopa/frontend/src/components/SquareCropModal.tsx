import React, { useEffect, useRef, useState } from 'react';
import { X, Check, ZoomIn, Move } from 'lucide-react';

interface SquareCropModalProps {
  file: File;
  onCancel: () => void;
  onConfirm: (result: {
    file: File;
    previewUrl: string;
    cropParams?: { cropX: number; cropY: number; cropSize: number };
  }) => void;
}

export const SquareCropModal: React.FC<SquareCropModalProps> = ({ file, onCancel, onConfirm }) => {
  const [objectUrl, setObjectUrl] = useState<string>('');
  const [isVideo, setIsVideo] = useState(false);
  const [isAnimatedImg, setIsAnimatedImg] = useState(false);
  const [natW, setNatW] = useState(1);
  const [natH, setNatH] = useState(1);

  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0); // -0.5 .. 0.5 normalized
  const [offsetY, setOffsetY] = useState(0);
  const draggingRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    const mime = (file.type || '').toLowerCase();
    const name = file.name.toLowerCase();
    const vid = mime.startsWith('video/') || name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov');
    const anim = vid || mime.includes('gif') || name.endsWith('.gif') || name.endsWith('.apng');
    setIsVideo(vid);
    setIsAnimatedImg(anim);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const BOX_SIZE = 240;

  // Вычисляем базовый масштаб так, чтобы короткая сторона заполнила квадрат
  const baseScale = Math.max(BOX_SIZE / Math.max(1, natW), BOX_SIZE / Math.max(1, natH));
  const totalScale = baseScale * zoom;
  const dispW = natW * totalScale;
  const dispH = natH * totalScale;
  const maxPanX = Math.max(0, (dispW - BOX_SIZE) / 2);
  const maxPanY = Math.max(0, (dispH - BOX_SIZE) / 2);

  const clampedPxX = Math.max(-maxPanX, Math.min(maxPanX, offsetX * BOX_SIZE));
  const clampedPxY = Math.max(-maxPanY, Math.min(maxPanY, offsetY * BOX_SIZE));

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: clampedPxX / BOX_SIZE,
      origY: clampedPxY / BOX_SIZE
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = (e.clientX - draggingRef.current.startX) / BOX_SIZE;
    const dy = (e.clientY - draggingRef.current.startY) / BOX_SIZE;
    setOffsetX(draggingRef.current.origX + dx);
    setOffsetY(draggingRef.current.origY + dy);
  };

  const handlePointerUp = () => {
    draggingRef.current = null;
  };

  const handleSaveCrop = async () => {
    // Вычисляем нормализованный квадрат в координатах исходного медиа (0..1)
    const leftInDisp = dispW / 2 - BOX_SIZE / 2 - clampedPxX;
    const topInDisp = dispH / 2 - BOX_SIZE / 2 - clampedPxY;

    const srcX = Math.max(0, leftInDisp / totalScale);
    const srcY = Math.max(0, topInDisp / totalScale);
    const srcSide = Math.min(natW - srcX, natH - srcY, BOX_SIZE / totalScale);

    if (!isVideo && !isAnimatedImg && imgRef.current) {
      const outSize = 192;
      const canvas = document.createElement('canvas');
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(imgRef.current, srcX, srcY, srcSide, srcSide, 0, 0, outSize, outSize);
        canvas.toBlob((blob) => {
          if (blob) {
            const croppedFile = new File([blob], 'badge_1x1.png', { type: 'image/png' });
            onConfirm({
              file: croppedFile,
              previewUrl: URL.createObjectURL(croppedFile)
            });
          } else {
            onConfirm({ file, previewUrl: URL.createObjectURL(file) });
          }
        }, 'image/png');
        return;
      }
    }

    // Для видео и GIF передаем нормализованные координаты кропа на сервер (ffmpeg)
    const normX = Math.max(0, Math.min(0.99, srcX / Math.max(1, natW)));
    const normY = Math.max(0, Math.min(0.99, srcY / Math.max(1, natH)));
    const normW = Math.max(0.05, Math.min(1 - normX, srcSide / Math.max(1, natW)));
    const normH = Math.max(0.05, Math.min(1 - normY, srcSide / Math.max(1, natH)));
    const normSize = Math.min(normW, normH);

    onConfirm({
      file,
      previewUrl: URL.createObjectURL(file),
      cropParams: {
        cropX: Number(normX.toFixed(4)),
        cropY: Number(normY.toFixed(4)),
        cropSize: Number(normSize.toFixed(4))
      }
    });
  };

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-menu-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel border border-white/15 rounded-3xl w-full max-w-sm p-5 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">обрезка бейджа 1:1</h3>
            <p className="text-[11px] text-jess-textMuted">перетащите и масштабируйте квадрат</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-xl hover:bg-white/10 text-jess-textMuted hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex justify-center">
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ width: `${BOX_SIZE}px`, height: `${BOX_SIZE}px` }}
            className="relative rounded-2xl overflow-hidden border-2 border-jess-accent shadow-[0_0_24px_rgba(138,43,226,0.45)] bg-black cursor-grab active:cursor-grabbing touch-none select-none"
          >
            {objectUrl &&
              (isVideo ? (
                <video
                  ref={videoRef}
                  src={objectUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    setNatW(v.videoWidth || 100);
                    setNatH(v.videoHeight || 100);
                  }}
                  style={{
                    width: `${dispW}px`,
                    height: `${dispH}px`,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `translate(calc(-50% + ${clampedPxX}px), calc(-50% + ${clampedPxY}px))`
                  }}
                  className="pointer-events-none"
                />
              ) : (
                <img
                  ref={imgRef}
                  src={objectUrl}
                  alt="crop"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setNatW(img.naturalWidth || 100);
                    setNatH(img.naturalHeight || 100);
                  }}
                  style={{
                    width: `${dispW}px`,
                    height: `${dispH}px`,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `translate(calc(-50% + ${clampedPxX}px), calc(-50% + ${clampedPxY}px))`
                  }}
                  className="pointer-events-none"
                />
              ))}

            <div className="pointer-events-none absolute inset-0 border border-white/20 rounded-2xl" />
            <div className="pointer-events-none absolute bottom-2 right-2 px-2 py-0.5 rounded-lg bg-black/70 text-[10px] text-white/80 flex items-center gap-1">
              <Move className="w-3 h-3" />
              <span>1:1</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-1">
          <ZoomIn className="w-4 h-4 text-jess-accentHover shrink-0" />
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-full accent-jess-accent cursor-pointer"
          />
          <span className="text-[11px] font-mono text-jess-textMuted w-10 text-right">
            {zoom.toFixed(1)}x
          </span>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-2xl bg-white/[0.05] hover:bg-white/10 text-xs text-jess-textMuted hover:text-white transition"
          >
            отмена
          </button>
          <button
            type="button"
            onClick={handleSaveCrop}
            className="px-4 py-2 rounded-2xl cta-music-btn text-white text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Check className="w-3.5 h-3.5" />
            <span>применить 1:1</span>
          </button>
        </div>
      </div>
    </div>
  );
};
