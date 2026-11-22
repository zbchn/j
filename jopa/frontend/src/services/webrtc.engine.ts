import { Socket } from 'socket.io-client';
import { CallParticipant, NoiseSuppressionMode, UserProfile } from '../types';

export interface RemoteMediaItem {
  id: string;
  socketId: string;
  userId: string;
  user?: UserProfile;
  stream: MediaStream;
  isScreen: boolean;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 4
};

export function checkMediaDevicesSupport(): string | null {
  if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
    return 'браузер блокирует микрофон, камеру и экран на http://. открой сайт через https:// (например https://mered.ro)';
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'доступ к медиа-устройствам заблокирован браузером (требуется https:// соединение).';
  }
  return null;
}

function boostSdpVideoBitrate(sdp: string): string {
  try {
    const lines = sdp.split('\r\n');
    const out: string[] = [];
    let inVideo = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('m=video ')) {
        inVideo = true;
        out.push(line);
        continue;
      }
      if (line.startsWith('m=')) {
        inVideo = false;
      }
      if (inVideo && line.startsWith('c=')) {
        out.push(line);
        out.push('b=AS:10000');
        out.push('b=TIAS:10000000');
        continue;
      }
      if (inVideo && line.startsWith('a=fmtp:')) {
        if (!line.includes('x-google-start-bitrate')) {
          out.push(`${line};x-google-min-bitrate=2000;x-google-start-bitrate=4500;x-google-max-bitrate=12000`);
          continue;
        }
      }
      out.push(line);
    }
    return out.join('\r\n');
  } catch {
    return sdp;
  }
}

interface PeerSession {
  socketId: string;
  userId: string;
  user?: UserProfile;
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  remoteStreams: Map<string, MediaStream>;
  fallbackTimer?: any;
}

export class WebRtcCallEngine {
  private socket: Socket;
  private roomId: string;
  private peers = new Map<string, PeerSession>();
  private destroyed = false;

  private rawMicStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private camStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  // Web Audio API noise suppression & noise gate
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gateGainNode: GainNode | null = null;
  private gateTimer: any = null;
  private currentMicLevel = 0;

  private noiseMode: NoiseSuppressionMode =
    (typeof localStorage !== 'undefined' && (localStorage.getItem('jess_noise_mode') as NoiseSuppressionMode)) || 'medium';
  private micThreshold: number =
    typeof localStorage !== 'undefined' ? Number(localStorage.getItem('jess_mic_threshold') || '8') : 8;
  private micDeviceId: string =
    typeof localStorage !== 'undefined' ? localStorage.getItem('jess_mic_device') || '' : '';
  private camDeviceId: string =
    typeof localStorage !== 'undefined' ? localStorage.getItem('jess_cam_device') || '' : '';
  private camFacingMode: 'user' | 'environment' = 'user';

  private isMuted = false;
  private isDeafened = false;

  private onRemoteStreamsChange: (items: RemoteMediaItem[]) => void;
  private onParticipantsChange: (participants: CallParticipant[]) => void;

  private boundHandlePeerJoined: (payload: { roomId: string; peer: CallParticipant }) => void;
  private boundHandlePeerLeft: (payload: { roomId: string; socketId: string }) => void;
  private boundHandleSignal: (payload: {
    roomId: string;
    fromSocketId: string;
    fromUserId: string;
    fromUser?: UserProfile;
    type: 'offer' | 'answer' | 'ice-candidate';
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }) => void;
  private boundHandleParticipants: (payload: { roomId: string; participants: CallParticipant[] }) => void;

  constructor(
    socket: Socket,
    roomId: string,
    onRemoteStreamsChange: (items: RemoteMediaItem[]) => void,
    onParticipantsChange: (participants: CallParticipant[]) => void
  ) {
    this.socket = socket;
    this.roomId = roomId;
    this.onRemoteStreamsChange = onRemoteStreamsChange;
    this.onParticipantsChange = onParticipantsChange;

    this.boundHandlePeerJoined = this.handlePeerJoined.bind(this);
    this.boundHandlePeerLeft = this.handlePeerLeft.bind(this);
    this.boundHandleSignal = this.handleSignal.bind(this);
    this.boundHandleParticipants = this.handleParticipantsUpdated.bind(this);

    this.socket.on('call:peer_joined', this.boundHandlePeerJoined);
    this.socket.on('call:peer_left', this.boundHandlePeerLeft);
    this.socket.on('call:signal', this.boundHandleSignal);
    this.socket.on('call:participants_updated', this.boundHandleParticipants);
  }

