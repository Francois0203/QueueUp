import { AnimatePresence, motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { AnimatedNumber, Button, EmptyState, NowPlayingMini, SectionHeader, SongRow, TextField, useToast } from '../../components';
import type { RoomState, SongRequest } from '../../types';
import { call, haptics, plural } from '../../lib';
import styles from './Dj.module.css';

type Action = 'queue' | 'dismiss' | 'playing' | 'restore' | 'block';

export function RequestsPanel({ code, state, freshIds }: { code: string; state: RoomState; freshIds: string[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [np, setNp] = useState({ title: '', artist: '' });
  const connected = state.spotify.connected;

  const act = async (r: SongRequest, action: Action) => {
    if (action === 'block' && !confirm('Block this guest? Their open requests are removed and they can’t request or vote at this party anymore.')) return;
    setBusy(`${r.id}:${action}`);
    try {
      await call('action', { code, id: r.id, action });
      if (action === 'queue') { haptics.success(); toast(connected && r.track.uri ? 'Added to Spotify queue' : 'Queued'); }
      if (action === 'block') toast('Guest blocked');
    } catch (e) {
      haptics.error();
      toast((e as Error).message, { error: true, ms: 5000 });
    } finally { setBusy(null); }
  };

  const saveNowPlaying = async (e?: FormEvent, clear = false) => {
    e?.preventDefault();
    try {
      await call('nowPlaying', { code, ...(clear ? { title: '' } : np) });
      setEditing(false);
    } catch (err) { toast((err as Error).message, { error: true }); }
  };

  const queued = state.requests.filter(r => r.status === 'queued');
  const pending = state.requests.filter(r => r.status === 'pending');
  const played = state.requests.filter(r => r.status === 'played').sort((a, b) => b.playedAt - a.playedAt).slice(0, 15);
  const detail = (r: SongRequest) => [r.by && `from ${r.by}`, !r.track.uri && connected && 'typed in'].filter(Boolean).join(' · ');
  const isBusy = (r: SongRequest, a: Action) => busy === `${r.id}:${a}`;

  return (
    <>
      <NowPlayingMini np={state.nowPlaying} hint={connected ? 'Start playback in Spotify' : 'Set it manually, or connect Spotify'}
        action={!connected && <Button size="sm" onClick={() => { setNp({ title: state.nowPlaying?.track.title ?? '', artist: state.nowPlaying?.track.artist ?? '' }); setEditing(v => !v); }}>Set</Button>} />

      <AnimatePresence initial={false}>
        {editing && (
          <motion.form key="np" onSubmit={saveNowPlaying} className={styles.npForm}
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <div className={styles.npInner}>
              <TextField id="npT" label="Song" maxLength={120} placeholder="What's playing?" autoFocus value={np.title} onChange={e => setNp(v => ({ ...v, title: e.target.value }))} />
              <TextField id="npA" label="Artist" maxLength={120} placeholder="Artist" value={np.artist} onChange={e => setNp(v => ({ ...v, artist: e.target.value }))} />
              <div className={styles.formActions}>
                <Button size="sm" variant="ghost" onClick={() => saveNowPlaying(undefined, true)}>Clear</Button>
                <Button size="sm" variant="primary" type="submit">Update</Button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {queued.length > 0 && <SectionHeader title="Queued" count={queued.length} />}
      <ul className={styles.list}>
        <AnimatePresence mode="popLayout" initial={false}>
          {queued.map(r => (
            <SongRow key={r.id} track={r.track} variant="queued" detail={detail(r)}>
              {connected && r.track.uri
                ? <span className={styles.tag}>In Spotify queue</span>
                : <Button size="sm" icon="play" loading={isBusy(r, 'playing')} onClick={() => act(r, 'playing')} aria-label="Mark as now playing"><span className={styles.lbl}>Playing</span></Button>}
              <Button size="icon" variant="ghost" icon="undo" aria-label="Back to requests" onClick={() => act(r, 'restore')} />
            </SongRow>
          ))}
        </AnimatePresence>
      </ul>

      <SectionHeader title="Requests" count={pending.length} />
      {pending.length > 0 && <p className={styles.tip}>Swipe right to queue · left to dismiss · tap for more</p>}
      <ul className={styles.list}>
        <AnimatePresence mode="popLayout" initial={false}>
          {pending.map((r, i) => (
            <SongRow key={r.id} track={r.track} rank={i} fresh={freshIds.includes(r.id)} detail={detail(r)}
              swipeRight={{ label: 'Queue', icon: 'queue', onTrigger: () => act(r, 'queue') }}
              swipeLeft={{ label: 'Dismiss', icon: 'x', onTrigger: () => act(r, 'dismiss') }}
              onClick={() => setOpenId(id => (id === r.id ? null : r.id))}
              expanded={openId === r.id && (
                <>
                  <Button size="sm" variant="ghost" icon="block" onClick={() => act(r, 'block')}>Block guest</Button>
                  <Button size="sm" icon="x" onClick={() => act(r, 'dismiss')}>Dismiss</Button>
                </>
              )}>
              <div className={styles.votes}>
                <AnimatedNumber value={r.votes} />
                <small>{plural(r.votes, 'vote').toUpperCase()}</small>
              </div>
              <Button size="sm" variant="primary" icon="queue" loading={isBusy(r, 'queue')} onClick={() => act(r, 'queue')}
                aria-label={connected && r.track.uri ? 'Add to your Spotify queue' : 'Mark as queued'}>
                <span className={styles.lbl}>Queue</span>
              </Button>
            </SongRow>
          ))}
        </AnimatePresence>
      </ul>
      {pending.length === 0 && <EmptyState title="All clear">New requests will appear here instantly.</EmptyState>}

      {played.length > 0 && <SectionHeader title="Played" count={played.length} />}
      <ul className={styles.list}>
        <AnimatePresence mode="popLayout" initial={false}>
          {played.map(r => (
            <SongRow key={r.id} track={r.track} variant="played" detail={detail(r)}>
              <span className={styles.tagFaint}>Played</span>
            </SongRow>
          ))}
        </AnimatePresence>
      </ul>
    </>
  );
}
