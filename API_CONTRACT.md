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

`Track` : `id`, `ownerId`, `title`, `originalName`, `mimeType`, `size`, `createdAt`, `artist` et `album` (`string | null`), `hasCover` (booléen), `coverSource` (`"upload" | "id3" | "web" | null`). Les noms de fichiers sur disque ne sont jamais renvoyés.

`Page<Track>` contient `items`, `page`, `limit`, `total`, `pages`, `hasPrevPage`, `hasNextPage`, `prevPage` et `nextPage` (`number | null`), calculés par `mongoose-aggregate-paginate-v2`. `page` vaut 1 par défaut, `limit` 5 (1 à 20) ; une page hors bornes renvoie `items: []`. Tri : `createdAt` décroissant. `q` (optionnel) filtre les titres contenant ce texte, sans tenir compte de la casse ; il est rogné, traité comme du texte littéral (pas comme une regex) et limité à 100 caractères.

Formats audio acceptés : MP3, WAV, OGG et M4A, 25 Mo maximum. Sans `title`, le titre ID3 puis le nom du fichier servent de repli. Les tags ID3 (`artist`, `album`, image) sont lus à l'upload ; une erreur de lecture ne fait pas échouer l'upload.

Pochettes : JPEG, PNG ou WebP, 2 Mo maximum, type vérifié sur les octets du fichier (pas sur le `Content-Type`). Une pochette envoyée (`cover`) est prioritaire sur l'image ID3 ; la remplacer ou la supprimer efface l'ancien fichier.

`CoverSearch` : `{ query, source, attribution, results: CoverCandidate[] }` avec `CoverCandidate = { id, title, artist, album, imageUrl }`. La recherche interroge l'API iTunes Search (sans clé) avec `artist` + `title` (ou le nom du fichier), uniquement sur action de l'utilisateur. Les pochettes restent la propriété de leurs ayants droit : afficher `attribution`.

`POST /tracks/:id/cover/web` n'accepte que des URL `https` dont l'hôte termine par `.mzstatic.com` (sans port ni identifiants) ; chaque redirection est revalidée (3 maximum), délai 5 s, 2 Mo maximum.

Erreurs courantes : `400` validation (fichier manquant, format refusé, `q` > 100 caractères, image invalide ou trop lourde, URL ou redirection refusée, téléchargement impossible), `401` authentification (y compris routes de pochette), `404` ressource (piste inconnue ou d'autrui : `"Piste inconnue"` ; pochette absente : `"Pochette absente"`), `409` email déjà utilisé, `502` service iTunes indisponible (recherche). Corps d'erreur : `{ "message": "..." }`.
