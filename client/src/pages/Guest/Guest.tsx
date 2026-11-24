import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import {
  Aura, Button, EmptyState, Footer, LiveIndicator, Logo, NowPlayingHero, Page, SectionHeader, SongRow, TopBar, VoteButton, useToast,
} from '../../components';
import { useDocumentTitle, useNowPlayingSync, useRoom } from '../../hooks';
import { call, spring } from '../../lib';
import { EndedPage } from '../Ended';
import { RequestSheet } from './RequestSheet';
import styles from './Guest.module.css';

export function GuestPage({ code }: { code: string }) {
  const { state, status, clockOffset } = useRoom(code);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const toast = useToast();
  useDocumentTitle(state ? `${state.settings.partyName} · QueueUp` : 'QueueUp');

  const vote = useCallback(async (id: string, current: boolean) => {
    setOptimistic(o => ({ ...o, [id]: !current }));
    try {
      await call('vote', { code, id, on: !current });
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      // let the server push settle the real value
      setTimeout(() => setOptimistic(o => { const n = { ...o }; delete n[id]; return n; }), 400);
    }
  }, [code, toast]);

  const withdraw = useCallback(async (id: string) => {
    try {
      await call('withdraw', { code, id });
      toast('Request withdrawn');
    } catch (e) { toast((e as Error).message, { error: true }); }
  }, [code, toast]);

  // Count this guest once (no live connection to count anymore).
  useEffect(() => { call('join', { code }).catch(() => {}); }, [code]);

  // Keep "now playing" live, even when the DJ console is closed.
  useNowPlayingSync(code, { connected: Boolean(state?.spotify.connected), np: state?.nowPlaying ?? null, listeners: state?.listeners ?? 0 });

  if (status === 'ended') return <EndedPage />;

  const s = state?.settings;
  const queued = state?.requests.filter(r => r.status === 'queued') ?? [];
  const pending = state?.requests.filter(r => r.status === 'pending') ?? [];

  return (
    <>
      <Aura intense={Boolean(state?.nowPlaying?.isPlaying)} />
      <Page>
        <TopBar left={<><Logo /><span>{s?.partyName ?? 'QueueUp'}</span></>}
          right={<LiveIndicator online={status === 'live'} count={state?.listeners ?? 0} />} />

        <NowPlayingHero np={state?.nowPlaying ?? null} clockOffset={clockOffset} />

        <AnimatePresence initial={false}>
          {queued.length > 0 && (
            <motion.section key="upnext" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
              <SectionHeader title="Up next" />
              <ul className={styles.list}>
                <AnimatePresence mode="popLayout" initial={false}>
                  {queued.map(r => (
                    <SongRow key={r.id} track={r.track} variant="queued" mine={r.mine}
                      detail={r.mine ? 'your pick' : r.by ? `for ${r.by}` : ''}>
                      <span className={styles.tag}>Queued</span>
                    </SongRow>
                  ))}
                </AnimatePresence>
              </ul>
            </motion.section>
          )}
        </AnimatePresence>

        <SectionHeader title="Requests" count={pending.length} />
        <ul className={styles.list}>
          <AnimatePresence mode="popLayout" initial={false}>
            {pending.map((r, i) => {
              const voted = optimistic[r.id] ?? r.voted;
              const votes = r.votes + (r.id in optimistic ? (voted ? 1 : 0) - (r.voted ? 1 : 0) : 0);
              return (
                <SongRow key={r.id} track={r.track} rank={i} mine={r.mine} fresh={r.id === freshId}
                  detail={r.mine ? 'your pick' : r.by ? `from ${r.by}` : ''}>
                  {r.mine && <Button size="icon" variant="ghost" icon="x" aria-label="Withdraw your request" onClick={() => withdraw(r.id)} />}
                  <VoteButton votes={votes} voted={voted} disabled={!s?.votingOpen} onToggle={() => vote(r.id, voted)} />
                </SongRow>
              );
            })}
          </AnimatePresence>
        </ul>
        {state && pending.length === 0 && <EmptyState title="No requests yet">Be the first to pick a song.</EmptyState>}

        <Footer />
      </Page>

      <motion.div className={styles.fabWrap} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.3 }}>
        <Button variant={s?.requestsOpen === false ? 'secondary' : 'primary'} size="lg" block icon={s?.requestsOpen === false ? undefined : 'plus'}
          className={styles.fab}
          onClick={() => s?.requestsOpen === false ? toast('The DJ has paused requests for now.', { error: true }) : setSheetOpen(true)}>
          {s?.requestsOpen === false ? 'Requests are paused' : 'Request a song'}
        </Button>
      </motion.div>

      {state && (
        <RequestSheet open={sheetOpen} onClose={() => setSheetOpen(false)} code={code} state={state}
          onRequested={id => setFreshId(id)} />
      )}
    </>
  );
}
