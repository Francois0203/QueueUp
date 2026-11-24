import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Button, EmptyState, Icon, Sheet, SkeletonRows, SongRow, SpotifyAttribution, SuccessCheck, TextField, useToast,
} from '../../components';
import type { RoomState, Track } from '../../types';
import { call, haptics, KEYS, spring, storage } from '../../lib';
import styles from './Guest.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  code: string;
  state: RoomState;
  onRequested: (id: string) => void;
}

interface Result { title: string; text: string }

export function RequestSheet({ open, onClose, code, state, onRequested }: Props) {
  const [name, setName] = useState(() => storage.get(KEYS.guestName));
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [success, setSuccess] = useState<Result | null>(null);
  const [manual, setManual] = useState({ title: '', artist: '' });
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const seq = useRef(0);
  const spotify = state.spotify.connected;

  useEffect(() => { storage.set(KEYS.guestName, name.trim()); }, [name]);
  useEffect(() => { if (open) { setSuccess(null); setPicked(null); } }, [open]);

  // Debounced search; stale responses are ignored.
  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults(null); setSearching(false); setSearchError(''); return; }
    setSearching(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const { results } = await call<{ results: Track[] }>('search', { code, q: query });
        if (id === seq.current) { setResults(results); setSearchError(''); }
      } catch (e) {
        if (id === seq.current) setSearchError((e as Error).message);
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, 260);
    return () => clearTimeout(t);
  }, [q, code]);

  const send = async (body: Record<string, unknown>) => {
    const res = await call<{ id?: string; merged?: boolean; status?: string }>('request', { code, ...body, name });
    haptics.success();
    if (res.id) onRequested(res.id);
    setSuccess(res.merged
      ? res.status === 'queued' ? { title: 'Already queued', text: 'Good taste — it’s coming up.' } : { title: 'Vote added', text: 'Someone beat you to it. Your vote counts.' }
      : { title: 'Request sent', text: 'Get the room to vote for it.' });
    setTimeout(() => { onClose(); setQ(''); setResults(null); }, 1500);
  };

  const pick = async (t: Track) => {
    if (picked) return;
    setPicked(t.id);
    try { const { sig, ...track } = t as Track & { sig?: string }; await send({ track, sig }); }
    catch (e) { setPicked(null); haptics.error(); toast((e as Error).message, { error: true }); }
  };

  const submitManual = async (e: FormEvent) => {
    e.preventDefault();
    if (!manual.title.trim()) return;
    setSending(true);
    try { await send(manual); setManual({ title: '', artist: '' }); }
    catch (err) { haptics.error(); toast((err as Error).message, { error: true }); }
    finally { setSending(false); }
  };

  const statusOf = new Map(state.requests.map(r => [r.track.id, r.status]));

  return (
    <Sheet open={open} onClose={onClose} title="Request a song"
      overlay={success && <SuccessCheck key="ok" title={success.title} text={success.text} />}
      header={
        <div className={styles.sheetTop}>
          <div className={styles.from}>
            <span>From</span>
            <TextField variant="subtle" maxLength={24} placeholder="Your name (optional)" autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} aria-label="Your name" />
          </div>
          {spotify && (
            <TextField icon="search" type="search" placeholder="Search songs or artists" autoComplete="off" enterKeyHint="search"
              autoFocus value={q} onChange={e => setQ(e.target.value)} aria-label="Search songs" />
          )}
        </div>
      }
      footer={<p className={styles.notice}>Your name and request may be visible to others at this party. <a href="/terms" target="_blank">Terms</a> · <a href="/privacy" target="_blank">Privacy</a></p>}
    >
      {spotify ? (
        <>
          <AnimatePresence mode="wait" initial={false}>
            {searching && !results ? (
              <motion.div key="sk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><SkeletonRows /></motion.div>
            ) : searchError ? (
              <EmptyState key="err" icon="alert" title="Search unavailable">{searchError}</EmptyState>
            ) : results && results.length === 0 ? (
              <EmptyState key="none" icon="search" title="No matches">Try a different spelling.</EmptyState>
            ) : results ? (
              <motion.ul key="res" className={styles.list} initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {results.map((t, i) => {
                  const st = statusOf.get(t.id);
                  const done = picked === t.id;
                  return (
                    <SongRow key={t.id} track={t} variant="result" delay={i * 0.035} onClick={() => pick(t)}
                      detail={st === 'queued' ? 'already queued' : st === 'pending' ? 'requested · tap to vote' : ''}>
                      <motion.span className={`${styles.add} ${done ? styles.added : ''}`} animate={{ rotate: done ? 360 : 0, scale: done ? 1.1 : 1 }} transition={spring.pop}>
                        <Icon name={done ? 'check' : 'plus'} size={18} strokeWidth={2.6} />
                      </motion.span>
                    </SongRow>
                  );
                })}
              </motion.ul>
            ) : (
              <EmptyState key="start" icon="search" title="Find your song">Search by title or artist.</EmptyState>
            )}
          </AnimatePresence>
          <SpotifyAttribution />
        </>
      ) : (
        <form onSubmit={submitManual}>
          <TextField id="mTitle" label="Song" maxLength={120} required placeholder="Song title" autoFocus value={manual.title} onChange={e => setManual(m => ({ ...m, title: e.target.value }))} />
          <TextField id="mArtist" label="Artist" maxLength={120} placeholder="Artist (optional)" value={manual.artist} onChange={e => setManual(m => ({ ...m, artist: e.target.value }))} />
          <Button type="submit" variant="primary" size="lg" block loading={sending} disabled={!manual.title.trim()}>Send request</Button>
        </form>
      )}
    </Sheet>
  );
}
