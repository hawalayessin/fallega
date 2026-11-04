import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import { setTimeout as wait } from 'node:timers/promises';
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState, NoSubscriberBehavior, StreamType } from '@discordjs/voice';
import * as audio from './audio.mjs';

test('la lecture reprend après un creux dans le flux', { timeout: 3000 }, async () => {
  const input = new PassThrough({ objectMode: true });
  const player = createAudioPlayer({
    behaviors: { ...audio.playbackBehaviors, noSubscriber: NoSubscriberBehavior.Play },
  });
  const packet = Buffer.from([0xf8, 0xff, 0xfe]);
  try {
    player.play(createAudioResource(input, { inputType: StreamType.Opus }));
    input.write(packet);
    await entersState(player, AudioPlayerStatus.Playing, 500);
    await wait(400);
    assert.equal(player.state.status, AudioPlayerStatus.Playing);
    input.end(packet);
    await entersState(player, AudioPlayerStatus.Idle, 1000);
  } finally {
    player.stop(true);
    input.destroy();
  }
});

test('convertit un WAV en paquets Opus pour Discord', { timeout: 10000 }, async () => {
  const samples = 4800;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 48000)), 44 + i * 2);
  }

  const controller = new AbortController();
  const { stream, done } = audio.decodeAudio(Readable.from([wav]), controller.signal);
  const resource = createAudioResource(stream, { inputType: StreamType.Raw });
  const collect = async () => {
    const packets = [];
    for await (const packet of resource.playStream) packets.push(packet);
    return packets;
  };
  try {
    const [, packets] = await Promise.all([done, collect()]);
    assert.equal(packets.length, 5);
    assert.ok(packets.every((packet) => packet.length > 3));
  } finally {
    controller.abort();
  }
});
