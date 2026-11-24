import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Checkbox, CopyField, Icon, Sheet, TextField, useToast } from '../../components';
import type { RoomState } from '../../types';
import { call, extractClientId, haptics, KEYS, spring, storage } from '../../lib';
import styles from './Dj.module.css';

interface Props { open: boolean; startStep: number; code: string; state: RoomState; onClose: () => void }

const STEPS = 3;

/** Guided, 3-step Spotify setup. Returning DJs connect in one tap with their saved key. */
export function SpotifyWizard({ open, startStep, code, state, onClose }: Props) {
  const [[step, dir], setStep] = useState<[number, number]>([0, 1]);
  const [input, setInput] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const saved = storage.get(KEYS.spotifyClientId);
  const redirectUri = state.spotify.redirectUri ?? '';
  const id = extractClientId(input);
  const local = location.hostname === 'localhost';

  useEffect(() => {
    if (!open) return;
    setStep([startStep, 1]);
    setInput(v => v || state.spotify.clientId || saved);
  }, [open]); // reset each time the wizard opens

  const go = (n: number) => setStep([n, n > step ? 1 : -1]);

  const connect = async (clientId: string) => {
    setBusy(true);
    try {
      const { url } = await call<{ url: string }>('spotifyStart', { code, clientId, local: location.hostname === 'localhost' });
      location.href = url;
    } catch (e) {
      haptics.error();
      toast((e as Error).message, { error: true, ms: 4000 });
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    if (remember) storage.set(KEYS.spotifyClientId, id); else storage.remove(KEYS.spotifyClientId);
    connect(id);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      if (extractClientId(text)) haptics.success();
    } catch { toast('Long-press the box and choose Paste', { ms: 3000 }); }
  };

  const hint = id
    ? (input.trim().toLowerCase() === id ? 'Looks good.' : `Found it: ${id.slice(0, 6)}…${id.slice(-4)}`)
    : input.trim() ? 'That doesn’t contain a Client ID yet. It’s 32 letters and numbers.' : 'It’s 32 letters and numbers. You don’t need the client secret.';

  return (
    <Sheet open={open} onClose={onClose} title="Connect Spotify" fit
      header={
        <div className={styles.progress} aria-hidden="true">
          <motion.i animate={{ width: `${((step + 1) / STEPS) * 100}%` }} transition={spring.smooth} />
        </div>
      }>
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div key={step} custom={dir}
          variants={{
            enter: (d: number) => ({ opacity: 0, x: d * 40 }),
            center: { opacity: 1, x: 0 },
            exit: (d: number) => ({ opacity: 0, x: d * -40 }),
          }}
          initial="enter" animate="center" exit="exit" transition={spring.smooth}>

          {step === 0 && (
            <div className={styles.step}>
              {saved && (
                <div className={styles.savedKey}>
                  <span className={styles.stepIcon} style={{ margin: 0, width: 44, height: 44 }}><Icon name="key" size={20} /></span>
                  <div className={styles.savedText}><b>Your saved Spotify key</b><small>···· {saved.slice(-4)} · on this device</small></div>
                  <Button size="sm" variant="primary" loading={busy} onClick={() => connect(saved)}>Connect</Button>
                </div>
              )}
              <span className={styles.stepIcon}><Icon name="key" size={26} /></span>
              <h3>One quick setup</h3>
              <p>Spotify asks every DJ to create a free personal "app key". It takes about 3 minutes, and you only do it once — this device remembers it.</p>
              <ul className={styles.checks}>
                <li><Icon name="check" /><span>A <b>Spotify Premium</b> account (needed for queueing)</span></li>
                <li><Icon name="check" /><span>Your Spotify login — QueueUp <b>never sees your password</b></span></li>
                <li><Icon name="check" /><span>Spotify open on the device that plays the music</span></li>
              </ul>
              <div className={styles.nav}><Button variant="primary" size="lg" block onClick={() => go(1)}>Let's go</Button></div>
            </div>
          )}

          {step === 1 && (
            <div className={styles.step}>
              <h3>Create your key</h3>
              <p>Open Spotify's developer site, log in, and fill in the form with these values.</p>
              <Button variant="primary" size="lg" block icon="external" href="https://developer.spotify.com/dashboard/create" target="_blank" rel="noopener noreferrer">Open Spotify for Developers</Button>
              <div style={{ height: 16 }} />
              <CopyField label="App name" value="QueueUp party" />
              <CopyField label="App description" value="Song requests for my parties" />
              <CopyField label="Redirect URI — must match exactly" value={redirectUri} important />
              <ul className={styles.checks}>
                <li><Icon name="check" /><span>If you land on your dashboard instead of a form, click <b>Create app</b></span></li>
                <li><Icon name="check" /><span>Under "Which API/SDKs", tick <b>Web API</b></span></li>
                <li><Icon name="check" /><span>Tick the terms box and press <b>Save</b></span></li>
              </ul>
              <details className={styles.help}><summary>First time on Spotify's developer site?</summary>
                <p>Spotify asks you to accept its developer terms and may ask you to verify your email before you can create an app. That's normal — do that, then come back here.</p></details>
              <div className={styles.nav}><Button size="lg" onClick={() => go(0)}>Back</Button><Button variant="primary" size="lg" onClick={() => go(2)}>I've saved it</Button></div>
            </div>
          )}

          {step === 2 && (
            <form className={styles.step} onSubmit={submit} autoComplete="off">
              <h3>Paste your Client ID</h3>
              <p>On your new app's page, copy the <b>Client ID</b>. Or just copy the page's web address — we'll find the ID in it.</p>
              <TextField variant="mono" placeholder="Paste here" spellCheck={false} maxLength={300} aria-label="Spotify Client ID" autoFocus
                value={input} valid={!!id} onChange={e => setInput(e.target.value)}
                trailing={
                  <AnimatePresence mode="popLayout" initial={false}>
                    {id
                      ? <motion.span key="ok" className={styles.okMark} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.pop}><Icon name="check" size={14} strokeWidth={3} /></motion.span>
                      : <motion.span key="paste" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Button size="sm" onClick={paste}>Paste</Button></motion.span>}
                  </AnimatePresence>
                } />
              <AnimatePresence mode="wait" initial={false}>
                <motion.p key={hint} className={styles.hint} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{hint}</motion.p>
              </AnimatePresence>
              <div style={{ marginTop: 12 }}><Checkbox checked={remember} onChange={setRemember}>Remember on this device for next time</Checkbox></div>
              {local && <p className={styles.hint}>Local development: after logging in, Spotify sends you to the live site, which hands you straight back to <code>localhost:3000</code>.</p>}
              <div className={styles.nav}><Button size="lg" onClick={() => go(1)}>Back</Button><Button type="submit" variant="primary" size="lg" disabled={!id} loading={busy}>Connect Spotify</Button></div>
              <details className={styles.help}><summary>Spotify shows an error?</summary>
                <p><b>"INVALID_CLIENT: Invalid redirect URI"</b> — the Redirect URI in your Spotify app doesn't match. Go back one step, copy it again, and paste it in your app under Settings → Edit → Redirect URIs. Then Save.</p>
                <p><b>"INVALID_CLIENT: Invalid client"</b> — the Client ID is wrong. Copy it again from your app's Settings.</p>
                <p><b>Can't find your app?</b> Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">developer.spotify.com/dashboard</a> and click it.</p>
              </details>
            </form>
          )}
        </motion.div>
      </AnimatePresence>
    </Sheet>
  );
}
