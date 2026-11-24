export interface Track {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  art: string;
  durationMs: number;
  explicit: boolean;
}

export type RequestStatus = 'pending' | 'queued' | 'played';

export interface SongRequest {
  id: string;
  track: Track;
  status: RequestStatus;
  votes: number;
  voted: boolean;
  mine: boolean;
  by: string;
  createdAt: number;
  queuedAt: number;
  playedAt: number;
}

export interface NowPlaying {
  track: Track;
  progressMs: number;
  isPlaying: boolean;
  updatedAt: number;
  source: 'spotify' | 'manual';
}

export interface PartySettings {
  partyName: string;
  requestsOpen: boolean;
  votingOpen: boolean;
  maxPendingPerGuest: number;
  allowExplicit?: boolean;
  autoQueueAt?: number;
  showNames?: boolean;
}

export interface RoomState {
  code: string;
  settings: PartySettings;
  nowPlaying: NowPlaying | null;
  /** The next songs in the DJ's real Spotify queue (when Spotify is connected). */
  upNext: Track[] | null;
  requests: SongRequest[];
  spotify: {
    connected: boolean;
    clientId?: string;
    user?: { name: string; product: string } | null;
    redirectUri?: string;
  };
  listeners: number;
  serverTime: number;
  // DJ only
  guestUrl?: string;
  pin?: string;
  blockedCount?: number;
}
