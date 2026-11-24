import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, getDocFromServer } from 'firebase/firestore';
import { useToast } from '../../components';
import { call, db, ensureUser, go } from '../../lib';
import { DjLogin } from './DjLogin';
import { DjConsole } from './DjConsole';

type Auth = 'checking' | 'login' | 'in';

/**
 * Gate: signed-in DJs get the console, everyone else the PIN screen.
 * Firestore rules decide: only this party's DJs can read its private/dj document.
 */
export function DjPage({ code }: { code: string }) {
  const [auth, setAuth] = useState<Auth>('checking');
  const [partyName, setPartyName] = useState('');
  const toast = useToast();
  // A one-time DJ link puts its token after "#", which never reaches any server log.
  const [invite] = useState(() => new URLSearchParams(location.hash.slice(1)).get('invite'));
  const inviteTried = useRef(false);

  useEffect(() => {
    let attempt = 0, timer: ReturnType<typeof setTimeout>, cancelled = false;
    if (invite) history.replaceState(null, '', location.pathname + location.search);
    const check = async () => {
      try {
        await ensureUser();
        const party = await getDocFromServer(doc(db, 'parties', code));
        if (cancelled) return;
        if (!party.exists()) return go('/'); // party is gone
        setPartyName(party.data().name);
        if (invite && !inviteTried.current) {
          inviteTried.current = true; // try it once, even if the connection retries
          await call('djLogin', { code, invite }).then(
            () => toast('You’re in. This device is now a DJ.'),
            (e: Error) => toast(e.message, { error: true }),
          );
        }
        try {
          await getDoc(doc(db, 'parties', code, 'private', 'dj'));
          if (!cancelled) setAuth('in');
        } catch {
          if (!cancelled) setAuth('login'); // permission denied: not a DJ (yet)
        }
      } catch {
        if (cancelled) return;
        // Flaky venue Wi-Fi: keep trying instead of throwing the DJ out.
        if (attempt === 0) toast('Connecting…');
        timer = setTimeout(check, Math.min(1000 * 2 ** attempt++, 10000));
      }
    };
    check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [code, invite, toast]);

  if (auth === 'checking') return null;
  if (auth === 'login') return <DjLogin code={code} partyName={partyName} onSignedIn={() => setAuth('in')} />;
  return <DjConsole code={code} />;
}
