const TOKEN_KEY = 'jessenger_jwt_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function showTopToast(message: string, type: 'success' | 'error' | 'info' = 'success'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('jessenger:top-toast', {
      detail: { message, type, id: Date.now() + Math.random() }
    })
  );
}

export function copyTextWithToast(text: string, toastMessage = 'скопировано в буфер обмена'): void {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  showTopToast(toastMessage, 'success');
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const apiBase = (typeof window !== 'undefined' && (window as any).jessengerDesktop?.serverUrl) ? `${(window as any).jessengerDesktop.serverUrl}/api` : '/api';
  const response = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 413) {
    throw new Error('файл слишком большой для прямой отправки (413)');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `ошибка запроса (${response.status})`);
  }

  return data as T;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunkSize, len)))
    );
  }
  return btoa(binary);
}

export async function uploadFileInChunks(
  file: File | Blob,
  targetFolder: 'attachments' | 'avatars' | 'wallpapers' | 'ringtones' | 'music' | 'badges' | 'voice' | 'video_notes' | 'stickers',
  customFileName?: string,
  onProgress?: (percent: number) => void
): Promise<{ fileUrl: string; fileName: string; fileSize: number; mimeType: string }> {
  const CHUNK_SIZE = 384 * 1024;
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const fileName = customFileName || (file instanceof File ? file.name : 'file.bin');
  const mimeType = file.type || 'application/octet-stream';

  let finalResult: any = null;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const slice = file.slice(start, end);
    const buf = await slice.arrayBuffer();
    const chunkBase64 = arrayBufferToBase64(buf);

    const res = await apiRequest('/auth/chunk-upload', {
      method: 'POST',
      body: JSON.stringify({
        uploadId,
        chunkIndex,
        totalChunks,
        fileName,
        targetFolder,
        chunkBase64
      })
    });

    if (onProgress) {
      onProgress(Math.round(((chunkIndex + 1) / totalChunks) * 100));
    }

    if (res.completed) {
      finalResult = res;
    }
  }

  return {
    fileUrl: finalResult?.fileUrl || '',
    fileName: finalResult?.fileName || fileName,
    fileSize: finalResult?.fileSize || file.size,
    mimeType
  };
}

export type SoundEffectName =
  | 'open'
  | 'close'
  | 'mic_on'
  | 'mic_off'
  | 'cam_on'
  | 'cam_off'
  | 'screen_on'
  | 'screen_off'
  | 'notify'
  | 'ba'
  | 'msg_send';

export function playUiSound(name: SoundEffectName, volume = 0.65): void {
  try {
    const src = name === 'notify' || name === 'ba' ? '/sounds/ba.wav' : `/sounds/${name}.wav`;
    const audio = new Audio(src);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch(() => {});
  } catch {
    // ignore
  }
}

export async function downloadMediaFile(url: string, suggestedName?: string | null): Promise<void> {
  try {
    const desktop = typeof window !== 'undefined' ? (window as any).jessengerDesktop : null;
    const resolvedUrl = (desktop?.serverUrl && url.startsWith('/')) ? `${desktop.serverUrl}${url}` : url;
    showTopToast(`скачивание: ${suggestedName || url.split('/').pop() || 'файл'}`, 'info');
    if (desktop?.downloadAndCacheFile) {
      await desktop.downloadAndCacheFile(resolvedUrl, url, suggestedName || url.split('/').pop() || 'download');
    }
    const response = await fetch(resolvedUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const fallbackName = url.split('/').pop() || 'download';
    a.download = suggestedName || fallbackName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  } catch {
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName || 'download';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

export function requestNotificationPermissionIfNeeded(): void {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

export function showDesktopNotification(
  title: string,
  body: string,
  icon?: string | null,
  onClick?: () => void
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body,
        icon: icon || '/logo.jpg',
        silent: true
      });
      if (onClick) {
        n.onclick = () => {
          window.focus();
          onClick();
          n.close();
        };
      }
    } catch {
      // ignore
    }
  }
}

export function formatAttachmentPreviewText(msg?: {
  type?: string;
  file_name?: string | null;
  content?: string;
} | null): string {
  if (!msg) return '';
  const trimmed = (msg.content || '').trim();
  if (trimmed && msg.type !== 'voice' && msg.type !== 'video_note') {
    if (msg.type === 'image') return `📷 ${msg.file_name || 'Фото'}: ${trimmed}`;
    if (msg.type === 'video') return `🎬 ${msg.file_name || 'Видео'}: ${trimmed}`;
    if (msg.type === 'audio') return `🎵 ${msg.file_name || 'Аудио'}: ${trimmed}`;
    if (msg.type === 'file') return `📎 ${msg.file_name || 'Файл'}: ${trimmed}`;
    return trimmed;
  }
  switch (msg.type) {
    case 'image':
      return `📷 Фото: ${msg.file_name || 'изображение'}`;
    case 'video':
      return `🎬 Видео: ${msg.file_name || 'видеофайл'}`;
    case 'audio':
      return `🎵 Аудио: ${msg.file_name || 'аудиозапись'}`;
    case 'voice':
      return '🎤 Голосовое сообщение';
    case 'video_note':
      return '📹 Видеокружок';
    case 'sticker':
      return '🎭 Стикер';
    case 'call':
      return '📞 Звонок';
    case 'file':
      return `📎 Файл: ${msg.file_name || 'документ'}`;
    default:
      return trimmed || 'Сообщение';
  }
}


export function resolveMediaUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const desktop = typeof window !== 'undefined' ? (window as any).jessengerDesktop : null;
  if (desktop?.getCachedFileUrlSync) {
    const cached = desktop.getCachedFileUrlSync(url);
    if (cached && !navigator.onLine) return cached;
  }
  if (desktop?.serverUrl && url.startsWith('/uploads/')) {
    return `${desktop.serverUrl}${url}`;
  }
  if (desktop?.serverUrl && (url.startsWith('/sounds/') || url.startsWith('/bg/'))) {
    return `.${url}`;
  }
  return url;
}
