/**
 * examples/download-media.js — automatically save every photo, video, voice note, sticker and document you receive.
 *
 * Run: npm run media
 *
 * Output: data/media/<type>/<date>_<chat>_<id>.<ext>
 *   e.g. data/media/image/2026-10-30_972501234567_3EB0A1B2.jpeg
 *
 * Set MEDIA_INCLUDE_MINE=1 in .env to also save what YOU send.
 */

import fs from 'node:fs';
import path from 'node:path';
import { connect, ROOT, unwrap, typeOf, chatIdOf, timeOf, isStatus } from '../connect.js';

const OUT = path.join(ROOT, 'data', 'media');
const INCLUDE_MINE = process.env.MEDIA_INCLUDE_MINE === '1';

// message type → folder name
const MEDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',          // voice notes (ptt) + audio files
  stickerMessage: 'sticker',
  documentMessage: 'document',
};

function extOf(media) {
  if (media.fileName && path.extname(media.fileName)) return path.extname(media.fileName).slice(1);
  // "audio/ogg; codecs=opus" → "ogg", "image/jpeg" → "jpeg"
  return (media.mimetype || 'application/bin').split(';')[0].split('/')[1] || 'bin';
}

await connect({
  onMessage: async (msg, bot) => {
    const type = typeOf(msg);
    const folder = MEDIA[type];
    if (!folder) return;
    if (msg.key.fromMe && !INCLUDE_MINE) return;
    if (isStatus(msg.key.remoteJid)) return;          // remove this line to save people's statuses too

    const media = unwrap(msg.message)[type];
    const chat = chatIdOf(msg).split('@')[0];
    const date = timeOf(msg).toISOString().slice(0, 10);
    const file = path.join(OUT, folder, `${date}_${chat}_${msg.key.id}.${extOf(media)}`);

    try {
      const buf = await bot.download(msg);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      console.log(`⬇️  ${folder} from ${msg.pushName || chat} → ${path.relative(ROOT, file)} (${Math.round(buf.length / 1024)} KB)`);
    } catch (e) {
      console.error(`download failed (${folder} from ${chat}):`, e.message);
    }
  },
});

console.log(`Saving media to ${path.relative(process.cwd(), OUT)} — Ctrl+C to stop.`);
