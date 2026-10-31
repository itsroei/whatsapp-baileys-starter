/**
 * examples/export-chat.js — export one conversation to a readable .txt (like WhatsApp's "Export chat"),
 * and optionally send the file to someone on WhatsApp.
 *
 * Run:
 *   npm run export -- --list                          list saved chats
 *   npm run export -- 972501234567                    export a chat (by number, group name or contact name)
 *   npm run export -- "Family" --send 972501234567    export + send the .txt to that number as a file
 *
 * Output: data/exports/<chat name>.txt
 *   [30/10/2026, 14:05] Dana: see you tomorrow
 *
 * Needs chats saved by "npm run save-chats". Sending connects to WhatsApp, so stop other scripts first.
 */

import fs from 'node:fs';
import path from 'node:path';
import { connect, ROOT, sleep } from '../connect.js';
import { loadChats, loadNames, nameOf } from './chat-data.js';

const args = process.argv.slice(2);
const sendIdx = args.indexOf('--send');
const sendTo = sendIdx > -1 ? (args[sendIdx + 1] || '').replace(/\D/g, '') : '';
const query = args.filter((a, i) => !a.startsWith('--') && (sendIdx === -1 || i !== sendIdx + 1))[0] || '';

const names = loadNames();
const chats = loadChats();

if (args.includes('--list') || !query) {
  console.log('\nSaved chats (most messages first):\n');
  for (const c of chats.sort((a, b) => b.messages.length - a.messages.length)) {
    console.log(`  ${String(c.messages.length).padStart(6)}  ${nameOf(c.chat, names, c.name).padEnd(30)} ${c.chat.split('@')[0]}`);
  }
  console.log('\nExport one:  npm run export -- <number or name>\n');
  process.exit(0);
}

// find the chat: exact number → name contains → number contains
const q = query.toLowerCase();
const digits = query.replace(/\D/g, '');
const match =
  chats.find(c => digits && c.chat.split('@')[0] === digits) ||
  chats.find(c => nameOf(c.chat, names, c.name).toLowerCase().includes(q)) ||
  chats.find(c => digits && c.chat.includes(digits));
if (!match) { console.error(`No chat matching "${query}". Try: npm run export -- --list`); process.exit(1); }

const title = nameOf(match.chat, names, match.name);
const fmt = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const lines = match.messages.map(m => {
  const who = m.fromMe ? 'Me' : nameOf(m.from, names, m.name);
  const body = m.text || `<${m.type}>`;
  return `[${fmt(m.time)}] ${who}: ${m.quoted ? `(replying to: "${m.quoted.slice(0, 50)}") ` : ''}${body}`;
});

const out = path.join(ROOT, 'data', 'exports', title.replace(/[\\/:*?"<>|]/g, '_') + '.txt');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `Chat with ${title} — ${lines.length} messages\n\n` + lines.join('\n') + '\n');
console.log(`✅ Exported ${lines.length} messages → ${path.relative(process.cwd(), out)}`);

if (sendTo) {
  await connect({
    onOpen: async (bot) => {
      await bot.send(sendTo + '@s.whatsapp.net', {
        document: fs.readFileSync(out),
        fileName: path.basename(out),
        mimetype: 'text/plain',
        caption: `Chat export: ${title} (${lines.length} messages)`,
      });
      console.log(`📤 Sent to ${sendTo}`);
      await sleep(3000);       // let the upload finish before exiting
      process.exit(0);
    },
  });
}
