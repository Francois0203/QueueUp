import { motion, useAnimate } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { Aura, Button, Logo, TextField, useToast } from '../../components';
import { useDocumentTitle } from '../../hooks';
import { call, haptics, rise, spring } from '../../lib';
import styles from './Dj.module.css';

export function DjLogin({ code, partyName, onSignedIn }: { code: string; partyName: string; onSignedIn: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, animate] = useAnimate();
  const toast = useToast();
  useDocumentTitle(`${partyName} · DJ · QueueUp`);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await call('djLogin', { code, pin: pin.trim() });
      haptics.success();
      onSignedIn();
    } catch (err) {
      haptics.error();
      animate(scope.current, { x: [0, -12, 12, -8, 8, 0] }, { duration: 0.4 });
      setPin('');
      toast((err as Error).message, { error: true });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Aura />
      <main className={styles.loginWrap}>
        <motion.form ref={scope} className={styles.login} onSubmit={submit} {...rise} transition={spring.smooth}>
          <Logo size={52} entrance />
          <h1>{partyName}</h1>
          <p>Enter the DJ PIN to take control.</p>
          <TextField variant="pin" inputMode="numeric" autoComplete="current-password" maxLength={12} placeholder="••••••"
            aria-label="PIN" autoFocus value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={pin.length < 4}>Unlock</Button>
          <p className={styles.hint}>No PIN? On the device you're DJing from, open <b>Share</b> and tap <b>Show DJ code</b>, then scan it with this one. The PIN is also under Settings there.</p>
        </motion.form>
      </main>
    </>
  );
}
