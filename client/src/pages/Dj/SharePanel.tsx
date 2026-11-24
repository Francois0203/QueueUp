import { motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button, CopyField } from '../../components';
import type { RoomState } from '../../types';
import { spring } from '../../lib';
import { DjLinkCard } from './DjLinkCard';
import styles from './Dj.module.css';

/** QR code drawn in the browser (no server needed). */
function useQr(text: string) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!text) return;
    QRCode.toDataURL(text, { margin: 1, width: 640, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [text]);
  return src;
}

function QrCard({ src, name }: { src: string; name: string }) {
  return (
    <div className={styles.qrCard}>
      {src ? <img src={src} alt="QR code to join the party" /> : <div className={styles.qrPlaceholder} />}
      <div className={styles.qrTitle}>{name}</div>
      <div className={styles.qrSub}>Scan to see what's playing &amp; request a song</div>
    </div>
  );
}

export function SharePanel({ code, state }: { code: string; state: RoomState }) {
  const [printing, setPrinting] = useState(false);
  const src = useQr(state.guestUrl ?? '');
  const print = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 150);
  };

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.smooth}
        whileHover={{ rotateX: 4, rotateY: -4, scale: 1.01 }} style={{ transformPerspective: 900 }}>
        <QrCard src={src} name={state.settings.partyName} />
      </motion.div>
      <div className={styles.shareBox}>
        <CopyField label="Guest link" value={state.guestUrl ?? ''} />
        <div className={styles.shareActions}>
          <Button size="sm" variant="ghost" icon="print" onClick={print}>Print</Button>
          <Button size="sm" variant="ghost" icon="external" href={state.guestUrl} target="_blank" rel="noopener">Open guest view</Button>
        </div>
        <p className={styles.note}>Guests can also open the home page and enter code <b>{state.code}</b>. Only share it with people you invited.</p>
      </div>
      <DjLinkCard code={code} />
      {printing && createPortal(<div className="print-area"><QrCard src={src} name={state.settings.partyName} /></div>, document.getElementById('root')!)}
    </>
  );
}
