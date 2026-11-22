import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../config';

const subDirs = [
  'avatars',
  'badges',
  'attachments',
  'voice',
  'video_notes',
  'ringtones',
  'wallpapers',
  'music',
  'stickers',
  'chunks'
];
for (const dir of subDirs) {
  const fullPath = path.join(CONFIG.UPLOADS_DIR, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
}

function createStorage(folderName: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(CONFIG.UPLOADS_DIR, folderName));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${uuidv4()}${ext}`);
    }
  });
}

function isAnimatedOrImage(file: Express.Multer.File): boolean {
  const mime = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();
  return (
    mime.startsWith('image/') ||
    mime === 'video/mp4' ||
    mime === 'video/webm' ||
    mime === 'video/quicktime' ||
    ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.apng', '.svg', '.mp4', '.webm', '.mov'].includes(ext)
  );
}

export const uploadAvatar = multer({
  storage: createStorage('avatars'),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAnimatedOrImage(file)) {
      cb(null, true);
    } else {
      cb(new Error('разрешены изображения, gif, webp, mp4 и webm.'));
    }
  }
});

export const uploadBadgeIcon = multer({
  storage: createStorage('badges'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAnimatedOrImage(file)) {
      cb(null, true);
    } else {
      cb(new Error('разрешены изображения, gif, webp, mp4 и webm.'));
    }
  }
});

export const uploadSticker = multer({
  storage: createStorage('stickers'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAnimatedOrImage(file)) {
      cb(null, true);
    } else {
      cb(new Error('разрешены изображения, gif, webp, mp4, mov и webm.'));
    }
  }
});

export const uploadWallpaper = multer({
  storage: createStorage('wallpapers'),
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAnimatedOrImage(file)) {
      cb(null, true);
    } else {
      cb(new Error('разрешены изображения или видео для обоев.'));
    }
  }
});

export const uploadRingtone = multer({
  storage: createStorage('ringtones'),
  limits: { fileSize: 150 * 1024 * 1024 }
});

export const uploadMusic = multer({
  storage: createStorage('music'),
  limits: { fileSize: 150 * 1024 * 1024 }
});

export const uploadAttachment = multer({
  storage: createStorage('attachments'),
  limits: { fileSize: 1024 * 1024 * 1024 }
});

export const uploadVoice = multer({
  storage: createStorage('voice'),
  limits: { fileSize: 150 * 1024 * 1024 }
});

export const uploadVideoNote = multer({
  storage: createStorage('video_notes'),
  limits: { fileSize: 250 * 1024 * 1024 }
});
