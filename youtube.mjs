import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const options = [
  '--ignore-config', '--no-plugin-dirs', '--js-runtimes', 'node', '--no-playlist',
  '--no-warnings', '--socket-timeout', '8', '--retries', '0', '--extractor-retries', '0',
  '-f', 'bestaudio[protocol=https]',
];

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
    const video = youtubeVideo(data.webpage_url);
    if (video && typeof data.title === 'string') return { video, label: data.title, source: video };
  } catch {
    throw new Error('YouTube n’a pas fourni de piste audio pour cette demande.');
  }
  throw new Error('YouTube n’a pas fourni de piste audio pour cette demande.');
}

export function streamYouTube(video, executable, signal) {
  const downloader = spawn(executable, [...options, '--quiet', '-o', '-', '--', video],
    { signal, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  downloader.on('error', (error) => {
    if (!signal.aborted) downloader.stdout.destroy(error);
  });
  downloader.once('close', (code) => {
    if (code !== 0 && !signal.aborted) downloader.stdout.destroy(new Error('Flux YouTube indisponible.'));
  });
  return downloader.stdout;
}
