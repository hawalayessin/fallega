import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { streamYouTube } from './youtube.mjs';

export function decodeAudio(input, signal) {
  const decoder = spawn(ffmpeg.path, [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-vn',
    '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ], { signal, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  decoder.on('error', (error) => decoder.stdout.destroy(error));
  const decoded = new Promise((resolve, reject) => {
    decoder.once('close', (code) => {
      if (code === 0 || signal.aborted) resolve();
      else reject(new Error('FFmpeg ne peut pas décoder cette source audio.'));
    });
  });
  const done = Promise.all([decoded, pipeline(input, decoder.stdin, { signal })]);
  return { stream: decoder.stdout, done };
}

async function fetchAudio(url, controller) {
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, { redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('Source inaccessible (HTTP ' + response.status + ').');
  }
  return Readable.fromWeb(response.body);
}

export async function openAudio(url, controller, metadata, onError) {
  const input = metadata.video
    ? streamYouTube(metadata.video, process.env.YT_DLP_PATH, controller.signal)
    : await fetchAudio(url, controller);
  const { stream, done } = decodeAudio(input, controller.signal);
  done.catch(() => {
    if (!controller.signal.aborted) onError();
  });
  return createAudioResource(stream, { inputType: StreamType.Raw, metadata });
}
