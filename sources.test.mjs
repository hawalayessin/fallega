import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioUrl } from './sources.mjs';

test('accepte uniquement HTTPS sur les hôtes autorisés', () => {
  assert.equal(audioUrl('https://radio.example/live', ['radio.example']).hostname, 'radio.example');
  for (const url of ['http://radio.example/live', 'https://radio.example.evil.net/', 'https://user@radio.example/', 'https://radio.example:8443/']) {
    assert.throws(() => audioUrl(url, ['radio.example']));
  }
});

test('reconnaît les liens des plateformes et les pièces jointes Discord', () => {
  for (const host of ['youtu.be', 'music.youtube.com', 'open.spotify.com', 'deezer.page.link']) {
    assert.throws(() => audioUrl('https://' + host + '/track', []), /diffusion directe/);
  }
  assert.equal(audioUrl('https://cdn.discordapp.com/attachments/test', []).hostname, 'cdn.discordapp.com');
});
