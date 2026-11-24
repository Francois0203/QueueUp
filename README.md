# QueueUp

Live song requests for **private parties**. Anyone can host: start a party, show the QR code, and guests request songs and vote. The DJ decides what actually plays.

- **Home** `/`: host a party, or join one with a 5-character code.
- **Guest page** `/p/CODE`: now playing, up next, requests sorted by votes, request sheet.
- **DJ console** `/dj/CODE`: PIN-protected. Swipe a request right to queue it, left to dismiss it, or tap it for more. Also settings, QR code and ending the party.
- **Spotify (optional, per DJ)**: live "now playing", song search for guests, and one-tap queueing to the DJ's own Spotify. Without Spotify, guests type song names and the DJ sets "now playing" by hand.

Live at **https://queueup-party.web.app**. Runs entirely on **Firebase**: Hosting, Firestore, Anonymous Auth and one Cloud Function. Sized to stay inside the free tier.

## Run it locally (http://localhost:3000)

```bash
npm install
npm install --prefix functions
npm run dev
```

`npm run dev` starts the **Firebase emulators** (Auth, Firestore, Functions) and Vite with hot reload on **http://localhost:3000**. It's fully offline and uses no Firebase project: no setup and no cost. The emulators need **Java 21+**.

| Command | What it does |
|---|---|
| `npm run dev` | Local app on http://localhost:3000 with emulators |
| `npm test` | End-to-end tests on the emulators, against a fake Spotify |
| `npm run typecheck` | TypeScript check of the client |
| `npm run build` | Production build into `client/dist` (plus the legal pages) |
| `npm run deploy` | Build and deploy from your machine (`npx firebase login` first) |

Connecting Spotify locally works too. Spotify only accepts the deployed site as a return address, so the live site hands the login straight back to `localhost:3000`. Set `PUBLIC_URL` in `functions/.env.demo-queueup` to your live site.

## How it works

```
Browser (React)  ──reads live──▶  Firestore (read-only rules)
       │                               ▲
       └──calls──▶  Cloud Function "api" (europe-west1) ──writes──┘
                          │
                          └──▶ Spotify Web API (DJ's own app, PKCE)
```

- **Reads** are live Firestore listeners: guests see requests and votes update instantly.
- **All writes** go through one callable function, `api`. It validates input, checks who is the DJ, rate-limits, and talks to Spotify. Firestore rules forbid every direct write from browsers.
- **Identity**: every visitor gets an anonymous Firebase sign-in (no account, no personal data). The DJ's device is added to the party's DJ list after the PIN is entered.
- **Secrets**: Spotify tokens live in a document that no browser can read.

## Project structure

```
client/                React + TypeScript + Motion (Vite)
  src/components/      Reusable UI, one folder each (Component.tsx, .module.css, index.ts) + barrel
  src/pages/           Home, Guest, Dj, SpotifyCallback, Ended. One folder each + barrel
  src/hooks/           useRoom (live Firestore state), useProgress, useCopy, …
  src/lib/             firebase, api (call), motion presets, haptics, storage, formatting
  public/              Fonts, favicon, brand assets
functions/             Cloud Function "api" + daily cleanup (Node 22)
  src/ops.js           Every party operation (create, request, vote, DJ actions, Spotify)
  src/spotify.js       Spotify client (PKCE, single-flight token refresh)
legal/                 Terms + Privacy templates (rendered to static pages at build)
firestore.rules        Read-only access rules
firebase.json          Hosting (security headers), Firestore, Functions, emulators
.github/workflows/     CI/CD: test on every push/PR, deploy main to Firebase
test/                  Emulator end-to-end tests + Spotify unit tests
```

## Deploying to Firebase

### One-time setup (in the consoles, about 15 minutes)

