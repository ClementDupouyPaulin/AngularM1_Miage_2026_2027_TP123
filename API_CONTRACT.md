# Contrat HTTP - TP1

Base : `/api`. Sauf inscription et connexion, envoyer `Authorization: Bearer <token>`.

Le contrat HTTP ne dépend pas du choix de persistance : le backend fourni utilise Mongoose et MongoDB. MongoDB conserve les utilisateurs et métadonnées ; les octets des fichiers audio restent sur le disque du serveur.

| Méthode | Route | Requête | Réponse principale |
|---|---|---|---|
| GET | `/health` | - | `{ "status": "ok" }` |
| POST | `/auth/register` | `{name,email,password}` | `201 {token,user}` |
| POST | `/auth/login` | `{email,password}` | `200 {token,user}` |
| GET | `/users/me` | JWT | `200 User` |
| PUT | `/users/me` | `{name}` + JWT | `200 User` |
| GET | `/tracks?page=1&limit=5&q=blues` | JWT | `Page<Track>` |
| POST | `/tracks` | multipart : `audio`, `title`, `cover` (optionnel) + JWT | `201 Track` |
| GET | `/tracks/:id/audio` | JWT | flux audio |
| DELETE | `/tracks/:id` | JWT | `204` (bonus, supprime aussi la pochette) |
| GET | `/tracks/:id/cover` | JWT | `200` image (`Content-Type` réel) |
| PUT | `/tracks/:id/cover` | multipart : `cover` + JWT | `200 Track` (`coverSource: "upload"`) |
| DELETE | `/tracks/:id/cover` | JWT | `204` |
| GET | `/tracks/:id/cover/search` | JWT | `200 CoverSearch` |
| POST | `/tracks/:id/cover/web` | `{ "imageUrl": "https://…" }` + JWT | `200 Track` (`coverSource: "web"`) |
| GET | `/clips?page=1&limit=5&q=poursuite` | JWT | `Page<ClipSummary>` |
| POST | `/clips` | multipart : `video`, `title` (optionnel), `analysis` (JSON texte) + JWT | `201 Clip` |
| GET | `/clips/:id` | JWT | `200 Clip` |
| GET | `/clips/:id/video` | JWT | flux vidéo (`Content-Type` vérifié) |
| DELETE | `/clips/:id` | JWT | `204` (supprime aussi le fichier vidéo) |

`Track` : `id`, `ownerId`, `title`, `originalName`, `mimeType`, `size`, `createdAt`, `artist` et `album` (`string | null`), `hasCover` (booléen), `coverSource` (`"upload" | "id3" | "web" | null`). Les noms de fichiers sur disque ne sont jamais renvoyés.

`Page<Track>` contient `items`, `page`, `limit`, `total`, `pages`, `hasPrevPage`, `hasNextPage`, `prevPage` et `nextPage` (`number | null`), calculés par `mongoose-aggregate-paginate-v2`. `page` vaut 1 par défaut, `limit` 5 (1 à 20) ; une page hors bornes renvoie `items: []`. Tri : `createdAt` décroissant. `q` (optionnel) filtre les titres contenant ce texte, sans tenir compte de la casse ; il est rogné, traité comme du texte littéral (pas comme une regex) et limité à 100 caractères.

Formats audio acceptés : MP3, WAV, OGG et M4A, 25 Mo maximum. Sans `title`, le titre ID3 puis le nom du fichier servent de repli. Les tags ID3 (`artist`, `album`, image) sont lus à l'upload ; une erreur de lecture ne fait pas échouer l'upload.

Pochettes : JPEG, PNG ou WebP, 2 Mo maximum, type vérifié sur les octets du fichier (pas sur le `Content-Type`). Une pochette envoyée (`cover`) est prioritaire sur l'image ID3 ; la remplacer ou la supprimer efface l'ancien fichier.

`CoverSearch` : `{ query, source, attribution, results: CoverCandidate[] }` avec `CoverCandidate = { id, title, artist, album, imageUrl }`. La recherche interroge l'API iTunes Search (sans clé) avec `artist` + `title` (ou le nom du fichier), uniquement sur action de l'utilisateur. Les pochettes restent la propriété de leurs ayants droit : afficher `attribution`.

`POST /tracks/:id/cover/web` n'accepte que des URL `https` dont l'hôte termine par `.mzstatic.com` (sans port ni identifiants) ; chaque redirection est revalidée (3 maximum), délai 5 s, 2 Mo maximum.

Erreurs courantes : `400` validation (fichier manquant, format refusé, `q` > 100 caractères, image invalide ou trop lourde, URL ou redirection refusée, téléchargement impossible), `401` authentification (y compris routes de pochette), `404` ressource (piste inconnue ou d'autrui : `"Piste inconnue"` ; pochette absente : `"Pochette absente"`), `409` email déjà utilisé, `502` service iTunes indisponible (recherche). Corps d'erreur : `{ "message": "..." }`.

## Film Pulse : `/clips`

`ClipSummary` : `id`, `title`, `originalName`, `mimeType` (`"video/mp4" | "video/webm"`), `size`, `durationSec`, `cutCount`, `avgShotLength` (secondes), `syncScore` (`number | null`), `createdAt`. `Clip` = `ClipSummary` + `analysis`. Les noms de fichiers sur disque ne sont jamais renvoyés.

`analysis` = `{ "version": 1, "durationSec": number, "cuts": number[], "beats": number[], "syncScore": number | null }`, calculée par le navigateur et validée strictement par le serveur : aucun autre champ, `version` égale à 1, `durationSec` dans `]0, 120]`, `cuts` et `beats` tableaux de 2000 nombres finis maximum, triés par ordre croissant et compris dans `[0, durationSec]`, `syncScore` nul ou nombre fini dans `[0, 10]` (accepté pour la compatibilité du contrat, mais **ignoré** : le serveur le recalcule à partir de `cuts`, `beats` et `durationSec`, fenêtre ±0,08 s, part de coupes proches d'un beat rapportée à la part attendue au hasard, plafonné à 10, `null` sans coupe, sans beat ou si la durée est nulle ; la valeur stockée et renvoyée est celle du serveur). `durationSec` est **déclarative** : le serveur ne sonde pas la vidéo (pas de ffprobe), la limite de 120 s est une borne de confiance et la taille de 50 Mo est la vraie limite imposée. `cutCount` (= nombre de coupes) et `avgShotLength` (= `durationSec / (cutCount + 1)`) sont **recalculés côté serveur** ; ils ne sont pas acceptés dans `analysis`.

Vidéos acceptées : MP4 ou WebM, 50 Mo maximum ; le `Content-Type` déclaré doit correspondre aux octets du fichier (boîte `ftyp` pour MP4, en-tête EBML `1A 45 DF A3` pour WebM). Sans `title`, le nom du fichier sert de repli (200 caractères maximum). Tout refus après réception supprime le fichier du disque.

`Page<ClipSummary>` suit les mêmes règles que `Page<Track>` (`page`, `limit` 1 à 20, `q` sur le titre, littéral, 100 caractères maximum, tri `createdAt` décroissant).

Erreurs : `400` (vidéo manquante, format refusé, octets non conformes, vidéo trop lourde, `analysis` manquante ou invalide, `q` > 100 caractères), `401` authentification, `404` `"Clip inconnu"` (inexistant, d'autrui, identifiant invalide ou fichier vidéo absent du disque), `500` si la métadonnée est supprimée mais pas le fichier vidéo. Corps d'erreur : `{ "message": "..." }`.
