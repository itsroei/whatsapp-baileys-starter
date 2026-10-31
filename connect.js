/**
 * connect.js — a WhatsApp connection with Baileys that actually works.
 *
 * Every example in this repo imports this one file. If you build something on top of it
 * (or ask an AI to), keep this file as-is and write your logic in your own file —
 * almost every "my Baileys bot doesn't work" story comes from re-writing the connection.
 *
 * How it works: Baileys connects as a *linked device* of your WhatsApp account, exactly like
 * WhatsApp Web / Desktop. First run prints a QR → on your phone open
 * WhatsApp → Settings → Linked devices → Link a device → scan. The session is saved in ./auth,
 * so from then on it reconnects by itself without scanning again.
 *
 * Usage:
 *   import { connect, textOf } from './connect.js';
 *   await connect({
 *     onMessage: async (msg, bot) => {
 *       if (textOf(msg) === 'ping') await bot.send(msg.key.remoteJid, { text: 'pong' });
 *     },
 *   });
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeWASocket, useMultiFileAuthState, DisconnectReason,
  downloadMediaMessage, normalizeMessageContent, getContentType,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

/* ── Load .env (no extra library). Values already set in the environment win. ── */
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
})();

// Baileys logs a LOT by default (JSON lines at "info"). Set LOG_LEVEL=debug in .env when troubleshooting.
const logger = pino({ level: process.env.LOG_LEVEL || 'error' });

/**
 * Connect to WhatsApp and keep the connection alive (auto-reconnect).
 *
 * @param {object}   opts
 * @param {Function} [opts.onMessage]  (msg, bot) — every new message, incoming AND the ones you send from your phone (msg.key.fromMe)
 * @param {Function} [opts.onHistory]  ({ chats, contacts, messages }, bot) — old chats WhatsApp sends right after a *fresh* QR scan
 * @param {Function} [opts.onOpen]     (bot) — called every time the connection is (re)opened
 * @param {string}   [opts.authDir]    session folder (default ./auth). Two scripts must NOT use the same folder at the same time.
 * @param {object}   [opts.socketOptions] extra options passed straight to makeWASocket
 * @returns {Promise<{sock, send, download, isOpen}>} `bot` — always use bot.sock (it's replaced on reconnect)
 */
export async function connect({ onMessage, onHistory, onOpen, authDir, socketOptions = {} } = {}) {
  const AUTH_DIR = path.resolve(ROOT, authDir || process.env.AUTH_DIR || 'auth');
  const PAIRING_PHONE = (process.env.PAIRING_PHONE || '').replace(/\D/g, '');

  // Messages we sent, so Baileys can re-send them if the other phone asks for a retry.
  // Without this the other side sometimes sees "Waiting for this message. This may take a while."
  const sentCache = new Map();

  const bot = {
    sock: null,
    isOpen: false,

    /** Send anything: { text }, { image: buffer, caption }, { sticker: buffer }, { document, fileName, mimetype }... */
    async send(jid, content, options = {}) {
      const sent = await bot.sock.sendMessage(jid, content, options);
      if (sent?.key?.id && sent.message) {
        sentCache.set(sent.key.id, sent.message);
        if (sentCache.size > 500) sentCache.delete(sentCache.keys().next().value);
      }
      return sent;
    },

    /** Download the media of a message (image / video / voice / sticker / document) → Buffer. */
    download(msg) {
      // unwrap first, otherwise media inside disappearing / view-once messages can't be found.
      // reuploadRequest: if the media is old and expired on WhatsApp's servers, ask the phone to re-upload it.
      return downloadMediaMessage({ ...msg, message: unwrap(msg.message) }, 'buffer', {},
        { reuploadRequest: bot.sock.updateMediaMessage, logger });
    },
  };

  let connecting = false;

  async function start() {
    if (connecting) return;
    connecting = true;
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let pairingRequested = false;

    const sock = makeWASocket({
      auth: state,
      logger,
      // Don't override `browser`. The popular tip `Browsers.macOS('Desktop')` (for more history) currently makes
      // WhatsApp refuse NEW links — no QR, endless "code 428" disconnects. The default works.
      markOnlineOnConnect: false,          // otherwise you look online all the time and your phone stops getting notifications
      getMessage: async (key) => sentCache.get(key?.id),
      ...socketOptions,
    });
    bot.sock = sock;

    sock.ev.on('creds.update', saveCreds);  // the session keys change constantly — must be saved on every update

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr) {
        if (PAIRING_PHONE && !sock.authState.creds.registered) {
          // No camera / running on a server? Link with an 8-character code instead of a QR.
          if (!pairingRequested) {
            pairingRequested = true;
            try {
              const code = await sock.requestPairingCode(PAIRING_PHONE);
              console.log(`\n🔑 Pairing code: ${code}\n   WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead"\n`);
            } catch (e) { console.error('pairing code failed:', e.message); }
          }
        } else {
          console.log('\n📱 Scan with WhatsApp → Settings → Linked devices → Link a device:\n');
          qrcode.generate(qr, { small: true });
        }
      }

      if (connection === 'open') {
        connecting = false;
        bot.isOpen = true;
        console.log(`✅ Connected to WhatsApp as ${sock.user?.id?.split(':')[0]?.split('@')[0] || '?'}`);
        if (onOpen) { try { await onOpen(bot); } catch (e) { console.error('onOpen error:', e); } }
      }

      if (connection === 'close') {
        connecting = false;
        bot.isOpen = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        try { sock.ev.removeAllListeners(); } catch (_) {}

        if (code === DisconnectReason.loggedOut) {
          console.log('❌ Logged out (you removed the device from your phone, or the session died).');
          console.log(`   Delete the folder "${path.relative(process.cwd(), AUTH_DIR) || AUTH_DIR}" and run again to scan a new QR.`);
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          console.log('❌ Another script is connected with the same auth folder. Stop it (only one at a time), then run again.');
          return;
        }
        // Anything else (network drop, 515 "restart required" right after scanning, server restart) → just reconnect.
        console.log(`⚠️ Disconnected (code ${code}) — reconnecting in 3s...`);
        setTimeout(() => start().catch(e => console.error('reconnect failed:', e.message)), 3000);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !onMessage) return;   // "notify" = new messages; other types are sync noise
      for (const msg of messages) {
        const kind = typeOf(msg);
        if (!kind || kind === 'protocolMessage' || kind === 'senderKeyDistributionMessage') continue;  // internal, not real messages
        try { await onMessage(msg, bot); } catch (e) { console.error('onMessage error:', e); }
      }
    });

    if (onHistory) {
      sock.ev.on('messaging-history.set', async (h) => {
        try { await onHistory(h, bot); } catch (e) { console.error('onHistory error:', e); }
      });
    }
  }

  await start();
  return bot;
}

