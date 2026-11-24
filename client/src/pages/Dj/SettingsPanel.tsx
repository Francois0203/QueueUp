import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Footer, SettingRow, Stepper, Switch, TextField, useToast } from '../../components';
import type { PartySettings, RoomState } from '../../types';
import { call, go, plural, spring } from '../../lib';

export function SettingsPanel({ code, state, onConnectSpotify }: { code: string; state: RoomState; onConnectSpotify: () => void }) {
  const toast = useToast();
  const s = state.settings;
  // Optimistic local copy so toggles respond instantly; server pushes keep it honest.
  const [local, setLocal] = useState<PartySettings>(s);
  const [name, setName] = useState(s.partyName);
  const [showPin, setShowPin] = useState(false);
  const typing = useRef(false);

  useEffect(() => { setLocal(s); if (!typing.current) setName(s.partyName); }, [s]);

  const patch = async (body: Partial<PartySettings>) => {
    setLocal(l => ({ ...l, ...body }));
    try { await call('settings', { code, patch: body }); }
    catch (e) { toast((e as Error).message, { error: true }); setLocal(s); }
  };

  useEffect(() => {
    if (name === s.partyName) return;
    typing.current = true;
    const t = setTimeout(async () => { await patch({ partyName: name }); typing.current = false; }, 500);
    return () => clearTimeout(t);
  }, [name]); // only re-run when the typed name changes

  const post = async (op: string, body: Record<string, unknown> = {}) => call(op, { code, ...body }).catch(e => { toast((e as Error).message, { error: true }); throw e; });
  const sp = state.spotify;

  return (
    <>
      <Card>
        <SettingRow title="Party name" description="Shown at the top of the guest page">
          <div style={{ maxWidth: 220 }}><TextField maxLength={40} value={name} onChange={e => setName(e.target.value)} aria-label="Party name" /></div>
        </SettingRow>
        <SettingRow title="Accept requests" description="Pause when you need a breather">
          <Switch label="Accept requests" checked={local.requestsOpen} onChange={v => patch({ requestsOpen: v })} />
        </SettingRow>
        <SettingRow title="Voting" description="Let guests upvote requests">
          <Switch label="Voting" checked={local.votingOpen} onChange={v => patch({ votingOpen: v })} />
        </SettingRow>
        <SettingRow title="Allow explicit songs" description="Hidden from search when off">
          <Switch label="Allow explicit songs" checked={!!local.allowExplicit} onChange={v => patch({ allowExplicit: v })} />
        </SettingRow>
        <SettingRow title="Show guest names" description="Display who requested each song">
          <Switch label="Show guest names" checked={!!local.showNames} onChange={v => patch({ showNames: v })} />
        </SettingRow>
      </Card>

      <Card>
        <SettingRow title="Open requests per guest" description="0 = unlimited">
          <Stepper label="open requests per guest" value={local.maxPendingPerGuest} min={0} max={20} onChange={v => patch({ maxPendingPerGuest: v })} />
        </SettingRow>
        <SettingRow title="Auto-queue at votes" description="Queue automatically at this many votes. 0 = you decide every time">
          <Stepper label="auto-queue votes" value={local.autoQueueAt ?? 0} min={0} max={100} onChange={v => patch({ autoQueueAt: v })} />
        </SettingRow>
      </Card>

      <Card>
        <SettingRow title="Spotify" description={sp.connected
          ? `Connected${sp.user ? ` as ${sp.user.name}` : ''}${sp.user?.product && sp.user.product !== 'premium' ? '. Queueing needs Premium' : ''}`
          : 'Show what’s playing, let guests search, and queue with one tap'}>
          {sp.connected
            ? <Button size="sm" onClick={async () => { if (confirm('Disconnect Spotify? Guests will switch to typing song names.')) await post('spotifyDisconnect'); }}>Disconnect</Button>
            : <Button size="sm" variant="primary" onClick={onConnectSpotify}>Connect</Button>}
        </SettingRow>
        <SettingRow title="DJ PIN" description="Use it to run this party from another device">
          <Button size="sm" onClick={() => setShowPin(v => !v)}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={String(showPin)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.snappy}
                style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: showPin ? '.15em' : 0 }}>
                {showPin ? state.pin : 'Show'}
              </motion.span>
            </AnimatePresence>
          </Button>
        </SettingRow>
        {!!state.blockedCount && (
          <SettingRow title="Blocked guests" description={`${state.blockedCount} ${plural(state.blockedCount, 'guest')} can't request or vote`}>
            <Button size="sm" onClick={async () => { await post('unblockAll'); toast('Everyone unblocked'); }}>Unblock all</Button>
          </SettingRow>
        )}
      </Card>

      <Card>
        <SettingRow title="Clear history" description="Remove played and dismissed songs">
          <Button size="sm" onClick={async () => { await post('clear', { scope: 'history' }); toast('History cleared'); }}>Clear</Button>
        </SettingRow>
        <SettingRow title="Reset requests" description="Remove every request, including the queue">
          <Button size="sm" onClick={async () => { if (confirm('Remove every request, including queued songs?')) { await post('clear', { scope: 'all' }); toast('All requests removed'); } }}>Reset</Button>
        </SettingRow>
        <SettingRow title="Sign out" description="Lock this device">
          <Button size="sm" onClick={async () => { await post('djLogout'); location.reload(); }}>Sign out</Button>
        </SettingRow>
        <SettingRow title="End party" description="Deletes the party and all its data for everyone">
          <Button size="sm" variant="danger" onClick={async () => { if (confirm('End this party for everyone? This deletes all its data and can’t be undone.')) { await post('end'); go('/'); } }}>End</Button>
        </SettingRow>
      </Card>

      <Footer>For private, non-commercial parties only. You're responsible for following Spotify's terms and any music licensing.</Footer>
    </>
  );
}
