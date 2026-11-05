import { execFile, spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const run = promisify(execFile);
const options = [
  '--ffmpeg-location', ffmpeg.path,
  '--ignore-config', '--no-plugin-dirs', '--js-runtimes', 'node', '--no-playlist',
  '--no-warnings', '--socket-timeout', '8', '--retries', '0', '--extractor-retries', '0',
  '-f', 'bestaudio',
];

function sourceError(details) {
  const error = new Error('Le service audio n’a pas fourni de piste accessible.');
  if (/sign in to confirm|not a bot|HTTP Error 429|Too Many Requests/i.test(details)) {
    error.code = 'YOUTUBE_AUTH_REQUIRED';
    error.message = 'YouTube refuse l’accès audio depuis cet hébergement (429 / authentification requise). Relancer /play ne résout pas ce blocage.';
  }
  return error;
}

export function youtubeVideo(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.split('/')[1];
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live)\/([^/]+)\/?$/)?.[1];
  }
  if (/^[\w-]{11}$/.test(id ?? '')) return 'https://www.youtube.com/watch?v=' + id;
}

export function soundCloudTrack(input) {
  if (!URL.canParse(input)) return;
  const url = new URL(input);
  if (url.origin !== 'https://soundcloud.com' || url.username || url.password) return;
  if (/^\/[^/]+\/[^/]+\/?$/.test(url.pathname) && !url.pathname.startsWith('/discover/')) {
    return url.origin + url.pathname;
  }
}

export async function findHostedAudio(input, executable) {
  const track = soundCloudTrack(input);
  const video = youtubeVideo(input);
  let query = input;
  if (video) {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.search = new URLSearchParams({ url: video, format: 'json' });
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error();
      const info = await response.json();
      if (!info.title) throw new Error();
      query = info.title;
    } catch {
      throw new Error('YouTube bloque cet hébergement. Essaie le titre avec l’artiste, ou un lien SoundCloud.');
    }
  }
  const result = await findYouTubeAudio(track ?? 'scsearch1:' + query, executable);
  return { ...result, label: '[SoundCloud] ' + result.label };
}

export function youtubePlaylist(input) {
  if (!input) return;
  const url = URL.canParse(input) && new URL(input);
  if (!url || url.origin !== 'https://' + url.hostname || url.username || url.password
      || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)
      || url.pathname !== '/playlist') return;
  const id = url.searchParams.get('list');
  if (/^[\w-]{10,100}$/.test(id ?? '')) return 'https://www.youtube.com/playlist?list=' + id;
}

export async function findYouTubePlaylist(link, executable, limit) {
  let data;
  try {
    const { stdout } = await run(executable, [
      '--ignore-config', '--no-plugin-dirs', '--yes-playlist', '--flat-playlist',
      '--socket-timeout', '8', '--retries', '0', '--extractor-retries', '0',
      '--playlist-end', String(limit + 1), '--dump-single-json', '--', link,
    ], { timeout: 25000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    data = JSON.parse(stdout);
  } catch {
    throw new Error('Impossible de lire cette playlist YouTube. Vérifie qu’elle est accessible.');
  }
  const tracks = (data.entries ?? []).flatMap((entry) => {
    if (!/^[\w-]{11}$/.test(entry?.id ?? '') || !entry.title
        || ['private', 'premium_only', 'subscriber_only', 'needs_auth'].includes(entry.availability)) return [];
    return [{ video: 'https://www.youtube.com/watch?v=' + entry.id, label: entry.title }];
  });
  if (!tracks.length) throw new Error('Cette playlist ne contient aucun morceau accessible.');
  return { label: data.title ?? 'Playlist YouTube', tracks };
}

export async function findYouTubeAudio(input, executable) {
  let data;
  try {
    const { stdout } = await run(executable, [...options, '--dump-json', '--', input],
      { timeout: 25000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    data = JSON.parse(stdout);
    const video = youtubeVideo(data.webpage_url) ?? soundCloudTrack(data.webpage_url);
    if (video && typeof data.title === 'string') return { video, label: data.title, source: video };
  } catch (error) {
    const failure = sourceError(error.stderr ?? '');
    if (failure.code === 'YOUTUBE_AUTH_REQUIRED') throw failure;
    throw new Error(input.startsWith('scsearch1:') || soundCloudTrack(input)
      ? 'SoundCloud n’a fourni aucune piste accessible. Essaie un titre avec son artiste ou un lien SoundCloud.'
      : 'YouTube bloque cette demande. Essaie un titre avec son artiste ou un lien SoundCloud.');
  }
  throw new Error('YouTube n’a pas fourni de piste audio pour cette demande.');
}

export async function bufferYouTube(video, executable, signal) {
  const directory = await mkdtemp(join(tmpdir(), 'fallega-'));
  const path = join(directory, 'audio');
  const cleanup = () => rm(directory, { recursive: true, force: true, maxRetries: 3 });
  const cancellation = new AbortController();
  const downloadSignal = AbortSignal.any([signal, cancellation.signal, AbortSignal.timeout(90000)]);

  try {
    downloadSignal.throwIfAborted();
    const downloader = spawn(executable, [
      ...options, '--retries', '2', '--quiet', '-o', '-', '--', video,
    ], { signal: downloadSignal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = '';
    downloader.stderr.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-8192);
    });
    const finished = new Promise((resolve, reject) => {
      downloader.once('error', reject);
      downloader.once('close', (code) => {
        if (code === 0) resolve();
        else reject(sourceError(diagnostics));
      });
    });
    let bytes = 0;
    const sizeLimit = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > 100 * 1024 * 1024) callback(new Error('Le morceau dépasse 100 Mo.'));
        else callback(null, chunk);
      },
    });
    const written = pipeline(downloader.stdout, sizeLimit, createWriteStream(path), { signal: downloadSignal });
    try {
      await Promise.all([finished, written]);
    } finally {
      cancellation.abort();
      await Promise.allSettled([finished, written]);
    }
    signal.throwIfAborted();
    if (!bytes) throw new Error('YouTube n’a renvoyé aucun audio.');
    const input = createReadStream(path, { signal });
    input.once('close', () => void cleanup().catch(() => {}));
    return input;
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}
