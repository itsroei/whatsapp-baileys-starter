/**
 * examples/chat-data.js — shared reader for the files save-chats.js writes. Used by stats.js and export-chat.js.
 * (No WhatsApp connection here — it only reads data/.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../connect.js';

export const CHATS_DIR = path.join(ROOT, 'data', 'chats');

export function loadNames() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'names.json'), 'utf8')); } catch (_) { return {}; }
}

/** All saved chats: [{ chat, name, file, messages: [...sorted by time] }] — name = last pushName in a private chat */
export function loadChats() {
  if (!fs.existsSync(CHATS_DIR)) {
    console.error('No saved chats yet. Run "npm run save-chats" first.');
    process.exit(1);
  }
  return fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.jsonl')).map(f => {
    const messages = [];
    for (const line of fs.readFileSync(path.join(CHATS_DIR, f), 'utf8').split('\n')) {
      try { if (line) messages.push(JSON.parse(line)); } catch (_) {}
    }
    messages.sort((a, b) => a.time.localeCompare(b.time));
    const name = [...messages].reverse().find(m => !m.fromMe && m.name && !m.chat.endsWith('@g.us'))?.name || '';
    return { chat: messages[0]?.chat || f.replace(/\.jsonl$/, ''), name, file: f, messages };
  }).filter(c => c.messages.length);
}

/** A readable name for a chat or a sender. */
export function nameOf(id, names, fallback = '') {
  if (!id) return fallback || '?';
  if (id === 'me') return 'Me';
  return names[id] || names[id + '@s.whatsapp.net'] || fallback || id.split('@')[0];
}
