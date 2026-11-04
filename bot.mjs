import { Client, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AudioPlayerStatus, VoiceConnectionStatus, createAudioPlayer, entersState, joinVoiceChannel } from '@discordjs/voice';
import { audioUrl, findSong } from './sources.mjs';
import { openAudio } from './audio.mjs';
import { findYouTubeAudio, findYouTubePlaylist, youtubePlaylist, youtubeVideo } from './youtube.mjs';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID?.trim();
if (!token || (guildId && !/^\d{17,20}$/.test(guildId))) {
  console.error('Renseigne DISCORD_TOKEN et, si nécessaire, un DISCORD_GUILD_ID valide dans .env.');
  process.exit(1);
}

const allowedHosts = (process.env.AUDIO_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase());
const youtubeExecutable = process.env.YT_DLP_PATH;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const sessions = new Map();
const queueLimit = 25;
const commands = [
  new SlashCommandBuilder().setName('play').setDescription('Joue un titre, une playlist YouTube ou un fichier')
    .addStringOption((option) => option.setName('query').setDescription('Titre, lien audio ou lien YouTube (vidéo ou playlist)').setMaxLength(500))
    .addAttachmentOption((option) => option.setName('fichier').setDescription('Fichier audio à jouer')),
  ...Object.entries({
    join: 'Connecte le bot à ton salon vocal pour tester la connexion',
    queue: 'Affiche le morceau en cours et la file',
    pause: 'Met le morceau en pause',
    resume: 'Reprend la lecture',
    replay: 'Relance le morceau en cours depuis le début',
    skip: 'Passe au morceau suivant',
    stop: 'Vide la file et quitte le salon',
  }).map(([name, description]) => new SlashCommandBuilder().setName(name).setDescription(description)),
];

function close(session) {
  if (sessions.get(session.guildId) !== session) return;
  sessions.delete(session.guildId);
  clearTimeout(session.idleTimer);
  session.current?.controller.abort();
  session.current = undefined;
  session.player.stop(true);
  if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) session.connection.destroy();
}

function notify(track, message) {
  void track.channel?.send({ content: message, allowedMentions: { parse: [] } }).catch(() => {});
}

function finish(session, track, message) {
  if (!track || session.current !== track) return;
  session.current = undefined;
  track.controller.abort();
  session.player.stop(true);
  if (message) notify(track, message);
  void advance(session);
}

async function advance(session) {
  if (sessions.get(session.guildId) !== session || session.current) return;
  clearTimeout(session.idleTimer);
  const track = session.queue.shift();
  if (!track) {
    session.idleTimer = setTimeout(() => close(session), 60000);
    return;
  }

  session.current = track;
  track.controller = new AbortController();
  try {
    await entersState(session.connection, VoiceConnectionStatus.Ready, 15000);
  } catch {
    if (session.current === track) {
      notify(track, 'Connexion au salon vocal impossible. Vérifie les permissions Connexion et Parler.');
      close(session);
    }
    return;
  }
  if (!track || session.current !== track) return;

  try {
    const resource = await openAudio(track.url, track.controller, track, () => {
      finish(session, track, 'Lecture interrompue. Vérifie que la source fournit bien un flux audio.');
    });
    if (session.current === track) session.player.play(resource);
  } catch {
    finish(session, track, 'Impossible de lire cette source. Vérifie le lien ou renvoie le fichier.');
  }
}

function createSession(guild, voiceChannel) {
  const connection = joinVoiceChannel({
    guildId: guild.id,
    channelId: voiceChannel.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  const player = createAudioPlayer();
  const session = { guildId: guild.id, channelId: voiceChannel.id, connection, player, queue: [] };
  sessions.set(guild.id, session);
  connection.subscribe(player);
  connection.on('error', () => {
    if (session.current) notify(session.current, 'Erreur de connexion au salon vocal.');
    close(session);
  });
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 5000);
    } catch {
      close(session);
    }
  });
  player.on(AudioPlayerStatus.Idle, (previous) => finish(session, previous.resource?.metadata));
  player.on('error', (error) => finish(session, error.resource.metadata, 'Erreur de lecture audio.'));
  return session;
}

