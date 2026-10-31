/**
 * index.js — the smallest useful bot: prints every message, answers "ping" with "pong".
 *
 * Run:  npm start   (first time: scan the QR)
 * Test: from ANOTHER phone, send "ping" to the WhatsApp number you linked.
 *
 * Start your own project by copying this file and changing onMessage.
 */

import { connect, textOf, typeOf, senderOf, isGroup, isStatus } from './connect.js';

await connect({
  onMessage: async (msg, bot) => {
    const chat = msg.key.remoteJid;
    if (isStatus(chat)) return;                       // ignore people's status updates

    const text = textOf(msg);
    console.log(`📩 ${isGroup(chat) ? '[group] ' : ''}${msg.pushName || senderOf(msg)}: ${text || `<${typeOf(msg)}>`}`);

    if (msg.key.fromMe) return;                       // never answer yourself (avoids infinite loops)
    if (text.trim().toLowerCase() === 'ping') {
      await bot.send(chat, { text: 'pong 🏓' }, { quoted: msg });
    }
  },
});
