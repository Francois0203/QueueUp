# QueueUp

Live song requests for **private parties**. Anyone can host: start a party, show the QR code, and guests request songs and vote. The DJ decides what actually plays.

- **Home** `/` — host a party, or join one with a 5-character code.
- **Guest page** `/p/CODE` — now playing, up next, requests sorted by votes, request sheet.
- **DJ console** `/dj/CODE` — PIN-protected. Queue / dismiss requests, settings, QR code, end party.
- **Spotify (optional, per DJ)** — live "now playing", song search for guests, one-tap queueing to the DJ's own Spotify.
  Without Spotify, guests type song names and the DJ sets "now playing" by hand.

## Run it locally

```bash
npm install
npm start
```

Run the tests with `npm test`. They start a real server against a fake Spotify, so the Spotify flows are covered without an account.

Open `http://127.0.0.1:3000`, start a party, and note the DJ PIN. Guests on the same Wi-Fi can scan the QR code from the **Share** tab (allow Node through the Windows firewall when asked).

## How Spotify works (and why each DJ uses their own app)

Spotify's development-mode apps are limited to **5 users** and need an owner with **Premium** (rules since Feb 2026). Lifting that requires Spotify's extended quota, which isn't realistic for a new project. So QueueUp doesn't use one shared app — **each DJ connects their own free Spotify developer app**:

1. In the DJ console, tap **Connect Spotify**. A 3-step guide walks through it, with copy buttons for every value.
2. The DJ creates an app at <https://developer.spotify.com/dashboard> and pastes the **Client ID**, or just the app page's web address, since the ID is detected automatically.
3. The Client ID is remembered on that device, so later parties connect in one tap.
4. Login uses Authorization Code + **PKCE**, so there is **no client secret**. QueueUp stores only the Client ID and the DJ's access/refresh tokens.

The DJ is the app owner and its only user, so the 5-user cap never applies. Requirements on the DJ's side: **Spotify Premium**, and Spotify open and playing on some device when queueing.

Locally the redirect URI is `http://127.0.0.1:3000/auth/spotify/callback`, so connect Spotify from the computer running QueueUp. In production it's `https://your-domain/auth/spotify/callback`.

## Deploying (e.g. AWS)

QueueUp is a single long-running Node process that keeps live connections (Server-Sent Events) and party state in memory, saved to `DATA_DIR/rooms.json`.

- Use something that runs continuously: **Lightsail** or a small **EC2** instance. Not Lambda.
- Put it behind **HTTPS** (Caddy, nginx + Let's Encrypt, or an ALB). Spotify requires https redirect URIs outside 127.0.0.1.
- Set `PUBLIC_URL=https://your-domain`, and `TRUST_PROXY=1` if behind a proxy.
- Run **one** instance. State lives on local disk, so multiple instances would each see different parties.
- Keep `DATA_DIR` on persistent disk and back it up. `rooms.json` is encrypted (AES-256-GCM); set `DATA_ENCRYPTION_KEY` from a secret store so the key never sits on the same disk.
- Fill in the operator details (`OPERATOR_NAME`, ...) for the legal pages. See **LEGAL.md** for the full launch checklist.
- Health check: `GET /healthz`.

## Settings (per party)

Party name · accept requests · voting · allow explicit · show guest names · open requests per guest · auto-queue at N votes · DJ PIN · clear history / reset · end party.

## Security

- Encrypted storage (AES-256-GCM), HTTPS-ready (HSTS, Secure cookies), and a strict Content Security Policy: no inline or third-party scripts, and fonts are self-hosted.
- Cross-site request blocking, HttpOnly + SameSite cookies, and DJ sessions stored only as hashes.
- Rate limits on PIN guesses, party-code guessing, requests, votes and searches, plus caps on live connections.
- Guests can't forge song details: the server only accepts songs it got from Spotify itself.
- Spotify login uses PKCE and is bound to the DJ's signed-in browser. Token refresh is single-flight, and Spotify's rate limits are respected.
- Invisible and text-direction control characters are stripped from all user text. The DJ can dismiss requests and block guests.

## Legal

Terms of Service (`/terms`), Privacy Policy (`/privacy`), a proprietary `LICENSE` and `THIRD_PARTY_NOTICES.md` are included. Read **LEGAL.md** before launch. In particular: QueueUp is for **private, non-commercial** use only, because Spotify forbids use in businesses.

## Known limits

- **Votes are per browser, not per person.** Guests are anonymous cookies, so a determined guest can vote again from a private window. That's fine for a party, but not for anything with stakes.
- Parties idle for 48 hours are deleted automatically.
- It runs as one server process. Scaling out would need shared storage (e.g. Redis or DynamoDB) and a pub/sub for live updates.
