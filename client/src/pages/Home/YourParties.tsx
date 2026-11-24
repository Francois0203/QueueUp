import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Icon, SectionHeader } from '../../components';
import { KEYS, partyExists, spring, storage } from '../../lib';
import styles from './Home.module.css';

export interface SavedParty { code: string; name: string }

/** Parties this browser hosted that still exist, so the DJ can get back in. */
export function YourParties() {
  const [parties, setParties] = useState<SavedParty[]>([]);

  useEffect(() => {
    const saved = storage.getJson<SavedParty[]>(KEYS.parties, []);
    if (!saved.length) return;
    Promise.all(saved.map(p =>
      partyExists(p.code)
        .then(r => (r ? { ...p, name: r.name } : null))
        .catch(() => p), // offline: keep it
    )).then(list => {
      const alive = list.filter(Boolean) as SavedParty[];
      storage.setJson(KEYS.parties, alive);
      setParties(alive);
    });
  }, []);

  if (!parties.length) return null;
  return (
    <section>
      <SectionHeader title="Your parties" />
      <ul className={styles.parties}>
        {parties.map((p, i) => (
          <motion.li key={p.code} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.85 + i * 0.06 }}>
            <motion.a href={`/dj/${p.code}`} className={styles.party} whileHover={{ x: 4 }} whileTap={{ scale: 0.98 }} transition={spring.snappy}>
              <div>
                <div className={styles.partyName}>{p.name}</div>
                <div className={styles.partyCode}>Code {p.code}</div>
              </div>
              <span className={styles.partyGo}>Open console <Icon name="arrowRight" size={14} /></span>
            </motion.a>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
