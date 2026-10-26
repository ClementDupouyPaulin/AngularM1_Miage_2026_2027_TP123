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
| GET | `/clips?page=1&limit=5&q=poursuite&tag=action&visibility=public` | JWT | `Page<ClipSummary>` (mes clips) |
| POST | `/clips` | multipart : `video`, `title` (optionnel), `analysis` (JSON texte v2, v1 acceptée), `filmstrip` (JPEG ≤ 1 Mo, optionnel), `tags` (JSON `string[]`, optionnel), `visibility` (optionnel, défaut `private`) + JWT | `201 Clip` |
| GET | `/clips/stats` | JWT | `200 LibraryStats` |
| GET | `/clips/tags` | JWT | `200 TagCount[]` (mes étiquettes) |
| GET | `/clips/discover?scope=public&sort=recent&q=&tag=&page=1&limit=5` | JWT | `Page<ClipSummary>` (jamais mes clips) |
| GET | `/clips/:id` | JWT | `200 Clip` |
| GET | `/clips/:id/video` | JWT | flux vidéo (`Content-Type` vérifié) |
| GET | `/clips/:id/filmstrip` | JWT | `200` `image/jpeg` |
| PATCH | `/clips/:id` | `ClipPatch` JSON + JWT (propriétaire) | `200 Clip` |
| PUT | `/clips/:id/analysis` | analyse JSON (v2 ou v1) + JWT (propriétaire) | `200 Clip` |
| DELETE | `/clips/:id` | JWT (propriétaire) | `204` (supprime vidéo, pellicule et annotations) |
| POST | `/clips/:id/annotations` | `{time, text}` + JWT (lecteur du clip) | `201 ClipAnnotation` |
| DELETE | `/clips/:id/annotations/:annotationId` | JWT (auteur ou propriétaire) | `204` |
| GET | `/friends` | JWT | `200 FriendsOverview` |
| POST | `/friends/requests` | `{email}` + JWT | `202 {message}` générique |
| POST | `/friends/requests/:id/accept` | JWT (destinataire de la demande) | `200 FriendEntry` |
| DELETE | `/friends/:id` | JWT (l'une ou l'autre partie) | `204` (refuse, annule ou retire) |
| GET | `/activity?limit=20` | JWT | `200 ActivityEvent[]` |

`Track` : `id`, `ownerId`, `title`, `originalName`, `mimeType`, `size`, `createdAt`, `artist` et `album` (`string | null`), `hasCover` (booléen), `coverSource` (`"upload" | "id3" | "web" | null`). Les noms de fichiers sur disque ne sont jamais renvoyés.

`Page<Track>` contient `items`, `page`, `limit`, `total`, `pages`, `hasPrevPage`, `hasNextPage`, `prevPage` et `nextPage` (`number | null`), calculés par `mongoose-aggregate-paginate-v2`. `page` vaut 1 par défaut, `limit` 5 (1 à 20) ; une page hors bornes renvoie `items: []`. Tri : `createdAt` décroissant. `q` (optionnel) filtre les titres contenant ce texte, sans tenir compte de la casse ; il est rogné, traité comme du texte littéral (pas comme une regex) et limité à 100 caractères.

Formats audio acceptés : MP3, WAV, OGG et M4A, 25 Mo maximum. Sans `title`, le titre ID3 puis le nom du fichier servent de repli. Les tags ID3 (`artist`, `album`, image) sont lus à l'upload ; une erreur de lecture ne fait pas échouer l'upload.

Pochettes : JPEG, PNG ou WebP, 2 Mo maximum, type vérifié sur les octets du fichier (pas sur le `Content-Type`). Une pochette envoyée (`cover`) est prioritaire sur l'image ID3 ; la remplacer ou la supprimer efface l'ancien fichier.

