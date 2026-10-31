/**
 * examples/save-chats.js — save every message (private chats + groups) to files.
 *
 * Run: npm run save-chats
 *
 * Output: data/chats/<chat-id>.jsonl — one JSON line per message:
 *   {"id","chat","from","name","fromMe","time","type","text","quoted"}
 * Plus data/names.json — chat ID → contact / group name (used by stats.js and export-chat.js).
 *
 * 💡 Old chats: WhatsApp sends past messages ONLY right after a *fresh* link.
 *    To grab your history: delete the auth folder, run this, scan the QR, and leave it
 *    running for a few minutes while "📚 history" lines come in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { connect, ROOT, textOf, typeOf, quotedTextOf, senderOf, chatIdOf, timeOf, isGroup, isStatus, isNewsletter } from '../connect.js';

const DIR = path.join(ROOT, 'data', 'chats');
const NAMES_FILE = path.join(ROOT, 'data', 'names.json');
fs.mkdirSync(DIR, { recursive: true });

const fileOf = (chatId) => path.join(DIR, chatId.replace(/[^\w.@-]/g, '_') + '.jsonl');

// Remember what's already saved, so history + live messages never get written twice.
const seen = new Set();
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl'))) {
  for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    try { if (line) seen.add(JSON.parse(line).id); } catch (_) {}
  }
}

let names = {};
try { names = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')); } catch (_) {}
let namesDirty = false;
function setName(id, name) {
  if (id && name && names[id] !== name) { names[id] = name; namesDirty = true; }
}
setInterval(() => {
  if (namesDirty) { fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2)); namesDirty = false; }
}, 5000);

function save(msg) {
  const chat = chatIdOf(msg);
  if (!chat || isStatus(chat) || isNewsletter(chat)) return false;
  const id = msg.key?.id;
  if (!id || seen.has(id)) return false;
  const type = typeOf(msg);
  if (!type || type === 'protocolMessage' || type === 'senderKeyDistributionMessage') return false;
  seen.add(id);

  const row = {
    id,
    chat,
    from: senderOf(msg),
    name: msg.pushName || '',
    fromMe: !!msg.key.fromMe,
    time: timeOf(msg).toISOString(),
    type: type.replace(/Message$/, ''),     // conversation / extendedText / image / audio / sticker ...
    text: textOf(msg),
  };
  const quoted = quotedTextOf(msg);
  if (quoted) row.quoted = quoted;
  fs.appendFileSync(fileOf(chat), JSON.stringify(row) + '\n');

  if (!isGroup(chat) && !msg.key.fromMe) setName(chat, msg.pushName);
  return true;
}

const groupNameAsked = new Set();

await connect({
  onMessage: async (msg, bot) => {
    if (!save(msg)) return;
    const chat = chatIdOf(msg);
    console.log(`💾 ${names[chat] || chat}: ${textOf(msg).slice(0, 60) || `<${typeOf(msg)}>`}`);

    // first message from a group → fetch its name once
    if (isGroup(chat) && !names[chat] && !groupNameAsked.has(chat)) {
      groupNameAsked.add(chat);
      try { setName(chat, (await bot.sock.groupMetadata(chat)).subject); } catch (_) {}
    }
  },

  onHistory: async ({ chats, contacts, messages }) => {
    for (const c of chats || []) setName(c.id, c.name);
    for (const c of contacts || []) setName(c.id, c.name || c.notify);
    let n = 0;
    for (const msg of messages || []) if (save(msg)) n++;
    console.log(`📚 history: +${n} messages (${chats?.length || 0} chats)`);
  },
});

console.log(`Saving to ${path.relative(process.cwd(), DIR)} — Ctrl+C to stop.`);