1. **Create the project** at [console.firebase.google.com](https://console.firebase.google.com). Give it a short ID such as `queueup-party`. You can turn Google Analytics **off**; it isn't needed.
2. **Upgrade to Blaze** (pay-as-you-go). Cloud Functions require it, but QueueUp stays inside the free tier. Then **set a budget alert**: Google Cloud console > Billing > Budgets & alerts > create a budget of **$1** with email alerts at 50%, 90% and 100%. A budget alert only emails you; it doesn't stop spending.
3. **Firestore**: Build > Firestore Database > Create database > **Production mode**, location **europe-west1**. The location can't be changed later.
4. **Anonymous sign-in**: Build > Authentication > Get started > Sign-in method > **Anonymous** > Enable.
5. **Web app config**: Project settings > General > Your apps > Add app > Web. Copy `apiKey`, `authDomain`, `projectId` and `appId`.
6. **Point the repo at your project**: put your project ID in `.firebaserc`, and set `PUBLIC_URL` in `functions/.env.demo-queueup` to your site address.
   QueueUp uses a second Hosting site with a readable name, `queueup-party` (`firebase hosting:sites:create`), set as `site` in `firebase.json`. The project's default address (`<project-id>.web.app`) only redirects there.
7. **First deploy from your machine**. As project owner, this switches on the Google Cloud APIs the deploy needs: Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, Cloud Scheduler.
   ```bash
   npx firebase login
   cp .env.example .env    # fill in the four FIREBASE_* values
   npm run deploy
   ```
   When asked how long to keep container images, accept the default, so old build images get deleted and don't cost storage.

### GitHub Actions (automatic deploys from `main`)

8. **Deploy robot account**: Google Cloud console > IAM & Admin > Service Accounts > Create `github-deploy`, with these roles:
   Firebase Hosting Admin, Firebase Rules Admin, Cloud Datastore Index Admin, Cloud Functions Admin, Cloud Scheduler Admin, Service Account User, Cloud Build Editor, Artifact Registry Administrator, Service Usage Consumer.
   Then Keys > Add key > JSON. **Never commit this file.**
9. **Repository secrets** (GitHub > Settings > Secrets and variables > Actions > Secrets):
   | Secret | Value |
   |---|---|
   | `SERVICE_ACCOUNT` | The whole JSON key file |
   | `FIREBASE_PROJECT_ID` | Your project ID |
   | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID` | From step 5 |
   | `FIREBASE_APPCHECK_SITE_KEY` | Optional (see App Check below) |
10. **Repository variables** (same page, Variables tab): `OPERATOR_NAME`, `OPERATOR_CONTACT`, `OPERATOR_ADDRESS`, `GOVERNING_LAW` for the legal pages. `PUBLIC_URL` (the site address, here `https://queueup-party.web.app`). Optional: `ENFORCE_APP_CHECK`.

After that, every push to `main`:
1. Type-checks, builds, and runs the full test suite on the emulators.
2. If the tests pass, deploys the **functions** (only when `functions/` changed), then the **Firestore rules and indexes**, then **Hosting**.

Pull requests run the tests but never deploy. You can also run the workflow by hand from the Actions tab.

### Spotify redirect URI

Each DJ adds this once to their own Spotify app. The setup guide shows it with a copy button:
`https://queueup-party.web.app/auth/spotify/callback`

### App Check (recommended before you share the site widely)

App Check stops scripts from hammering the API or Firestore, which protects both your data and your bill. To set it up:
1. In Google Cloud, create a **reCAPTCHA Enterprise** key for your domain. The free tier is 10,000 assessments a month.
2. Register it in Firebase > App Check.
3. Add the secret `FIREBASE_APPCHECK_SITE_KEY` and the variable `ENFORCE_APP_CHECK=true`, then redeploy with *Also deploy Cloud Functions* ticked.
4. Finally, turn on enforcement for Firestore in the App Check console.

## Costs

Built to stay within Firebase's free quotas:
- **Hosting**: 10 GB storage and 360 MB/day transfer free. The app is about 0.5 MB.
- **Firestore**: 50k reads, 20k writes and 20k deletes a day free. Guests only watch active requests, and the party document is only written when something changes. A busy 50-person party uses roughly 15k reads an hour.
- **Cloud Functions**: 2M calls a month free. One function, capped at **3 instances**, 256 MiB, 30 s timeout. The DJ console refreshes "now playing" every 5 s, and guests only when a song is overdue.
- **Cleanup**: a daily job deletes parties idle for 48 hours, so storage stays near zero. Old build images are cleaned up automatically.

The main risk to the bill is automated abuse of public reads. App Check plus the $1 budget alert cover it.

## How Spotify works (and why each DJ uses their own app)

Spotify's development-mode apps are limited to **5 users** and need an owner with **Premium** (rules since Feb 2026). So each DJ connects **their own free Spotify developer app** through a 3-step guide:
1. Create the app.
2. Paste the Client ID, or the app page's web address (the ID is detected automatically).
3. Connect.

The key is remembered on that device. Login uses **PKCE**, so no client secret is involved. The login is bound to the DJ's own browser, and the tokens are stored server-side only. Requirements for the DJ: **Spotify Premium**, and Spotify open and playing on some device.

## Security

- **Firestore rules are read-only.** Browsers can read a party and its requests. DJ data is readable only by that party's signed-in DJs, and Spotify tokens by nobody.
- **All writes go through the function**, which handles permission checks, input cleaning (invisible and text-direction characters stripped), rate limits (PIN guessing, requests, votes, searches, party creation) and guest blocking.
- **Guests can't forge songs**: search results are signed (HMAC), so a guest can't change a title, link or explicit flag.
- **Spotify login** uses PKCE, is bound to the DJ's browser, uses single-use state, survives token refreshes across instances, and respects Spotify's rate limits.
- **Hosting** sends a strict Content Security Policy and other security headers. Fonts are self-hosted, with no third-party scripts.
- **CI** never deploys pull requests. The deploy key exists only as a GitHub secret and is deleted after each run.

## Legal

Terms of Service (`/terms`), Privacy Policy (`/privacy`), a proprietary `LICENSE` and `THIRD_PARTY_NOTICES.md` are included. Read **LEGAL.md** before launch. QueueUp is for **private, non-commercial** use only, because Spotify forbids use in businesses.

**This repository is public.** The `LICENSE` reserves all rights, but anyone can still read the code. Make the repo private if you want it hidden; GitHub Actions works the same.

## Known limits

- **Votes are per browser, not per person.** A determined guest can vote again from a private window. That's fine for a party, but not for anything with stakes.
- **The guest count is "people who joined"**, not "people online right now". Live presence would cost a database write per guest every minute.
- **The first action after a quiet period can take 1–3 seconds**, while the function cold-starts (instances scale to zero to stay free).
- **Rate limits are kept in each function's memory.** With at most 3 instances they hold within a factor of 3, which is good enough with App Check in front.
