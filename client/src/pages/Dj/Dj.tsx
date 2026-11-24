import { useEffect, useState } from 'react';
import { doc, getDoc, getDocFromServer } from 'firebase/firestore';
import { useToast } from '../../components';
import { db, ensureUser, go } from '../../lib';
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

  useEffect(() => {
    let attempt = 0, timer: ReturnType<typeof setTimeout>, cancelled = false;
    const check = async () => {
      try {
        await ensureUser();
        const party = await getDocFromServer(doc(db, 'parties', code));
        if (cancelled) return;
        if (!party.exists()) return go('/'); // party is gone
        setPartyName(party.data().name);
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
  }, [code, toast]);

  if (auth === 'checking') return null;
  if (auth === 'login') return <DjLogin code={code} partyName={partyName} onSignedIn={() => setAuth('in')} />;
  return <DjConsole code={code} />;
}