`CoverSearch` : `{ query, source, attribution, results: CoverCandidate[] }` avec `CoverCandidate = { id, title, artist, album, imageUrl }`. La recherche interroge l'API iTunes Search (sans clé) avec `artist` + `title` (ou le nom du fichier), uniquement sur action de l'utilisateur. Les pochettes restent la propriété de leurs ayants droit : afficher `attribution`.

`POST /tracks/:id/cover/web` n'accepte que des URL `https` dont l'hôte termine par `.mzstatic.com` (sans port ni identifiants) ; chaque redirection est revalidée (3 maximum), délai 5 s, 2 Mo maximum.

Erreurs courantes : `400` validation (fichier manquant, format refusé, `q` > 100 caractères, image invalide ou trop lourde, URL ou redirection refusée, téléchargement impossible), `401` authentification (y compris routes de pochette), `404` ressource (piste inconnue ou d'autrui : `"Piste inconnue"` ; pochette absente : `"Pochette absente"`), `409` email déjà utilisé, `502` service iTunes indisponible (recherche). Corps d'erreur : `{ "message": "..." }`.

## Film Pulse : `/clips`

Lecture d'un clip (détail, `video`, `filmstrip`, ajout d'annotation) : autorisée au propriétaire, à tous si `visibility` vaut `"public"`, ou si `visibility` vaut `"shared"` ET que le lecteur figure dans `sharedWith` ET que l'amitié acceptée avec le propriétaire existe **au moment de la lecture** (un ex-ami perd l'accès immédiatement). Tout clip illisible répond `404 "Clip inconnu"` (jamais `403`, pour ne pas révéler son existence). Seul le propriétaire modifie (`PATCH`, `PUT analysis`) ou supprime. Les noms de fichiers sur disque (vidéo, pellicule) ne sont jamais renvoyés ; les fichiers restent à plat dans `data/uploads`.

`ClipSummary` : `id`, `title`, `originalName`, `mimeType` (`"video/mp4" | "video/webm"`), `size`, `durationSec`, `cutCount`, `avgShotLength` (secondes), `syncScore` (`number | null`), `createdAt`, `tags` (`string[]`), `visibility` (`"private" | "shared" | "public"`), `owner` (`{id, name}`), `isOwner` (booléen), `hasFilmstrip` (booléen), `sparkline` (24 entiers : nombre de coupes par tranche de durée égale, recalculé à chaque lecture). `Clip` = `ClipSummary` + `analysis` + `annotations` (`ClipAnnotation[]` triées par `time`) + `sharedWith` (`{id, name}[]`, renseigné seulement pour le propriétaire, sinon `[]`). `ClipAnnotation` : `id`, `time`, `text`, `authorId`, `authorName`, `createdAt`.

`analysis` v2 = `{ version: 2, durationSec, fps, cuts, beats, syncScore, diffs, palette, transitions, thumbnailTimes, sensitivity }`, calculée par le navigateur et validée strictement : toutes les clés requises et aucune autre ; `durationSec` dans `]0, 120]` ; `fps` dans `[1, 30]` ; `cuts` et `beats` 2000 nombres finis maximum, triés et compris dans `[0, durationSec]` ; `diffs` 1300 valeurs maximum dans `[0, 1]` ; `palette` 130 couleurs `#rrggbb` maximum (stockées en minuscules) ; `transitions` 2000 objets `{time, kind}` maximum (`kind` : `"cut" | "fade"`), triés par `time` dans `[0, durationSec]` ; `thumbnailTimes` 41 temps maximum, triés dans `[0, durationSec]` ; `sensitivity` dans `[1, 6]` ; `syncScore` nul ou dans `[0, 10]`. L'analyse v1 (`{ version: 1, durationSec, cuts, beats, syncScore }`, mêmes règles) reste acceptée et convertie en v2. Un ancien clip v1 est normalisé à la lecture : `fps` 10, `diffs` `[]`, `palette` `[]`, `transitions` = chaque coupe en `"cut"`, `thumbnailTimes` `[]`, `sensitivity` 3 ; la réponse porte toujours `version: 2`.

