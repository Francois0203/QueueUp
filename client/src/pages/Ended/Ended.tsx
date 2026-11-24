import { motion } from 'motion/react';
import { Aura, Button, Logo } from '../../components';
import { rise, spring } from '../../lib';
import styles from './Ended.module.css';

/** Shown when a party link no longer works. */
export function EndedPage({ title = 'This party has ended', text = 'The code may be wrong, or the DJ has wrapped up for the night.' }: { title?: string; text?: string }) {
  return (
    <>
      <Aura />
      <main className={styles.center}>
        <motion.div className={styles.card} {...rise} transition={spring.smooth}>
          <Logo size={52} entrance />
          <h1>{title}</h1>
          <p>{text}</p>
          <Button href="/" size="lg">Join another party</Button>
        </motion.div>
      </main>
    </>
  );
}

export function NotFoundPage() {
  return <EndedPage title="Nothing here" text="That page doesn't exist. Check the link, or start from the home page." />;
}
