# fallega — bot musical Discord

## Installation sur Windows

1. Utilise Node.js 22.12 ou plus récent. FFmpeg est fourni avec les dépendances.
2. Ouvre [le bot fallega dans le portail Discord](https://discord.com/developers/applications/1353872299329060967/bot). Utilise le jeton de cette application. Au démarrage, le bot remplace ses commandes dans le serveur configuré.
3. Sous **Installation**, configure **Guild Install** avec les scopes bot et applications.commands. Invite le bot dans ton serveur avec les permissions Voir le salon, Envoyer des messages, Connexion et Parler.
4. Dans Discord, active **Paramètres utilisateur → Avancés → Mode développeur**. Clique droit sur ton serveur pour copier son identifiant.
5. Ouvre PowerShell dans le dossier extrait et lance ces commandes.

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
```

Renseigne DISCORD_TOKEN et DISCORD_GUILD_ID dans .env. Garde ton jeton sur ton PC.

```powershell
npm test
npm start
```

Attends le message « Bot prêt ». Rejoins un salon vocal standard et lance **/play query:** avec un titre ou un lien. Laisse PowerShell ouvert pendant l'utilisation.

## Commandes

- **/play query:** accepte un lien HTTPS direct autorisé ou un titre et un artiste. Avec yt-dlp, cette option accepte aussi un lien YouTube et cherche les titres sur YouTube. Sans yt-dlp, la recherche utilise Wikimedia Commons.
- **/join** connecte le bot à ton salon vocal pour tester la connexion sans lancer de morceau.
- **/queue** affiche la file. **/pause** et **/resume** contrôlent la lecture.
- **/skip** passe au morceau suivant. **/stop** vide la file et déconnecte le bot.

Le bot quitte le salon après une minute d'inactivité.

## Sources et code

Pour un flux direct autorisé, ajoute son hôte exact à AUDIO_HOSTS dans .env, puis redémarre. Par exemple, AUDIO_HOSTS=radio.example pour https://radio.example/live.mp3. Pour plusieurs hôtes, sépare-les par des virgules. Le lien doit pointer directement vers le flux, sans redirection ni liste de lecture.

Pour activer YouTube, installe yt-dlp depuis ses publications officielles et indique le chemin de son exécutable dans YT_DLP_PATH dans .env. Redémarre le bot après cette modification. Utilise des pistes que tu peux diffuser. La lecture de certains liens peut être bloquée par YouTube. Les liens Spotify et Deezer sont reconnus et leur lecture directe reste indisponible.

bot.mjs gère les commandes et la file. sources.mjs valide les liens. audio.mjs décode les flux pour Discord. Les tests vérifient les liens et la conversion d'un WAV en paquets Opus.



Pour ajouter une playlist YouTube, utilise son lien de partage youtube.com/playlist?list=… dans /play query. La file accepte jusqu’à 25 morceaux en attente. Un lien de vidéo ajoute cette vidéo seule.

## Commandes et invitation publique

**/replay** relance le morceau en cours depuis le début.

[Ajouter Fallega à un serveur](https://discord.com/oauth2/authorize?client_id=1353872299329060967). Chaque serveur dispose de sa propre file et de sa propre connexion vocale.

Pour héberger ta propre instance, crée une application Discord et configure son jeton dans DISCORD_TOKEN. Laisse DISCORD_GUILD_ID vide pour publier les commandes globalement. Renseigne cet identifiant pour limiter les commandes à un serveur de test. DISCORD_APPLICATION_ID est facultatif et permet de vérifier que le jeton correspond à ton application.

Pour garder le bot en ligne, lance npm start sur une machine qui maintient le processus Node.js actif et autorise les connexions vocales sortantes de Discord.
Sur un hébergement bloqué par YouTube, SEARCH_SOURCE=soundcloud active la recherche SoundCloud par titre. Les liens YouTube servent alors à récupérer le titre et chercher une autre version sur SoundCloud. Le résultat est explicitement marqué SoundCloud et peut différer de la vidéo originale. Les liens SoundCloud sont aussi acceptés directement.
Session YouTube facultative pour un test authentifié. YOUTUBE_COOKIES accepte le contenu Netscape des cookies youtube.com uniquement. Configure cette valeur comme secret sur votre hébergeur. Chaque commande écrit un fichier temporaire privé, supprimé après son exécution. La session ne garantit pas de lever les restrictions YouTube.
