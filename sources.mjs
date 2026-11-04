const platforms = {
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'spotify.com': 'Spotify',
  'deezer.com': 'Deezer',
  'deezer.page.link': 'Deezer',
};

export function audioUrl(input, allowedHosts) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Donne un lien HTTPS valide ou joins un fichier audio.');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Utilise un lien HTTPS sans identifiants ni port personnalisé.');
  }

  for (const [domain, platform] of Object.entries(platforms)) {
    if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
      throw new Error(platform + ' reconnu. La diffusion directe de cette plateforme est indisponible. Joins un fichier audio ou utilise un flux autorisé.');
    }
  }

  const attachment = ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
    && url.pathname.startsWith('/attachments/');
  if (!attachment && !allowedHosts.includes(url.hostname)) {
    throw new Error('Cet hôte audio doit être autorisé dans AUDIO_HOSTS.');
  }
  return url;
}

export async function findSong(query) {
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '10',
    gsrsearch: query + ' filetype:audio',
    prop: 'imageinfo',
    iiprop: 'url|mediatype',
  });

  let pages;
  try {
    const response = await fetch(endpoint, {
      headers: { 'User-Agent': 'Fallega/1.0 (Discord music bot; application 1353872299329060967)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (result.error) throw new Error();
    pages = result.query?.pages ?? [];
  } catch {
    throw new Error('La recherche Wikimedia Commons est momentanément indisponible.');
  }

  const match = pages.sort((a, b) => a.index - b.index)
    .find((page) => page.imageinfo?.[0]?.mediatype === 'AUDIO' && page.imageinfo[0].url);
  if (!match) throw new Error('Aucun audio trouvé sur Wikimedia Commons. Essaie le titre avec le nom de l’artiste, ou joins un fichier.');

  const info = match.imageinfo[0];
  return {
    url: audioUrl(info.url, ['upload.wikimedia.org']),
    label: match.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''),
    source: info.descriptionurl,
  };
}