/* ──────────────────────────── helpers ──────────────────────────── */

/**
 * Unwrap disappearing / view-once / edited / document-with-caption messages.
 * Without this, a lot of messages look "empty" — e.g. EVERY message in a chat with disappearing messages on.
 */
export function unwrap(message) {
  if (!message) return message;
  try { return normalizeMessageContent(message); } catch (_) { return message; }
}

/** 'conversation' | 'extendedTextMessage' | 'imageMessage' | 'audioMessage' | 'videoMessage' | 'stickerMessage' | ... */
export function typeOf(msg) {
  const m = unwrap(msg?.message);
  return m ? getContentType(m) : undefined;
}

/** The text of a message (or the caption of a photo / video / document). '' if none. */
export function textOf(msg) {
  const m = unwrap(msg?.message);
  if (!m) return '';
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption
    || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

/** Text of the message this one replies to (quotes), '' if it isn't a reply. */
export function quotedTextOf(msg) {
  const m = unwrap(msg?.message);
  const type = m && getContentType(m);
  const q = unwrap(type && m[type]?.contextInfo?.quotedMessage);
  if (!q) return '';
  return q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || '';
}

export const isGroup = (jid) => !!jid && jid.endsWith('@g.us');
export const isStatus = (jid) => jid === 'status@broadcast';
export const isNewsletter = (jid) => !!jid && jid.endsWith('@newsletter');

/**
 * WhatsApp now often hides phone numbers behind "@lid" IDs (random numbers that are NOT phones).
 * Baileys puts the real number in one of several alternative fields — this finds it.
 * Returns the phone number (digits only), or the lid digits if WhatsApp didn't give us the phone.
 */
export function senderOf(msg) {
  const k = msg?.key || {};
  if (k.fromMe) return 'me';
  const cands = [k.participant, k.participantPn, k.participantAlt, k.remoteJid, k.remoteJidAlt, k.senderPn].filter(Boolean);
  const real = cands.find(j => j.endsWith('@s.whatsapp.net')) || cands.find(j => !j.endsWith('@g.us')) || '';
  return real.split('@')[0].split(':')[0];
}

/**
 * A stable ID for the chat: the group JID for groups, the phone JID (…@s.whatsapp.net) for private chats.
 * (To *reply*, just use msg.key.remoteJid — that always works.)
 */
export function chatIdOf(msg) {
  const k = msg?.key || {};
  if (isGroup(k.remoteJid)) return k.remoteJid;
  const cands = [k.remoteJid, k.remoteJidAlt, k.senderPn].filter(Boolean);
  return cands.find(j => j.endsWith('@s.whatsapp.net')) || k.remoteJid || '';
}

/** When the message was sent, as a Date. */
export function timeOf(msg) {
  const t = msg?.messageTimestamp;
  const sec = typeof t === 'object' && t !== null ? (t.toNumber ? t.toNumber() : Number(t.low)) : Number(t);
  return new Date((sec || 0) * 1000);
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
