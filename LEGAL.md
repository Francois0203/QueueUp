# Legal & compliance: launch checklist

QueueUp ships with draft **Terms of Service** (`/terms`) and a **Privacy Policy** (`/privacy`) written to match exactly what the code does.
They are a solid starting point, **not legal advice**. Have a lawyer in your jurisdiction review them before you open QueueUp to the public.

## Before going public: you must do these

| # | Task | Why |
|---|------|-----|
| 1 | Set `OPERATOR_NAME`, `OPERATOR_CONTACT`, `OPERATOR_ADDRESS`, `GOVERNING_LAW`, `HOSTING_PROVIDER` in the environment | They fill the legal pages. The server warns at startup while placeholders are showing. |
| 2 | Put your legal name in `LICENSE` | Copyright notice for your code. |
| 3 | Lawyer review of `public/terms.html` and `public/privacy.html` | Liability limits, consumer law and governing-law clauses vary by country. |
| 4 | Download the official **Spotify logo** from [developer.spotify.com/design](https://developer.spotify.com/design) and save it as `public/brand/spotify-logo.svg` | Spotify requires its logo next to Spotify content. Until the file exists, the app shows the word "Spotify". Never redraw the logo yourself. |
| 5 | Trademark search for "QueueUp" in your markets | Other music apps use similar names. Check before you invest in the brand. |
| 6 | Data-protection registration, if your country requires it | For example, South Africa's POPIA expects an Information Officer registered with the Information Regulator, and some EU countries have similar duties. |
| 7 | Sign your host's data processing agreement (AWS: the GDPR DPA in AWS Artifact) and pick a region | The Privacy Policy says data is hosted under a DPA. |
| 8 | Set `DATA_ENCRYPTION_KEY` from a secret store (e.g. AWS Secrets Manager / SSM Parameter Store) | Keeps the encryption key off the disk holding the data. |
| 9 | Create a real inbox for `OPERATOR_CONTACT` and answer data requests (usually within 30 days) | Required under the GDPR and POPIA. |

## Spotify rules that shape the product (don't break these)

- **Private, non-commercial use only.** Spotify's consumer terms and Developer Policy forbid using Spotify in businesses (bars, restaurants, shops, clubs) or for commercial purposes, and name software for such venues as a violation. QueueUp's Terms carry this through to hosts.
  **Do not** market QueueUp to venues or paid DJs, charge money for it, or run ads on it while it uses Spotify.
- **Development mode only.** Each DJ uses their own development-mode Spotify app. Extended quota is not realistic, and commercial use isn't allowed in development mode anyway.
- **Artwork must stay untouched**: no blurring, overlays, cropping or animation, and only lightly rounded corners. The UI's ambient effects are pure gradients and never use album art. If you redesign, keep it that way.
- **Attribution and link-back.** Spotify metadata and artwork must link back to Spotify, with Spotify's logo shown. Artwork and "Open in Spotify" links do this. Spotify's guidance on per-item links is ambiguous; if you ever apply for anything with Spotify, ask their brand team to confirm.
- **Don't store Spotify content longer than needed.** QueueUp keeps track metadata only for the life of a party (max 48 h idle).

## Music licensing (the host's responsibility, and stated in the Terms)

Playing recorded music to other people can need public performance licences (from music rights organisations), separate from Spotify. QueueUp doesn't grant any. The Terms make this explicit, and private home parties are generally the low-risk case.

## What's already in place

- Clickwrap: hosts must tick "I agree to the Terms and Privacy Policy, and this is a private, non-commercial party". The server refuses to create a party without it, and stores which Terms version was accepted, and when.
- Guests see a notice and links in the request sheet. Every page footer links to the Terms and Privacy Policy and says "not affiliated with Spotify".
- Data minimisation and automatic deletion (3 h / 48 h), deletion on demand (end party, withdraw request, disconnect Spotify), encrypted storage, no analytics, no third-party scripts or fonts.
- Cookies are strictly necessary only, so no consent banner is needed under the EU ePrivacy rules.
- Moderation tools: dismiss, block guest, hide names, explicit filter.
- `LICENSE` (proprietary, all rights reserved) and `THIRD_PARTY_NOTICES.md` (all dependencies are permissive MIT/ISC; the Inter font is under the OFL, whose notice ships in `public/fonts/OFL.txt`).

## When you change things

- Changed what data you collect, or why? Update `public/privacy.html`.
- Changed the Terms materially? Bump `TERMS_VERSION` in `server.js`. New hosts accept the new version, and the stored record shows who accepted which.
