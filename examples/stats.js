/**
 * examples/stats.js — statistics from your saved chats. Works offline (no WhatsApp connection).
 *
 * Run:   npm run stats                 (everything)
 *        npm run stats -- --days 30    (only the last 30 days)
 *
 * Shows: busiest chats, who writes the most, messages by hour and by weekday, message types.
 * Also writes the numbers to data/stats.json — easy to load into Excel / a dashboard / an AI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../connect.js';
import { loadChats, loadNames, nameOf } from './chat-data.js';

const daysArg = process.argv.indexOf('--days');
const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 0;
const since = days ? new Date(Date.now() - days * 86400000).toISOString() : '';

const names = loadNames();
const chats = loadChats();

const byChat = {}, bySender = {}, byType = {};
const chatName = Object.fromEntries(chats.map(c => [c.chat, c.name]));
const byHour = Array(24).fill(0), byDay = Array(7).fill(0);
let total = 0, mine = 0, first = '', last = '';

for (const { chat, messages } of chats) {
  for (const m of messages) {
    if (since && m.time < since) continue;
    total++;
    if (m.fromMe) mine++;
    byChat[chat] = (byChat[chat] || 0) + 1;
    const who = m.fromMe ? 'me' : m.from;
    bySender[who] = bySender[who] || { count: 0, name: m.name };
    bySender[who].count++;
    if (m.name) bySender[who].name = m.name;
    byType[m.type] = (byType[m.type] || 0) + 1;
    const d = new Date(m.time);
    byHour[d.getHours()]++;
    byDay[d.getDay()]++;
    if (!first || m.time < first) first = m.time;
    if (!last || m.time > last) last = m.time;
  }
}

if (!total) { console.log('No messages in this range.'); process.exit(0); }

const top = (obj, n = 10) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const bar = (v, max) => '█'.repeat(Math.round((v / max) * 30)) || (v ? '▏' : '');

console.log(`\n📊 ${total.toLocaleString()} messages in ${Object.keys(byChat).length} chats` +
  `  (${first.slice(0, 10)} → ${last.slice(0, 10)}${days ? `, last ${days} days` : ''})`);
console.log(`   sent by you: ${mine.toLocaleString()} · received: ${(total - mine).toLocaleString()}`);

console.log('\n💬 Busiest chats');
for (const [chat, n] of top(byChat)) console.log(`   ${String(n).padStart(6)}  ${nameOf(chat, names, chatName[chat])}`);

console.log('\n🗣️  Who writes the most');
const senders = Object.entries(bySender).map(([id, s]) => [id, s.count, s.name]).sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [id, n, name] of senders) console.log(`   ${String(n).padStart(6)}  ${nameOf(id, names, name)}`);

console.log('\n🕐 By hour');
const maxH = Math.max(...byHour);
byHour.forEach((v, h) => console.log(`   ${String(h).padStart(2, '0')}:00 ${bar(v, maxH)} ${v}`));

console.log('\n📅 By weekday');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const maxD = Math.max(...byDay);
byDay.forEach((v, d) => console.log(`   ${DAYS[d]} ${bar(v, maxD)} ${v}`));

console.log('\n🧩 Message types');
for (const [t, n] of top(byType, 20)) console.log(`   ${String(n).padStart(6)}  ${t}`);

const out = path.join(ROOT, 'data', 'stats.json');
fs.writeFileSync(out, JSON.stringify({
  generated: new Date().toISOString(), days: days || null, total, mine, first, last,
  chats: top(byChat, 1000).map(([chat, count]) => ({ chat, name: nameOf(chat, names, chatName[chat]), count })),
  senders: senders.map(([id, count, name]) => ({ id, name: nameOf(id, names, name), count })),
  byHour, byWeekday: Object.fromEntries(DAYS.map((d, i) => [d, byDay[i]])), byType,
}, null, 2));
console.log(`\n✅ Saved ${path.relative(process.cwd(), out)}\n`);
