# WhatsApp + Baileys Starter

**Connect Node.js to your WhatsApp in 2 minutes. Scan a QR, and you can read, reply, save chats, download media, track stats and plug in AI. Free.**

## Why this exists

I keep seeing the same story: someone asks Claude (or another AI) to "connect my bot to WhatsApp with Baileys", gets code that *looks* right, and it doesn't work. The QR never appears, the bot disconnects forever, messages come in "empty", voice notes won't download, numbers show up as weird IDs, or it crashes on startup.

It happened to me too. I built a WhatsApp AI coach on Baileys and hit every one of those problems before it became stable enough to run every day. Since then I get a lot of messages from people who got stuck on exactly the same first steps.

So this is the connection I actually use, cleaned up and **pinned to the exact versions that work**. Take it, run it, and build your idea on top of it. If you use an AI to build, give it this repo and tell it to **use `connect.js` as-is**.

## What is this, actually?

[Baileys](https://github.com/WhiskeySockets/Baileys) connects to WhatsApp the same way **WhatsApp Web** does. Your script becomes a *linked device* on your account:

```
 Your phone (WhatsApp)  ──  Linked devices  ──┬── WhatsApp Web
                                              ├── WhatsApp Desktop
                                              └── this script  ← you scan a QR once, like WhatsApp Web
```

- **No Meta Business account, no API fees, no approval.** It's your normal WhatsApp.
- Scan once. The session is saved in `auth/`, so it reconnects by itself after that.
- Anything you can do in WhatsApp Web, your code can do:
  - 💬 read & reply in private chats and groups
  - 💾 save / export your conversations
  - 🖼️ download photos, videos, voice notes, stickers, documents
  - 📊 track data: who writes, when, how much
  - 🤖 plug in an AI that answers for you
  - 📤 send text, images, files, stickers, reactions, read receipts, "typing..."

## Tested versions

| | Version |
|---|---|
| `@whiskeysockets/baileys` | **7.0.0-rc14** (pinned, not `^`) |
| Node.js | **v22.16.0** (needs ≥ 20) |
| `qrcode-terminal` | 0.12.0 |
| `pino` | 9.14.0 |
| OS | Windows 11 and Linux |

> Versions are pinned on purpose. Baileys changes fast, and "latest" is the #1 reason tutorials break. Upgrade on purpose, not by accident.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer (`node -v` to check). No git? Click **Code → Download ZIP** above and unzip it.

```bash
git clone https://github.com/YOUR-USERNAME/whatsapp-baileys-starter.git
cd whatsapp-baileys-starter
npm install
npm start
```

1. A QR code appears in the terminal.
2. On your phone: **WhatsApp → Settings → Linked devices → Link a device** → scan it.
3. You'll see `✅ Connected to WhatsApp`.
4. From **another phone**, send `ping` to your number. The bot replies `pong 🏓`.

That's it. Change `onMessage` in [index.js](index.js) and you have your own bot.

**No camera / running on a server?** Put `PAIRING_PHONE=972501234567` (your number) in `.env`. You'll get an 8-character code instead of a QR. On the phone, pick "Link with phone number instead".

## Examples

Each one is a small, standalone file. Copy `.env.example` to `.env` first if you need settings.

| Command | What it does |
|---|---|
| `npm start` | [index.js](index.js): minimal bot. Prints every message, answers `ping` |
| `npm run save-chats` | [save-chats.js](examples/save-chats.js): saves every message (live + history) to `data/chats/` |
| `npm run media` | [download-media.js](examples/download-media.js): auto-saves photos, videos, voice notes, stickers, documents to `data/media/` |
| `npm run stats` | [stats.js](examples/stats.js): busiest chats, top senders, activity by hour/weekday → also `data/stats.json` |
| `npm run export -- <number/name>` | [export-chat.js](examples/export-chat.js): exports one chat to a readable `.txt`. Add `--send <number>` to send the file to someone on WhatsApp |
| `npm run ai` | [ai-bot.js](examples/ai-bot.js): an AI (Gemini, free tier) that chats for you, only with the numbers you allow |

**Getting your old chats:** WhatsApp sends history only right after a *fresh* link. Delete `auth/`, run `npm run save-chats`, scan, and leave it running a few minutes.

> Only **one script at a time** can use the same `auth/` folder. Stop one (Ctrl+C) before starting another, or give each its own `AUTH_DIR`.

## Build your own

```js
import { connect, textOf, senderOf } from './connect.js';

await connect({
  onMessage: async (msg, bot) => {
    if (msg.key.fromMe) return;
    const chat = msg.key.remoteJid;          // reply here
    const text = textOf(msg);                // text or caption, works for every message type
    const from = senderOf(msg);              // real phone number

    await bot.send(chat, { text: `you said: ${text}` });
    // bot.send(chat, { image: buffer, caption: 'hi' })
    // const buf = await bot.download(msg)   // any media → Buffer
  },
});
```

Helpers in [connect.js](connect.js): `textOf`, `typeOf`, `quotedTextOf`, `senderOf`, `chatIdOf`, `timeOf`, `unwrap`, `isGroup`, `isStatus`, `sleep`.

## What connect.js handles for you

These are the reasons "from scratch" Baileys code breaks:

| Problem | What happens without it | Fix in connect.js |
|---|---|---|
| Baileys 7 is an ES module | `ERR_REQUIRE_ESM` / crash on start | `"type": "module"` + Node ≥ 20 |
| Wrapped messages | Messages in chats with **disappearing messages**, view-once, or edited messages look empty | `unwrap()` via `normalizeMessageContent` |
| `@lid` IDs | Sender shows as a random number that isn't a phone | `senderOf()` finds the real number in the alt fields |
| Expired media | Downloading older photos / voice notes fails | `reuploadRequest` asks the phone to re-upload |
| Retry requests | Recipient sees *"Waiting for this message"* | `getMessage` returns from a cache of sent messages |
| Disconnects | Bot dies after a network blip, or after the 515 restart right after scanning | Auto-reconnect, except on logout |
| The "Desktop browser" tip | `browser: Browsers.macOS('Desktop')` (often suggested for more history) → **no QR, endless code 428** | Keeps Baileys' default browser |
| Two scripts, one session | Endless connect/disconnect loop | Detects code 440 and tells you |
| Always "online" | Your phone stops getting notifications | `markOnlineOnConnect: false` |
| Credentials | You have to scan again after every restart | `creds.update` → saved every time |
| Noise | Terminal flooded with JSON logs | Quiet by default, `LOG_LEVEL=debug` when needed |

## Troubleshooting

| You see | Do this |
|---|---|
| `Logged out` | Delete the `auth/` folder and run again to scan a new QR |
| `Another script is connected with the same auth folder` | Stop the other script. One per `auth/` folder |
| QR keeps refreshing | Normal. A new one every ~20s until you scan |
| No QR, only `Disconnected (code 428)` over and over | You (or your AI) set a custom `browser` in `makeWASocket`. Remove it |
| Keeps disconnecting with code 405 / never connects | WhatsApp changed something. Update Baileys to the newest version and test |
| Nothing happens when you message yourself | Message the number from **another** phone. The examples ignore your own messages on purpose |
| Something weird | `LOG_LEVEL=debug` in `.env` and read the logs |

## ⚠️ Use it responsibly

- **This is unofficial.** It isn't Meta's API, and WhatsApp can ban numbers that act like bots. To stay safe:
  - Use a **secondary number** for anything automated.
  - **No spam**, no bulk messages to people who didn't message you first.
  - Keep a human pace (the AI example already does this).
- **`auth/` = full access to your WhatsApp.** Never commit it, share it, or upload it. `.gitignore` already excludes it.
- **Privacy:** saving or exporting other people's messages and media may need their consent where you live. Use it for your own chats and your own business.
- For a big commercial product, look at the official WhatsApp Business Platform. It's paid, but there's no ban risk.

## License

MIT. Use it, change it, ship it. A ⭐ helps others find it.