async function handle(interaction) {
  const guild = interaction.guild;
  let voiceChannel = guild.voiceStates.cache.get(interaction.user.id)?.channel;
  let session = sessions.get(guild.id);
  if (!voiceChannel || (session && session.channelId !== voiceChannel.id)) {
    throw new Error('Rejoins le salon vocal du bot ou un salon vocal pour démarrer.');
  }

  if (interaction.commandName === 'join') {
    if (!voiceChannel.joinable || !voiceChannel.speakable) {
      throw new Error('Le bot doit avoir les permissions Connexion et Parler dans ce salon vocal.');
    }
    await interaction.deferReply();
    voiceChannel = guild.voiceStates.cache.get(interaction.user.id)?.channel;
    session = sessions.get(guild.id);
    if (!voiceChannel || (session && session.channelId !== voiceChannel.id)) {
      throw new Error('Rejoins le salon vocal du bot ou un salon vocal pour démarrer.');
    }
    session ??= createSession(guild, voiceChannel);
    try {
      await entersState(session.connection, VoiceConnectionStatus.Ready, 15000);
    } catch {
      if (!session.current) close(session);
      throw new Error('Connexion vocale impossible. Vérifie les permissions Connexion et Parler dans ce salon.');
    }
    if (!session.current) void advance(session);
    return 'Connecté à ' + voiceChannel.name + '.';
  }

  if (interaction.commandName === 'play') {
    const query = (interaction.options.getString('query') ?? interaction.options.getString('lien'))?.trim();
    const attachment = interaction.options.getAttachment('fichier');
    if (Boolean(query) === Boolean(attachment)) throw new Error('Utilise /play query avec un titre ou un lien, ou choisis un fichier.');
    let track;
    let playlist;
    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(query);
    const isLink = hasScheme || /^(?:www\.|youtu\.be\/|youtube\.com\/|open\.spotify\.com\/|deezer\.com\/)/i.test(query);
    const link = attachment?.url ?? (isLink ? (hasScheme ? query : 'https://' + query) : undefined);
    const video = link && youtubeVideo(link);
    const playlistLink = youtubePlaylist(link);
    if (playlistLink && !youtubeExecutable) throw new Error('La lecture de playlists YouTube nécessite yt-dlp.');
    if (link && !playlistLink && !(video && youtubeExecutable)) {
      const url = audioUrl(link, allowedHosts);
      track = { url, label: attachment?.name ?? url.hostname };
    } else {
      await interaction.deferReply();
      if (playlistLink) {
        playlist = await findYouTubePlaylist(playlistLink, youtubeExecutable, queueLimit);
      } else {
        track = youtubeExecutable
          ? await findYouTubeAudio(video ?? 'ytsearch1:' + query, youtubeExecutable)
          : await findSong(query);
      }
      session = sessions.get(guild.id);
      voiceChannel = guild.voiceStates.cache.get(interaction.user.id)?.channel;
      if (!voiceChannel || (session && session.channelId !== voiceChannel.id)) {
        throw new Error('Rejoins le salon vocal du bot pour lancer ce titre.');
      }
    }
    const available = queueLimit - (session?.queue.length ?? 0);
    if (available <= 0) throw new Error('La file contient déjà 25 morceaux.');
    if (!voiceChannel.joinable || !voiceChannel.speakable) {
      throw new Error('Le bot doit avoir les permissions Connexion et Parler dans ce salon vocal.');
    }
    session ??= createSession(guild, voiceChannel);
    const tracks = (playlist?.tracks ?? [track]).slice(0, available);
    session.queue.push(...tracks.map((item) => ({
      url: item.url, video: item.video, label: item.label.slice(0, 100), channel: interaction.channel,
    })));
    void advance(session);
    if (playlist) {
      return { embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(playlist.label.slice(0, 256))
        .setURL(playlistLink)
        .setDescription(tracks.length + ' morceau(x) ajouté(s) à la file.'
          + (playlist.tracks.length > tracks.length ? '\nLa limite de la file a été atteinte.' : ''))] };
    }
    return 'Ajouté à la file → ' + track.label.slice(0, 100) + (track.source ? '\n<' + track.source + '>' : '');
  }

  if (!session?.current && interaction.commandName !== 'stop') return 'Aucun morceau en cours.';
  if (!session) return 'Le bot est déjà déconnecté.';
  switch (interaction.commandName) {
    case 'queue':
      return { embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('File d’attente')
        .addFields({ name: 'En cours', value: session.current.label })
        .setDescription(session.queue.map((item, i) => (i + 1) + '. ' + item.label).join('\n') || 'Aucun morceau en attente.')
        .setFooter({ text: session.queue.length + ' en attente · /pause · /skip · /stop' })] };
    case 'pause':
      return session.player.pause() ? 'Lecture en pause.' : 'La lecture est déjà en pause ou en cours de chargement.';
    case 'resume':
      return session.player.unpause() ? 'Lecture reprise.' : 'Aucun morceau en pause.';
    case 'replay':
      session.queue.unshift({ ...session.current, channel: interaction.channel });
      finish(session, session.current);
      return 'Le morceau redémarre depuis le début.';
    case 'skip':
      finish(session, session.current);
      return 'Morceau passé.';
    case 'stop':
      close(session);
      return 'File vidée. Le bot a quitté le salon.';
  }
}

client.once(Events.ClientReady, async () => {
  try {
    if (process.env.DISCORD_APPLICATION_ID && client.application.id !== process.env.DISCORD_APPLICATION_ID) {
      throw new Error('Le jeton Discord ne correspond pas à DISCORD_APPLICATION_ID.');
    }
    const guild = guildId ? await client.guilds.fetch(guildId) : undefined;
    const commandManager = guild ? guild.commands : client.application.commands;
    await commandManager.set(commands.map((command) => command.toJSON()));
    console.log(guild ? 'Bot prêt sur ' + guild.name + '.' : 'Bot prêt. Commandes globales enregistrées.');
  } catch (error) {
    console.error('Impossible de publier les commandes Discord.', error.code ?? error.name);
    client.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inGuild() || (guildId && interaction.guildId !== guildId)) return;
  try {
    const result = await handle(interaction);
    const reply = { ...(typeof result === 'string' ? { content: result } : result), allowedMentions: { parse: [] } };
    if (reply.embeds && !interaction.appPermissions?.has(PermissionFlagsBits.EmbedLinks)) {
      const card = reply.embeds[0].toJSON();
      reply.content = [card.title, ...(card.fields ?? []).map((field) => field.name + ' → ' + field.value), card.description]
        .join('\n').slice(0, 1900);
      delete reply.embeds;
    }
    if (interaction.deferred) await interaction.editReply(reply);
    else await interaction.reply(reply);
  } catch (error) {
    const content = error.code ? 'Discord a refusé cette opération.' : error.message;
    const reply = { content, allowedMentions: { parse: [] } };
    if (interaction.deferred) await interaction.editReply(reply).catch(() => {});
    else await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(token).catch((error) => {
  console.error('Connexion Discord refusée.', error.code ?? error.name);
  client.destroy();
  process.exitCode = 1;
});
