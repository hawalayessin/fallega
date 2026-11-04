import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { decodeAudio } from './audio.mjs';

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
  const { stream, done } = decodeAudio(Readable.from([wav]), controller.signal);
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
