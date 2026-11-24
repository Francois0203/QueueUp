import { motion } from 'motion/react';
import { Aura, Footer, Logo } from '../../components';
import { useDocumentTitle } from '../../hooks';
import { spring } from '../../lib';
import { JoinCard } from './JoinCard';
import { HostCard } from './HostCard';
import { YourParties } from './YourParties';
import styles from './Home.module.css';

const LINE_1 = ['Let', 'the', 'room', 'pick'];
const LINE_2 = ['the'];

export function HomePage() {
  useDocumentTitle('QueueUp — let the room pick the next song');
  const word = (w: string, i: number, highlight = false) => (
    <motion.span key={`${w}-${i}`} className={highlight ? styles.highlight : styles.word}
      variants={{ hidden: { opacity: 0, y: 22, filter: 'blur(10px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)' } }}
      transition={spring.smooth}>
      {w}
    </motion.span>
  );

  return (
    <>
      <Aura intense />
      <main className={styles.wrap}>
        <header className={styles.head}>
          <Logo size={58} animated entrance />
          <motion.h1 initial="hidden" animate="show" transition={{ staggerChildren: 0.06, delayChildren: 0.15 }}>
            {LINE_1.map((w, i) => word(w, i))}<br />
            {LINE_2.map((w, i) => word(w, i + 10))}
            {word('next song.', 20, true)}
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.5 }}>
            Guests scan a code, request songs and vote. You decide what plays.
          </motion.p>
        </header>

        <JoinCard delay={0.6} />
        <motion.div className={styles.or} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}><span>or</span></motion.div>
        <HostCard delay={0.72} />
        <YourParties />

        <Footer>For private parties. Works with your own Spotify Premium, or without Spotify.</Footer>
      </main>
    </>
  );
}