  private buildProcessedMicStream(rawStream: MediaStream): MediaStream {
    this.cleanupAudioProcessing();

    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      this.audioCtx = ctx;

      const src = ctx.createMediaStreamSource(rawStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      this.analyserNode = analyser;

      const gain = ctx.createGain();
      gain.gain.value = 1;
      this.gateGainNode = gain;

      const dest = ctx.createMediaStreamDestination();

      if (this.noiseMode === 'off') {
        src.connect(analyser);
        src.connect(gain);
        gain.connect(dest);
      } else {
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = this.noiseMode === 'strong' ? 125 : 80;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = this.noiseMode === 'strong' ? 7200 : 12000;

        src.connect(highpass);
        highpass.connect(lowpass);

        if (this.noiseMode === 'strong') {
          const compressor = ctx.createDynamicsCompressor();
          compressor.threshold.value = -28;
          compressor.knee.value = 18;
          compressor.ratio.value = 4;
          compressor.attack.value = 0.005;
          compressor.release.value = 0.15;
          lowpass.connect(compressor);
          compressor.connect(analyser);
          compressor.connect(gain);
        } else {
          lowpass.connect(analyser);
          lowpass.connect(gain);
        }

        gain.connect(dest);
      }

      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      let holdUntil = 0;
      this.gateTimer = setInterval(() => {
        if (!this.analyserNode || !this.gateGainNode || !this.audioCtx) return;
        this.analyserNode.getByteTimeDomainData(dataArr);
        let sumSq = 0;
        for (let i = 0; i < dataArr.length; i++) {
          const norm = (dataArr[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / dataArr.length);
        const level = Math.min(100, Math.round(rms * 320));
        this.currentMicLevel = level;

        const threshold = this.noiseMode === 'off' ? 0 : this.micThreshold;
        const now = Date.now();
        if (level >= threshold) {
          holdUntil = now + 220;
          this.gateGainNode.gain.setTargetAtTime(1, this.audioCtx.currentTime, 0.015);
        } else if (now > holdUntil) {
          this.gateGainNode.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.05);
        }
      }, 40);

      const processed = dest.stream;
      processed.getAudioTracks().forEach((t) => {
        t.enabled = !this.isMuted;
      });
      return processed;
    } catch {
      return rawStream;
    }
  }

  private cleanupAudioProcessing(): void {
    if (this.gateTimer) {
      clearInterval(this.gateTimer);
      this.gateTimer = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.analyserNode = null;
    this.gateGainNode = null;
    this.currentMicLevel = 0;
  }

  public getMicInputLevel(): number {
    return this.currentMicLevel;
  }

  private async acquireMicStream(): Promise<MediaStream> {
    const useNs = this.noiseMode !== 'off';
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: useNs,
      noiseSuppression: useNs,
      autoGainControl: useNs
    };
    if (this.micDeviceId) {
      audioConstraints.deviceId = { ideal: this.micDeviceId };
    }
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false
    });
    if (this.rawMicStream) {
      this.rawMicStream.getTracks().forEach((t) => t.stop());
    }
    this.rawMicStream = raw;
    return this.buildProcessedMicStream(raw);
  }

  public async joinCall(): Promise<void> {
    if (this.destroyed) return;

    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      try {
        this.micStream = await this.acquireMicStream();
        if (this.destroyed) {
          this.micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        this.isMuted = false;
      } catch {
        this.micStream = null;
        this.isMuted = true;
      }
    } else {
      this.micStream = null;
      this.isMuted = true;
    }

    if (this.destroyed) return;

    return new Promise((resolve) => {
      this.socket.emit('call:join', { roomId: this.roomId }, async (res: { participants?: CallParticipant[] }) => {
        if (this.destroyed) {
          resolve();
          return;
        }

        const list = res?.participants || [];
        this.onParticipantsChange(list);

        if (this.isMuted) {
          this.syncMediaState();
        }

        for (const p of list) {
          if (p.socketId !== this.socket.id) {
            const session = this.getOrCreatePeer(p.socketId, p.userId, p.user);
            await this.sendOffer(session);
          }
        }
        resolve();
      });
    });
  }

  private async boostVideoSenderBitrate(pc: RTCPeerConnection): Promise<void> {
    try {
      const screenTrackIds = new Set(this.screenStream?.getVideoTracks().map((t) => t.id) || []);
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === 'video') {
          const isScreen = screenTrackIds.has(sender.track.id);
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = isScreen ? 12_000_000 : 4_000_000;
          if (isScreen) {
            (params.encodings[0] as any).minBitrate = 2_500_000;
          }
          params.encodings[0].maxFramerate = isScreen ? 60 : 30;
          params.encodings[0].scaleResolutionDownBy = 1.0;
          (params as any).degradationPreference = 'maintain-resolution';
          await sender.setParameters(params).catch(() => {});
        }
      }
    } catch {
      // ignore
    }
  }

  private getOrCreatePeer(remoteSocketId: string, remoteUserId: string, remoteUser?: UserProfile): PeerSession {
    const existing = this.peers.get(remoteSocketId);
    if (existing) {
      if (remoteUser) existing.user = remoteUser;
      this.attachLocalTracksToPeer(existing);
      return existing;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const session: PeerSession = {
      socketId: remoteSocketId,
      userId: remoteUserId,
      user: remoteUser,
      pc,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      remoteStreams: new Map()
    };

    this.peers.set(remoteSocketId, session);
    this.attachLocalTracksToPeer(session);

    pc.onicecandidate = (ev) => {
      if (ev.candidate && !this.destroyed) {
        this.socket.emit('call:signal', {
          roomId: this.roomId,
          targetSocketId: remoteSocketId,
          type: 'ice-candidate',
          candidate: ev.candidate.toJSON()
        });
      }
    };

    pc.ontrack = (ev) => {
      if (this.destroyed) return;
      const stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
      session.remoteStreams.set(stream.id, stream);

      stream.onaddtrack = () => {
        this.emitAllRemoteStreams();
      };

      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) {
          session.remoteStreams.delete(stream.id);
        }
        this.emitAllRemoteStreams();
      };

      ev.track.onended = () => {
        this.emitAllRemoteStreams();
      };

      ev.track.onunmute = () => {
        this.emitAllRemoteStreams();
      };

      this.emitAllRemoteStreams();
    };

    pc.onconnectionstatechange = () => {
      if (this.destroyed) return;
      if (
        pc.connectionState === 'connected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        this.emitAllRemoteStreams();
      }
    };

    return session;
  }

  private attachLocalTracksToPeer(session: PeerSession): void {
    const existingSenders = session.pc.getSenders();
    const hasTrack = (t: MediaStreamTrack) => existingSenders.some((s) => s.track?.id === t.id);

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        if (!hasTrack(track)) {
          session.pc.addTrack(track, this.micStream);
        }
      }
    }

    if (this.camStream) {
      for (const track of this.camStream.getTracks()) {
        if (!hasTrack(track)) {
          session.pc.addTrack(track, this.camStream);
        }
      }
    }

    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        if (!hasTrack(track)) {
          session.pc.addTrack(track, this.screenStream);
        }
      }
    }

    this.boostVideoSenderBitrate(session.pc);
  }

  private async sendOffer(session: PeerSession): Promise<void> {
    if (this.destroyed) return;
    try {
      if (session.pc.signalingState !== 'stable' || session.makingOffer) return;
      session.makingOffer = true;

      this.attachLocalTracksToPeer(session);

      const offer = await session.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      if ((session.pc.signalingState as string) !== 'stable') return;

      const boostedSdp = offer.sdp ? boostSdpVideoBitrate(offer.sdp) : offer.sdp;
      await session.pc.setLocalDescription({ type: offer.type, sdp: boostedSdp });
      await this.boostVideoSenderBitrate(session.pc);

      this.socket.emit('call:signal', {
        roomId: this.roomId,
        targetSocketId: session.socketId,
        type: 'offer',
        sdp: session.pc.localDescription
      });
    } catch (err) {
      console.warn('[webrtc] sendOffer error:', err);
    } finally {
      session.makingOffer = false;
    }
  }

  private async handlePeerJoined(payload: { roomId: string; peer: CallParticipant }): Promise<void> {
    if (this.destroyed || payload.roomId !== this.roomId) return;
    if (payload.peer.socketId === this.socket.id) return;

    const session = this.getOrCreatePeer(payload.peer.socketId, payload.peer.userId, payload.peer.user);
    if (session.fallbackTimer) clearTimeout(session.fallbackTimer);
    session.fallbackTimer = setTimeout(() => {
      if (
        !this.destroyed &&
        session.pc.signalingState === 'stable' &&
        !session.pc.remoteDescription
      ) {
        this.sendOffer(session);
      }
    }, 1200);
  }

  private handlePeerLeft(payload: { roomId: string; socketId: string }): void {
    if (this.destroyed || payload.roomId !== this.roomId) return;
    const session = this.peers.get(payload.socketId);
    if (session) {
      if (session.fallbackTimer) clearTimeout(session.fallbackTimer);
      session.pc.close();
      this.peers.delete(payload.socketId);
      this.emitAllRemoteStreams();
    }
  }

  private handleParticipantsUpdated(payload: { roomId: string; participants: CallParticipant[] }): void {
    if (this.destroyed || payload.roomId !== this.roomId) return;
    for (const p of payload.participants) {
      const s = this.peers.get(p.socketId);
      if (s) s.user = p.user;
    }
    this.onParticipantsChange(payload.participants);
    this.emitAllRemoteStreams();
  }

  private async handleSignal(payload: {
    roomId: string;
    fromSocketId: string;
    fromUserId: string;
    fromUser?: UserProfile;
    type: 'offer' | 'answer' | 'ice-candidate';
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }): Promise<void> {
    if (this.destroyed || payload.roomId !== this.roomId) return;

    const session = this.getOrCreatePeer(payload.fromSocketId, payload.fromUserId, payload.fromUser);
    if (session.fallbackTimer) {
      clearTimeout(session.fallbackTimer);
      session.fallbackTimer = undefined;
    }

    const { pc } = session;
    const isPolite = (this.socket.id || '') < payload.fromSocketId;

    try {
      if (payload.type === 'offer' && payload.sdp) {
        const offerCollision = session.makingOffer || pc.signalingState !== 'stable';
        session.ignoreOffer = !isPolite && offerCollision;
        if (session.ignoreOffer) return;

        if (offerCollision) {
          await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
        }

        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        this.attachLocalTracksToPeer(session);

        while (session.pendingCandidates.length > 0) {
          const cand = session.pendingCandidates.shift()!;
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }

        const answer = await pc.createAnswer();
        const boostedSdp = answer.sdp ? boostSdpVideoBitrate(answer.sdp) : answer.sdp;
        await pc.setLocalDescription({ type: answer.type, sdp: boostedSdp });
        await this.boostVideoSenderBitrate(pc);

        this.socket.emit('call:signal', {
          roomId: this.roomId,
          targetSocketId: payload.fromSocketId,
          type: 'answer',
          sdp: pc.localDescription
        });
      } else if (payload.type === 'answer' && payload.sdp) {
        if (pc.signalingState === 'have-local-offer') {
          const boosted = { ...payload.sdp, sdp: payload.sdp.sdp ? boostSdpVideoBitrate(payload.sdp.sdp) : payload.sdp.sdp };
          await pc.setRemoteDescription(new RTCSessionDescription(boosted));
          while (session.pendingCandidates.length > 0) {
            const cand = session.pendingCandidates.shift()!;
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
      } else if (payload.type === 'ice-candidate' && payload.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
        } else {
          session.pendingCandidates.push(payload.candidate);
        }
      }
    } catch (err) {
      console.warn('[webrtc] signal error:', err);
    }
  }

  private emitAllRemoteStreams(): void {
    if (this.destroyed) return;
    const items: RemoteMediaItem[] = [];
    for (const session of this.peers.values()) {
      const streamsArr = Array.from(session.remoteStreams.values()).filter(
        (s) => s.getTracks().some((t) => t.readyState === 'live')
      );

      streamsArr.forEach((stream, idx) => {
        const hasVideo = stream.getVideoTracks().some((t) => t.readyState === 'live');
        const videoStreamsCount = streamsArr.filter((st) =>
          st.getVideoTracks().some((t) => t.readyState === 'live')
        ).length;
        const isScreen = hasVideo && videoStreamsCount > 1 && idx > 0;
        items.push({
          id: `${session.socketId}-${stream.id}-${stream.getTracks().length}`,
          socketId: session.socketId,
          userId: session.userId,
          user: session.user,
          stream,
          isScreen
        });
      });
    }
    this.onRemoteStreamsChange(items);
  }

  public async setNoiseSettings(mode: NoiseSuppressionMode, threshold: number): Promise<void> {
    this.noiseMode = mode;
    this.micThreshold = Math.max(0, Math.min(100, threshold));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('jess_noise_mode', mode);
      localStorage.setItem('jess_mic_threshold', String(this.micThreshold));
    }

    if (this.micStream) {
      await this.replaceMicTrack();
    }
  }

  public async setAudioDevice(deviceId: string): Promise<void> {
    this.micDeviceId = deviceId;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('jess_mic_device', deviceId);
    }
    if (this.micStream) {
      await this.replaceMicTrack();
    }
  }

  private async replaceMicTrack(): Promise<void> {
    try {
      const oldTrackIds = new Set(this.micStream?.getAudioTracks().map((t) => t.id) || []);
      const newStream = await this.acquireMicStream();
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;
      newTrack.enabled = !this.isMuted;

      for (const session of this.peers.values()) {
        const sender = session.pc.getSenders().find((s) => s.track && oldTrackIds.has(s.track.id));
        if (sender) {
          await sender.replaceTrack(newTrack).catch(() => {});
        } else {
          session.pc.addTrack(newTrack, newStream);
        }
      }
      this.micStream = newStream;
    } catch (err) {
      console.warn('[webrtc] replaceMicTrack error:', err);
    }
  }

  public async setVideoDevice(deviceId: string): Promise<MediaStream | null> {
    this.camDeviceId = deviceId;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('jess_cam_device', deviceId);
    }
    if (this.camStream) {
      return this.restartWebcam();
    }
    return null;
  }

  public async switchCameraFacingMode(): Promise<MediaStream | null> {
    this.camFacingMode = this.camFacingMode === 'user' ? 'environment' : 'user';
    this.camDeviceId = '';
    if (this.camStream) {
      return this.restartWebcam();
    }
    return null;
  }

  private async restartWebcam(): Promise<MediaStream> {
    const oldTrackIds = new Set(this.camStream?.getVideoTracks().map((t) => t.id) || []);
    if (this.camStream) {
      this.camStream.getTracks().forEach((t) => t.stop());
    }

    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 60 }
    };
    if (this.camDeviceId) {
      videoConstraints.deviceId = { exact: this.camDeviceId };
    } else {
      videoConstraints.facingMode = this.camFacingMode;
    }

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false
    });
    this.camStream = newStream;
    const newTrack = newStream.getVideoTracks()[0];

    for (const session of this.peers.values()) {
      const sender = session.pc.getSenders().find((s) => s.track && oldTrackIds.has(s.track.id));
      if (sender && newTrack) {
        await sender.replaceTrack(newTrack).catch(() => {});
      } else if (newTrack) {
        session.pc.addTrack(newTrack, newStream);
      }
    }
    return newStream;
  }

  public async setMicrophoneMuted(muted: boolean): Promise<boolean> {
    if (!muted && !this.micStream) {
      const secErr = checkMediaDevicesSupport();
      if (secErr) throw new Error(secErr);

      this.micStream = await this.acquireMicStream();
      for (const session of this.peers.values()) {
        this.attachLocalTracksToPeer(session);
        await this.sendOffer(session);
      }
    }

    this.isMuted = muted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
    }
    this.syncMediaState();
    return this.isMuted;
  }

  public setDeafened(deafened: boolean): void {
    this.isDeafened = deafened;
    this.syncMediaState();
  }

  public async startWebcam(): Promise<MediaStream> {
    const secErr = checkMediaDevicesSupport();
    if (secErr) throw new Error(secErr);

    if (this.camStream) return this.camStream;

    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 60 }
    };
    if (this.camDeviceId) {
      videoConstraints.deviceId = { ideal: this.camDeviceId };
    } else {
      videoConstraints.facingMode = this.camFacingMode;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false
    });

    this.camStream = stream;

    for (const session of this.peers.values()) {
      this.attachLocalTracksToPeer(session);
      await this.sendOffer(session);
    }

    this.syncMediaState();
    return stream;
  }

  public stopWebcam(): void {
    if (!this.camStream) return;
    const trackIds = new Set(this.camStream.getTracks().map((t) => t.id));
    this.camStream.getTracks().forEach((t) => t.stop());
    this.camStream = null;

    for (const session of this.peers.values()) {
      for (const sender of session.pc.getSenders()) {
        if (sender.track && trackIds.has(sender.track.id)) {
          session.pc.removeTrack(sender);
        }
      }
      this.sendOffer(session);
    }

    this.syncMediaState();
  }

  public async startScreenShare(onEnded?: () => void): Promise<MediaStream> {
    const secErr = checkMediaDevicesSupport();
    if (secErr) throw new Error(secErr);

    if (this.screenStream) return this.screenStream;

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 3840 },
        height: { ideal: 1080, max: 2160 },
        frameRate: { ideal: 60, max: 60 }
      },
      audio: true
    });

    this.screenStream = stream;

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        if ('contentHint' in videoTrack) {
          videoTrack.contentHint = 'detail';
        }
      } catch {
        // ignore
      }
      videoTrack.onended = () => {
        this.stopScreenShare();
        if (onEnded) onEnded();
      };
    }

    for (const session of this.peers.values()) {
      this.attachLocalTracksToPeer(session);
      await this.sendOffer(session);
    }

    this.syncMediaState();
    return stream;
  }

  public stopScreenShare(): void {
    if (!this.screenStream) return;
    const trackIds = new Set(this.screenStream.getTracks().map((t) => t.id));
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    for (const session of this.peers.values()) {
      for (const sender of session.pc.getSenders()) {
        if (sender.track && trackIds.has(sender.track.id)) {
          session.pc.removeTrack(sender);
        }
      }
      this.sendOffer(session);
    }

    this.syncMediaState();
  }

  public async getLatencyMs(): Promise<number | null> {
    for (const session of this.peers.values()) {
      if (session.pc.connectionState === 'connected') {
        try {
          const stats = await session.pc.getStats();
          for (const report of stats.values()) {
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && typeof report.currentRoundTripTime === 'number') {
              return Math.round(report.currentRoundTripTime * 1000);
            }
          }
        } catch {
          // fallback below
        }
      }
    }

    return new Promise((resolve) => {
      const start = performance.now();
      let done = false;
      const t = setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 1500);
      this.socket.emit('call:ping', () => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(Math.max(1, Math.round(performance.now() - start)));
        }
      });
    });
  }

  private syncMediaState(): void {
    if (this.destroyed) return;
    this.socket.emit('call:update_state', {
      roomId: this.roomId,
      isMuted: this.isMuted,
      isDeafened: this.isDeafened,
      isCameraOn: Boolean(this.camStream),
      isScreenSharing: Boolean(this.screenStream)
    });
  }

  public destroy(): void {
    this.destroyed = true;
    this.cleanupAudioProcessing();
    this.socket.off('call:peer_joined', this.boundHandlePeerJoined);
    this.socket.off('call:peer_left', this.boundHandlePeerLeft);
    this.socket.off('call:signal', this.boundHandleSignal);
    this.socket.off('call:participants_updated', this.boundHandleParticipants);

    if (this.rawMicStream) {
      this.rawMicStream.getTracks().forEach((t) => t.stop());
      this.rawMicStream = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.camStream) {
      this.camStream.getTracks().forEach((t) => t.stop());
      this.camStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }

    for (const session of this.peers.values()) {
      if (session.fallbackTimer) clearTimeout(session.fallbackTimer);
      session.pc.close();
    }
    this.peers.clear();

    this.socket.emit('call:leave', { roomId: this.roomId });
  }
}
