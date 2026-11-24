import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import type { RoomState, SongRequest, NowPlaying, PartySettings } from '../types';
import { db, ensureUser, SPOTIFY_REDIRECT_URI } from '../lib';

export type RoomStatus = 'connecting' | 'live' | 'reconnecting' | 'ended';

interface RequestDoc { trackId: string; track: SongRequest['track']; status: SongRequest['status'] | 'dismissed' | 'skipped'; votes: string[]; byUid: string; byName: string; createdAt: number; queuedAt: number; playedAt: number }

/**
 * Live party state straight from Firestore (no server connection to keep open).
 * Guests see active requests; the DJ also sees played songs, requester names and DJ data.
 */
export function useRoom(code: string, { dj = false, enabled = true } = {}) {
  const [uid, setUid] = useState<string | null>(null);
  const [party, setParty] = useState<DocumentData | null>(null);
  const [requests, setRequests] = useState<{ id: string; data: RequestDoc }[]>([]);
  const [djData, setDjData] = useState<DocumentData | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState<RoomStatus>('connecting');

  useEffect(() => {
    if (!enabled || !code) return;
    let cancelled = false;
    const unsubs: (() => void)[] = [];

    ensureUser().then(id => {
      if (cancelled) return;
      setUid(id);
      const partyRef = doc(db, 'parties', code);

      unsubs.push(onSnapshot(partyRef, { includeMetadataChanges: true }, snap => {
        if (!snap.exists()) {
          // Only trust "gone" when the server confirms it, not a cold cache.
          if (!snap.metadata.fromCache) setStatus('ended');
          return;
        }
        setParty(snap.data());
        setStatus(snap.metadata.fromCache ? 'reconnecting' : 'live');
      }, () => setStatus('reconnecting')));

      const statuses = dj ? ['pending', 'queued', 'played'] : ['pending', 'queued'];
      unsubs.push(onSnapshot(query(collection(partyRef, 'requests'), where('status', 'in', statuses)), snap => {
        setRequests(snap.docs.map(d => ({ id: d.id, data: d.data() as RequestDoc })));
      }, () => {}));

      if (dj) {
        unsubs.push(onSnapshot(doc(partyRef, 'private', 'dj'), snap => setDjData(snap.data() ?? null), () => setDjData(null)));
        unsubs.push(onSnapshot(collection(partyRef, 'requestMeta'), snap => {
          setNames(new Map(snap.docs.map(d => [d.id, (d.data().name as string) || ''])));
        }, () => {}));
      }
    }).catch(() => setStatus('reconnecting'));

    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, [code, dj, enabled]);

  const state = useMemo<RoomState | null>(() => {
    if (!party || !uid) return null;
    const mapped: SongRequest[] = requests.map(({ id, data }) => ({
      id,
      track: data.track,
      status: data.status as SongRequest['status'],
      votes: data.votes?.length ?? 0,
      voted: data.votes?.includes(uid) ?? false,
      mine: data.byUid === uid,
      by: dj ? names.get(id) ?? data.byName ?? '' : data.byName ?? '',
      createdAt: data.createdAt,
      queuedAt: data.queuedAt || 0,
      playedAt: data.playedAt || 0,
    }));
    const rank = { queued: 0, pending: 1, played: 2 } as const;
    mapped.sort((a, b) => rank[a.status] - rank[b.status]
      || (a.status === 'queued' ? a.queuedAt - b.queuedAt
        : a.status === 'played' ? b.playedAt - a.playedAt
        : b.votes - a.votes || a.createdAt - b.createdAt));

    return {
      code,
      settings: { partyName: party.name, ...(party.settings as Omit<PartySettings, 'partyName'>) },
      nowPlaying: (party.nowPlaying as NowPlaying | null) ?? null,
      requests: mapped,
      spotify: {
        connected: Boolean(party.spotifyConnected),
        clientId: djData?.spotify?.clientId,
        user: djData?.spotify?.user ?? null,
        redirectUri: SPOTIFY_REDIRECT_URI,
      },
      listeners: party.guestCount ?? 0,
      serverTime: Date.now(),
      ...(dj ? {
        guestUrl: `${window.location.origin}/p/${code}`,
        pin: djData?.pin,
        blockedCount: djData?.blocked?.length ?? 0,
      } : {}),
    };
  }, [party, requests, djData, names, uid, dj, code]);

  return { state, status, clockOffset: 0, uid };
}
