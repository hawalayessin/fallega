import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function withYouTubeSession(input, action) {
  const cookies = process.env.YOUTUBE_COOKIES;
  const youtube = input.startsWith('ytsearch') || /^https:\/\/(?:www\.)?youtube\.com\//.test(input);
  if (!cookies || !youtube) return action([]);

  if (Buffer.byteLength(cookies) > 1024 * 1024 || !/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/.test(cookies)) {
    throw new Error('YOUTUBE_COOKIES doit contenir un fichier de cookies Netscape valide.');
  }
  const lines = cookies.split(/\r?\n/).filter((line) => line && (!line.startsWith('#') || line.startsWith('#HttpOnly_')));
  if (!lines.length || lines.some((line) => {
    const fields = line.replace(/^#HttpOnly_/, '').split('\t');
    return fields.length !== 7 || !/^\.?youtube\.com$/.test(fields[0]);
  })) {
    throw new Error('YOUTUBE_COOKIES doit contenir uniquement les cookies du domaine youtube.com.');
  }

  const directory = await mkdtemp(join(tmpdir(), 'fallega-session-'));
  try {
    const path = join(directory, 'cookies.txt');
    await writeFile(path, cookies, { mode: 0o600 });
    return await action(['--cookies', path]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}
