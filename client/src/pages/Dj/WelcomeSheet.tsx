import { Button, PinDisplay, Sheet } from '../../components';
import type { RoomState } from '../../types';
import styles from './Dj.module.css';

interface Props { open: boolean; state: RoomState; onClose: () => void; onShare: () => void; onSpotify: () => void }

/** First thing a new host sees: the PIN, and the two next steps. */
export function WelcomeSheet({ open, state, onClose, onShare, onSpotify }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="Your party is live 🎉" fit>
      <p className={styles.centerNote}>Your DJ PIN — you'll need it to control this party from another device.</p>
      <PinDisplay pin={state.pin ?? ''} />
      <p className={styles.centerNote}>Party code <b>{state.code}</b></p>
      <ol className={styles.steps}>
        <li><span><b>Connect Spotify</b> (optional) to show what's playing, let guests search, and queue with one tap.</span></li>
        <li><span><b>Share the QR code</b> on a screen or print it.</span></li>
      </ol>
      <div className={styles.twoUp}>
        <Button size="lg" icon="qr" onClick={onShare}>Show QR</Button>
        <Button size="lg" variant="primary" onClick={onSpotify}>Connect Spotify</Button>
      </div>
    </Sheet>
  );
}
