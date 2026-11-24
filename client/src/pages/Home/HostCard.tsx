import { motion, useAnimate } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, TextField, useToast } from '../../components';
import { call, go, haptics, KEYS, spring, storage } from '../../lib';
import type { SavedParty } from './YourParties';
import styles from './Home.module.css';

export function HostCard({ delay = 0 }: { delay?: number }) {
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consentScope, animate] = useAnimate();
  const toast = useToast();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setInvalid(true);
      haptics.error();
      animate(consentScope.current, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.4 });
      return toast('Please accept the Terms to host a party.', { error: true });
    }
    setBusy(true);
    try {
      const { code } = await call<{ code: string }>('createParty', { partyName: name.trim(), acceptTerms: true });
      const saved = storage.getJson<SavedParty[]>(KEYS.parties, []);
      storage.setJson(KEYS.parties, [{ code, name: name.trim() || 'Tonight' }, ...saved.filter(p => p.code !== code)].slice(0, 8));
      haptics.success();
      go(`/dj/${code}?welcome=1`);
    } catch (err) {
      toast((err as Error).message, { error: true });
      setBusy(false);
    }
  };

  return (
    <motion.form className={styles.card} onSubmit={submit} autoComplete="off"
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay }}>
      <label className={styles.cardLabel} htmlFor="partyName">Host a private party</label>
      <div className={styles.row}>
        <TextField id="partyName" maxLength={40} placeholder="Party name" aria-label="Party name" value={name} onChange={e => setName(e.target.value)} />
        <Button type="submit" variant="primary" size="lg" loading={busy}>Start</Button>
      </div>
      <div ref={consentScope} className={styles.consent}>
        <Checkbox checked={agreed} invalid={invalid && !agreed} onChange={v => { setAgreed(v); setInvalid(false); }}>
          I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a>, and this is a private, non-commercial party.
        </Checkbox>
      </div>
    </motion.form>
  );
}
