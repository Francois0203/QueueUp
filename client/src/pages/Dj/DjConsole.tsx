import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Aura, Chip, Logo, Page, SegmentedTabs, TopBar, AnimatedNumber, useToast } from '../../components';
import { useDocumentTitle, useNowPlayingSync, useRoom } from '../../hooks';
import { go, haptics, panel, plural } from '../../lib';
import { RequestsPanel } from './RequestsPanel';
import { SettingsPanel } from './SettingsPanel';
import { SharePanel } from './SharePanel';
import { WelcomeSheet } from './WelcomeSheet';
import { SpotifyWizard } from './SpotifyWizard';

type Tab = 'requests' | 'settings' | 'share';

const SPOTIFY_MESSAGES: Record<string, string> = {
  connected: 'Spotify connected',
  denied: 'Spotify access was declined',
  error: 'Spotify login failed. Check the Client ID and that the Redirect URI matches exactly.',
  signin: 'Finish connecting Spotify in a browser where you’re signed in as this party’s DJ.',
};

export function DjConsole({ code }: { code: string }) {
  const { state, status } = useRoom(code, { dj: true });
  const [tab, setTab] = useState<Tab>('requests');
  const [welcome, setWelcome] = useState(false);
  const [wizard, setWizard] = useState<{ open: boolean; step: number }>({ open: false, step: 0 });
  const [unseen, setUnseen] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const handledParams = useRef(false);
  const toast = useToast();
  useDocumentTitle(state ? `${state.settings.partyName} · DJ · QueueUp` : 'DJ · QueueUp');

  useEffect(() => { if (status === 'ended') go('/'); }, [status]);

  // Keep "now playing" in sync with Spotify (guests help too; see useNowPlayingSync).
  useNowPlayingSync(code, { connected: Boolean(state?.spotify.connected), np: state?.nowPlaying ?? null, listeners: state?.listeners ?? 0, dj: true });

  // One-time messages from the URL (?welcome, ?spotify=…).
  useEffect(() => {
    if (!state || handledParams.current) return;
    handledParams.current = true;
    const params = new URLSearchParams(location.search);
    const msg = params.get('spotify');
    if (msg && SPOTIFY_MESSAGES[msg]) {
      toast(SPOTIFY_MESSAGES[msg], { error: msg !== 'connected', ms: msg === 'connected' ? 2600 : 6000 });
      if (msg === 'connected') haptics.success();
      if (msg === 'error') setWizard({ open: true, step: 2 });
    }
    if (params.has('welcome')) setWelcome(true);
    if (params.toString()) history.replaceState(null, '', location.pathname);
  }, [state, toast]);

  // New requests: highlight them, and badge the tab when the DJ is elsewhere.
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (!state) return;
    const ids = state.requests.filter(r => r.status === 'pending').map(r => r.id);
    if (seen.current) {
      const added = ids.filter(id => !seen.current!.has(id));
      if (added.length) {
        haptics.tap();
        if (tabRef.current !== 'requests') setUnseen(n => n + added.length);
        setFreshIds(f => [...f, ...added]);
        setTimeout(() => setFreshIds(f => f.filter(id => !added.includes(id))), 2800);
      }
    }
    seen.current = new Set(ids);
  }, [state]);

  if (!state) return null;
  const openWizard = (step = 0) => setWizard({ open: true, step });

  return (
    <>
      <Aura intense={Boolean(state.nowPlaying?.isPlaying)} />
      <Page wide>
        <TopBar
          left={<><Logo /><span>{state.settings.partyName}</span></>}
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <Chip active={state.listeners > 0}>
                {status === 'live' ? <><AnimatedNumber value={state.listeners} />&nbsp;{plural(state.listeners, 'guest')}</> : 'Reconnecting'}
              </Chip>
              <Chip active={state.spotify.connected} onClick={() => state.spotify.connected ? setTab('settings') : openWizard()}>
                {state.spotify.connected ? 'Spotify' : 'Connect Spotify'}
              </Chip>
            </div>
          } />

        <div style={{ marginTop: 14 }}>
          <SegmentedTabs<Tab> value={tab}
            onChange={t => { setTab(t); if (t === 'requests') setUnseen(0); }}
            tabs={[{ id: 'requests', label: 'Requests', badge: unseen }, { id: 'settings', label: 'Settings' }, { id: 'share', label: 'Share' }]} />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} {...panel}>
            {tab === 'requests' && <RequestsPanel code={code} state={state} freshIds={freshIds} />}
            {tab === 'settings' && <SettingsPanel code={code} state={state} onConnectSpotify={() => openWizard()} />}
            {tab === 'share' && <SharePanel code={code} state={state} />}
          </motion.div>
        </AnimatePresence>
      </Page>

      <WelcomeSheet open={welcome} state={state} onClose={() => setWelcome(false)}
        onShare={() => { setWelcome(false); setTab('share'); }}
        onSpotify={() => { setWelcome(false); openWizard(); }} />
      <SpotifyWizard open={wizard.open} startStep={wizard.step} code={code} state={state} onClose={() => setWizard(w => ({ ...w, open: false }))} />
    </>
  );
}
