import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button, useToast } from '../../components';
import { call, spring } from '../../lib';
import styles from './Dj.module.css';

type Link = { url: string; qr: string; expiresAt: number };

/** One-time QR code that makes another device a DJ, so nobody has to remember the PIN. */
export function DjLinkCard({ code }: { code: string }) {
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const toast = useToast();

  const create = async () => {
    setBusy(true);
    try {
      const { token, expiresInMs } = await call<{ token: string; expiresInMs: number }>('djInvite', { code });
      const url = `${location.origin}/dj/${code}#invite=${token}`;
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' });
      setLink({ url, qr, expiresAt: Date.now() + expiresInMs });
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally { setBusy(false); }
  };

  // Count down, and hide the code once it has expired.
  useEffect(() => {
    if (!link) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= link.expiresAt) setLink(null);
    }, 1000);
    return () => clearInterval(t);
  }, [link]);

  const left = link ? Math.max(0, Math.ceil((link.expiresAt - now) / 1000)) : 0;

  return (
    <div className={styles.djLink}>
      <h3>DJ on another device</h3>
      <AnimatePresence mode="wait" initial={false}>
        {link ? (
          <motion.div key="qr" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={spring.smooth}>
            <img className={styles.djLinkQr} src={link.qr} alt="QR code that signs another device in as DJ" />
            <p className={styles.note}>
              Scan with the other phone. Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more.
              Anyone who scans it controls the party, so don't show it to guests.
            </p>
            <div className={styles.shareActions}>
              <Button size="sm" variant="ghost" icon="copy" onClick={() => navigator.clipboard.writeText(link.url).then(() => toast('DJ link copied'))}>Copy link</Button>
              <Button size="sm" variant="ghost" icon="x" onClick={() => setLink(null)}>Hide</Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className={styles.note}>Show a one-time code and scan it with another phone or laptop. No PIN needed.</p>
            <div className={styles.shareActions}>
              <Button size="sm" variant="secondary" icon="key" loading={busy} onClick={create}>Show DJ code</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