`syncScore`, `cutCount` (= nombre de coupes), `avgShotLength` (= `durationSec / (cutCount + 1)`) et `sparkline` sont **toujours recalculés côté serveur** ; `syncScore` reçu est ignoré (fenêtre ±0,08 s, part de coupes proches d'un beat rapportée à la part attendue au hasard, plafonné à 10, `null` sans coupe ou sans beat). `durationSec` est **déclarative** : le serveur ne sonde pas la vidéo (pas de ffprobe), la limite de 120 s est une borne de confiance et la taille de 50 Mo est la vraie limite imposée.

Vidéos acceptées : MP4 ou WebM, 50 Mo maximum ; le `Content-Type` déclaré doit correspondre aux octets du fichier (boîte `ftyp` pour MP4, en-tête EBML `1A 45 DF A3` pour WebM). Pellicule (`filmstrip`, optionnelle) : JPEG de 1 Mo maximum, vérifié sur ses octets (`FF D8 FF`), servi par `GET /clips/:id/filmstrip` en `image/jpeg` avec `X-Content-Type-Options: nosniff`. Sans `title`, le nom du fichier sert de repli (200 caractères maximum). Tout refus après réception supprime la vidéo et la pellicule du disque.

Étiquettes : 5 maximum, chacune rognée et mise en minuscules, 1 à 24 caractères sans caractère de contrôle ; les doublons sont fusionnés. `GET /clips/tags` renvoie `TagCount[]` = `{tag, count}[]` triés par `count` décroissant puis par ordre alphabétique.

`PATCH /clips/:id` accepte `ClipPatch` = `{ title?, tags?, visibility?, sharedWith? }` (aucune autre clé) ; `title` rogné de 1 à 200 caractères. `sharedWith` = tableau d'identifiants d'utilisateurs (doublons fusionnés, 100 maximum) qui remplace la liste ; chacun doit être un ami **accepté** du propriétaire, sinon `400` sans modification. `"shared"` avec une liste vide est accepté (privé de fait). Un clip `"private"` a toujours `sharedWith` vide : passer en privé le vide. `PUT /clips/:id/analysis` remplace toute l'analyse (coupes, transitions, sensibilité, `diffs`…) avec la même validation que l'upload ; `durationSec` doit être celle du clip ; les annotations sont conservées ; corps JSON de 1 Mo maximum.

Annotations : `POST /clips/:id/annotations` avec `{time, text}` (aucune autre clé), `time` dans `[0, durationSec]`, `text` rogné de 1 à 280 caractères, 200 annotations maximum par clip (contrôle atomique : l'ajout est conditionné à la taille du tableau, deux ajouts simultanés ne dépassent pas la limite). Tout lecteur autorisé du clip peut annoter. `DELETE /clips/:id/annotations/:annotationId` est réservé à l'auteur de l'annotation ou au propriétaire du clip.

`LibraryStats` (`GET /clips/stats`, mes clips) : `clipCount`, `totalDurationSec`, `totalCuts`, `avgShotLength` (durée totale / nombre total de plans, `null` sans clip), `mostNervous` (`ClipSummary` au plus petit `avgShotLength`), `mostSynced` (`ClipSummary` au plus grand `syncScore` non nul), `null` sans candidat ; à égalité le plus récent l'emporte ; `byVisibility` = `{private, shared, public}` (un ancien clip sans visibilité compte comme `private`).

`Page<ClipSummary>` suit les mêmes règles que `Page<Track>` (`page`, `limit` 1 à 20, `q` sur le titre, littéral, 100 caractères maximum, tri `createdAt` décroissant). Filtres optionnels : `tag` (une étiquette, comparée en minuscules) et `visibility` (`private`, `shared` ou `public`).

Erreurs : `400` (vidéo manquante, format refusé, octets non conformes, vidéo trop lourde, pellicule invalide ou de plus de 1 Mo, `analysis` manquante ou invalide, durée différente au `PUT`, étiquettes, visibilité, titre, annotation ou filtre invalides, limite de 200 annotations atteinte, champ inattendu, corps JSON invalide), `401` authentification, `403` suppression d'une annotation par un lecteur qui n'en est ni l'auteur ni le propriétaire du clip, `404` `"Clip inconnu"` (inexistant, illisible, identifiant invalide ou fichier vidéo absent du disque), `404` `"Pellicule absente"` (pas de pellicule ou fichier absent), `404` `"Annotation inconnue"`, `413` corps JSON trop volumineux, `500` si la métadonnée est supprimée mais pas un fichier du clip. Corps d'erreur : `{ "message": "..." }`.

## Film Pulse : social (`/friends`, `/clips/discover`, `/activity`)

Toutes ces routes exigent un JWT (`401` sinon). Les identifiants invalides donnent `404`, jamais `500`.

`FriendsOverview` = `{ friends: FriendEntry[], requests: FriendRequest[] }`. `FriendEntry` = `{ friendshipId, user, since }` (amitié acceptée, `since` = date d'acceptation, tri par nom). `FriendRequest` = `{ id, user, direction: "incoming" | "outgoing", createdAt }` (demandes en attente, plus récentes d'abord). `FriendUser` = `{ id, name, email }` : l'e-mail n'est exposé qu'aux deux parties d'une relation, jamais dans les clips, la découverte ou l'activité.

`POST /friends/requests` : corps `{email}` (rogné, mis en minuscules, 254 caractères maximum). Réponse **toujours** `202 {"message":"Si ce compte existe, une invitation a été envoyée."}`, que le compte existe ou non (pas d'énumération des comptes). Erreurs : `400 "E-mail invalide"`, `400` invitation de soi-même, `409` si une relation (acceptée ou en attente, dans un sens ou dans l'autre) existe déjà. Une seule relation par paire d'utilisateurs (index unique sur la paire non ordonnée).

`POST /friends/requests/:id/accept` : réservé au destinataire d'une demande en attente ; `200 FriendEntry` ; sinon `404 "Demande inconnue"` (demandeur, tiers, déjà acceptée, id inconnu ou invalide).

`DELETE /friends/:id` (`id` = `friendshipId` ou `id` d'une demande) : refuse, annule ou retire, par l'une ou l'autre partie ; `204` ; sinon `404 "Relation inconnue"`. Retirer une amitié acceptée retire aussi chaque partie du `sharedWith` des clips de l'autre.

`GET /clips/discover` : jamais mes propres clips, seulement des `ClipSummary` (`isOwner: false`, `owner`, `sparkline`…, sans `sharedWith`). `scope` (défaut `public`) : `public` = clips publics ; `friends` = clips de mes amis acceptés, publics ou partagés avec moi ; `shared` = clips partagés avec moi par un ami accepté. `sort` (défaut `recent`) : `recent` = `createdAt` décroissant ; `nervous` = `avgShotLength` croissant, clips sans coupe exclus ; `synced` = `syncScore` décroissant, clips sans score exclus. `q`, `tag`, `page` et `limit` suivent les règles de `GET /clips` ; `visibility` n'est pas accepté. Erreurs : `400` portée, tri, recherche, étiquette ou filtre invalides.

`GET /activity?limit=20` : `limit` entier de 1 à 50 (défaut 20), sinon `400 "Limite invalide…"`. Renvoie `ActivityEvent[]` = `{ id, type, actor: {id, name}, clipId?, clipTitle?, text?, at }` triés par `at` décroissant, fusion de : `"clip"` (clips récents de mes amis que je peux lire), `"annotation"` (annotations d'autres utilisateurs sur mes clips, avec `text`), `"friend"` (amitiés acceptées me concernant). Aucun clip non autorisé n'y figure.
