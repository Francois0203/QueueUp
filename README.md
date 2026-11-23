# QueueUp

Live song requests for parties. Guests scan a QR code, see what's playing, request songs and vote. The DJ decides what actually gets queued.

- **Guest page** `/` — now playing, up next, requests sorted by votes, request sheet.
- **DJ console** `/dj` — PIN-protected. Queue / dismiss requests, settings, QR code to print or show.
- **Spotify (optional)** — live "now playing", song search for guests, and one-tap queueing to the DJ's Spotify.
  Without Spotify, guests type song names and the DJ sets "now playing" by hand.

## Run it

```bash
npm install
cp .env.example .env    # optional, fill in what you need
npm start
```

The console prints the guest link and the DJ PIN. Open `http://127.0.0.1:3000/dj` on the DJ machine, go to **Share**, and put the QR code on screen or print it.

Guests' phones must be able to reach the guest link:
- **Same Wi-Fi:** the auto-detected `http://192.168.x.x:3000` works. Allow Node through the Windows firewall when prompted.
- **Anywhere / mobile data:** host it (Render, Fly.io, a VPS) or use a tunnel (e.g. Cloudflare Tunnel), then set `PUBLIC_URL` or edit the link in the Share tab.

## Connect Spotify

1. Create an app at <https://developer.spotify.com/dashboard>, select **Web API**.
2. Add the redirect URI exactly: `http://127.0.0.1:3000/auth/spotify/callback` (Spotify rejects `localhost`; use `https://your-host/auth/spotify/callback` when deployed).
3. Put the client ID/secret in `.env`, restart, then **Settings → Spotify → Connect** from the DJ machine.

Constraints you should know before relying on it:
- **Queueing requires Spotify Premium** and an active device (Spotify must be open and playing).
- **Development mode limits** (since Feb 2026): the app owner needs Premium, and only 5 users can authorise a dev-mode app. QueueUp only needs the DJ to authorise — guests never log in — so this fits one DJ, but not a multi-DJ product without Spotify's extended quota.
- Search returns at most 10 results in dev mode.

## Settings (DJ console)

Party name · accept requests on/off · voting on/off · allow explicit · show guest names · open requests per guest · auto-queue at N votes · guest link · clear history / reset.

## How it works

Plain Node HTTP server (one dependency: `qrcode`), Server-Sent Events for live updates, vanilla JS front end. State is saved to `data/state.json`, so a restart keeps the requests and the Spotify connection. One server = one party.

## Known limits

- **Votes are per browser, not per person.** Guests are identified by an anonymous cookie; someone determined can vote again from a private window. Fine for a party, not for anything with stakes.
- DJ sessions are in memory — restarting the server signs the DJ out.
- Built for one party per server; there are no accounts or multiple rooms.
