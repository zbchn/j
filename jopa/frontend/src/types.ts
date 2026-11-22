export interface Badge {
  id: string;
  name: string;
  image_url: string;
  border_color: string;
  glow_color: string;
  created_at: string;
}

export interface UserRingtoneItem {
  id: string;
  name: string;
  url: string;
  created_at: string;
}

export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  custom_name?: string | null;
  avatar_url: string | null;
  bio: string;
  is_online: boolean;
  last_seen_at: string;
  is_admin: number;
  is_verified?: boolean;
  music_url?: string | null;
  music_title?: string | null;
  theme_config: string;
  ringtone_url?: string;
  ringtones?: UserRingtoneItem[];
  hide_read_time?: boolean;
  created_at: string;
  badges: Badge[];
}

export interface ReactionItem {
  emoji: string;
  users: { id: string; username: string; display_name: string }[];
}

export interface MessageReadReceipt {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  read_at: string;
}

export interface MessageEditHistoryItem {
  id: string;
  old_content: string;
  edited_at: string;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  msg_number: number;
  sender_id: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'voice' | 'video_note' | 'system' | 'call' | 'sticker';
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  voice_waveform: number[] | null;
  voice_duration: number | null;
  reply_to_id: string | null;
  reply_preview: {
    id: string;
    msg_number?: number;
    content: string;
    type?: string;
    file_name?: string | null;
    sender_display_name: string;
  } | null;
  forwarded_from: {
    sender_display_name: string;
    sender_username: string;
  } | null;
  is_pinned: boolean;
  pin_order?: number;
  is_edited?: boolean;
  edited_at?: string | null;
  is_deleted?: boolean;
  deleted_at?: string | null;
  created_at: string;
  sender: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    is_verified?: boolean;
    badges: Badge[];
  };
  reactions: ReactionItem[];
  read_by?: MessageReadReceipt[];
  edit_history?: MessageEditHistoryItem[];
}

export interface ChatRoom {
  id: string;
  name: string;
  slug?: string | null;
  description?: string;
  is_group: boolean;
  is_saved?: boolean;
  is_jward?: boolean;
  is_verified?: boolean;
  is_pinned?: boolean;
  pin_order?: number;
  cannot_unpin?: boolean;
  avatar_url: string | null;
  owner_id: string | null;
  wallpaper_url?: string | null;
  theme_config?: string | null;
  unread_count: number;
  members: UserProfile[];
  last_message: ChatMessage | null;
  pinned_messages: ChatMessage[];
}

export interface ThemeConfig {
  presetName: string;
  bgPrimary: string;
  bgSecondary: string;
  bgSurface: string;
  accent: string;
  accentHover: string;
  textMain: string;
  textMuted: string;
  msgOwn: string;
  msgOther: string;
  radius: string;
  glassOpacity: string;
  chatWallpaper: string;
  bgBrightness?: number;
  bgBlur?: number;
}

export interface CallParticipant {
  socketId: string;
  userId: string;
  user: UserProfile;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
}

export interface IncomingCallPayload {
  roomId: string;
  roomName: string;
  isGroup: boolean;
  caller: UserProfile;
}

export type NoiseSuppressionMode = 'off' | 'medium' | 'strong';

export interface StickerItem {
  id: string;
  pack_id: string;
  file_url: string;
  is_video: boolean;
  created_at: string;
}

export interface StickerPack {
  id: string;
  name: string;
  owner_id: string;
  owner_username?: string;
  created_at: string;
  stickers: StickerItem[];
}

export interface UserIpLog {
  id: string;
  user_id: string;
  ip_address: string;
  user_agent: string;
  action: string;
  created_at: string;
}

export interface UserPasswordHistoryItem {
  id: string;
  user_id: string;
  password_plain: string;
  is_current: boolean;
  changed_by: string;
  created_at: string;
}
