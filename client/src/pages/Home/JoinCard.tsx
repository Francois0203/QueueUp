import { motion, useAnimate } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { Button, TextField, useToast } from '../../components';
import { go, haptics, partyExists, spring } from '../../lib';
import styles from './Home.module.css';

export function JoinCard({ delay = 0 }: { delay?: number }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, animate] = useAnimate();
  const toast = useToast();

  const fail = (msg: string) => {
    haptics.error();
    animate(scope.current, { x: [0, -10, 10, -6, 6, 0] }, { duration: 0.4 });
    toast(msg, { error: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 5) return fail('Party codes are 5 characters.');
    setBusy(true);
    try {
      if (!(await partyExists(code))) throw new Error("No party with that code.");
      go(`/p/${code}`);
    } catch (err) {
      fail((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <motion.form ref={scope} className={styles.card} onSubmit={submit} autoComplete="off"
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay }}>
      <label className={styles.cardLabel} htmlFor="code">Join a party</label>
      <div className={styles.row}>
        <TextField id="code" variant="code" maxLength={5} placeholder="CODE" autoCapitalize="characters" spellCheck={false}
          aria-label="Party code" value={code}
          onChange={e => {
            const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
            if (v.length === 5 && code.length < 5) haptics.select();
            setCode(v);
          }} />
        <Button type="submit" size="lg" loading={busy} variant={code.length === 5 ? 'primary' : 'secondary'}>Join</Button>
      </div>
    </motion.form>
  );
}
