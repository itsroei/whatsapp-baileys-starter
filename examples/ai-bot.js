/**
 * examples/ai-bot.js — an AI that chats on your WhatsApp (Google Gemini — has a free tier).
 *
 * Setup (.env):
 *   GEMINI_API_KEY=...                  free key: https://aistudio.google.com/apikey
 *   ALLOWED_NUMBERS=972501234567        who the bot answers (comma separated). Safety first —
 *                                       or AI_REPLY_ALL=1 to answer every private chat.
 *   AI_SYSTEM_PROMPT=...                optional: personality / rules
 *   GEMINI_MODEL=gemini-3.1-flash-lite  optional
 *
 * Run: npm run ai
 *
 * What makes it feel human (and not get stuck):
 *   - waits until the person stops typing: "hi" + "how are you" + "?" = ONE answer, not three
 *   - shows "typing..." while thinking
 *   - remembers the last messages of each chat
 *   - never answers groups, statuses, or itself
 *
 * Want another AI (Claude, OpenAI, a local model)? Only replace askAI() below.
 */

import { connect, textOf, senderOf, isGroup, isStatus, isNewsletter, sleep } from '../connect.js';

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const SYSTEM = process.env.AI_SYSTEM_PROMPT ||
  'You are a friendly assistant chatting on WhatsApp. Reply short and natural, like a person texting. Answer in the language the user writes in.';
const ALLOWED = (process.env.ALLOWED_NUMBERS || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
const REPLY_ALL = process.env.AI_REPLY_ALL === '1';

if (!KEY) { console.error('Missing GEMINI_API_KEY in .env (free key: https://aistudio.google.com/apikey)'); process.exit(1); }
if (!ALLOWED.length && !REPLY_ALL) {
  console.error('Set ALLOWED_NUMBERS in .env (who the bot may answer), or AI_REPLY_ALL=1 to answer everyone.');
  process.exit(1);
}

/* ── the AI call — swap this function to use any other model ── */
async function askAI(history) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim() || '';
}

/* ── memory: last 20 turns per chat (in RAM — resets on restart) ── */
const memory = new Map();
function remember(chat, role, text) {
  const h = memory.get(chat) || [];
  h.push({ role, text });
  memory.set(chat, h.slice(-20));
  return memory.get(chat);
}

/* ── wait for the person to finish typing, then answer once ── */
const QUIET_MS = 4000, MAX_WAIT_MS = 9000;
const pending = new Map();      // chat → { parts, firstAt, timer, lastMsg }

function collect(chat, text, msg, bot) {
  const p = pending.get(chat) || { parts: [], firstAt: Date.now(), timer: null };
  p.parts.push(text);
  p.lastMsg = msg;
  clearTimeout(p.timer);
  const wait = Math.max(300, Math.min(QUIET_MS, MAX_WAIT_MS - (Date.now() - p.firstAt)));
  p.timer = setTimeout(() => reply(chat, bot).catch(e => console.error('reply:', e.message)), wait);
  pending.set(chat, p);
  bot.sock.sendPresenceUpdate('composing', chat).catch(() => {});
}

async function reply(chat, bot) {
  const p = pending.get(chat);
  if (!p) return;
  pending.delete(chat);
  const text = p.parts.join('\n');
  const history = remember(chat, 'user', text);

  let answer;
  try {
    await bot.sock.sendPresenceUpdate('composing', chat).catch(() => {});
    answer = await askAI(history);
  } catch (e) {
    console.error('AI error:', e.message);
    answer = '';
  }
  if (!answer) {
    history.pop();                            // don't keep a question we never answered
    await bot.sock.sendPresenceUpdate('paused', chat).catch(() => {});
    return;
  }
  remember(chat, 'assistant', answer);
  await sleep(Math.min(3000, 400 + answer.length * 15));   // "typing" time that matches the answer length
  await bot.send(chat, { text: answer });
  await bot.sock.sendPresenceUpdate('paused', chat).catch(() => {});
  console.log(`🤖 → ${answer.slice(0, 80)}`);
}

await connect({
  onMessage: async (msg, bot) => {
    const chat = msg.key.remoteJid;
    if (msg.key.fromMe || isGroup(chat) || isStatus(chat) || isNewsletter(chat)) return;
    const from = senderOf(msg);
    if (!REPLY_ALL && !ALLOWED.includes(from)) return;

    const text = textOf(msg);
    if (!text) return;                         // text only here — see download-media.js for images / voice
    console.log(`📩 ${msg.pushName || from}: ${text}`);
    await bot.sock.readMessages([msg.key]).catch(() => {});   // blue ticks
    collect(chat, text, msg, bot);
  },
});

console.log(`🤖 AI bot running (${MODEL}) — answering ${REPLY_ALL ? 'everyone' : ALLOWED.join(', ')}`);
