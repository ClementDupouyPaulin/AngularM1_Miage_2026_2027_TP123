# Bonus TP2 — Étude : tags ID3 et services Web publics

Consigne de la section « AVANCÉ — Image de couverture » de
`SUJET_ETUDIANT_TP2.md` : *« Cherchez ce que proposent les tags ID3 et quels web
services publics peuvent être utilisés pour effectuer cette tâche »*, en
« respectant les règles de sécurité, d'accessibilité et de droits d'utilisation
des images ».

Ce document est l'**étude** (ce qui existe, ce qu'on a choisi, pourquoi) et la
partie **droits et sécurité**. L'interface des pochettes dans le navigateur est
décrite dans [`pochettes.md`](./pochettes.md) ; les défauts trouvés à la relecture
dans [`relecture-independante.md`](./relecture-independante.md).

Chemins backend relatifs à la racine du dépôt.

## Ce qui a été observé, et ce qui ne l'a pas été

| Source | Statut dans ce document |
|---|---|
| Lecture réelle des tags d'un fichier de test, recherche et téléchargement **réels** sur iTunes | **observé** (exécuté par l'orchestrateur, voir [`preuves-integration-reelle.md`](./preuves-integration-reelle.md)) |
| Formats ID3 (identifiants de trames, structure) | **documentation officielle lue** pendant la rédaction (`id3.org`, versions 2.3.0 et 2.4.0), non testée au-delà des fichiers du projet |
| MusicBrainz, Cover Art Archive, Last.fm, Spotify, Apple (limites et conditions) | **documentation officielle lue** pendant la rédaction, **jamais appelés** par ce projet |
| Deezer | **non vérifié dans cette session** (les pages consultées n'indiquent ni authentification ni limites) |

---

## 1. Les modifications de données et d'API à identifier

Le sujet demande d'identifier ces changements « avant toute implémentation ».
Résultat, tel qu'il figure dans le code livré :

| Domaine | Modification | Où |
|---|---|---|
| Données | champs `artist` et `album` (texte, 200 caractères max) | `backend/src/models/Track.js:25-26`, `TAG_MAX_LENGTH` ligne 4 |
| Données | trois champs de pochette : `coverStoredName` (**jamais exposé**, `select: false`), `coverMimeType`, `coverSource` (`upload` / `id3` / `web`) | `Track.js:27-30` |
| Données | fichiers de pochette stockés **sur le disque**, dans un sous-dossier, comme l'audio ; MongoDB ne garde que les métadonnées | `backend/src/app.js:17` (`COVERS`) |
| API | `POST /tracks` accepte un champ optionnel `cover` | `API_CONTRACT.md:15` |
| API | cinq routes : `GET` / `PUT` / `DELETE /tracks/:id/cover`, `GET …/cover/search`, `POST …/cover/web` | `API_CONTRACT.md:18-22` |
| API | un `Track` expose `artist`, `album`, `hasCover`, `coverSource` ; jamais un nom de fichier | `Track.js:45-59`, `API_CONTRACT.md:24` |

---

## 2. Les tags ID3

### Ce que c'est

ID3 est un format de **métadonnées embarquées dans le fichier audio lui-même**
(surtout les MP3). Dans sa version 2, la spécification décrit deux éléments : un
**en-tête de 10 octets** qui identifie le tag, sa version et sa taille, puis des
**trames** (*frames*), chacune précédée d'un identifiant de quatre caractères et
d'une taille (spécification ID3v2.3.0, lue sur `id3.org`).

### Les trames utiles pour ce projet

| Information | Trame | Source |
|---|---|---|
| Titre | `TIT2` | ID3v2.3.0 et 2.4.0 |
| Artiste principal | `TPE1` | ID3v2.3.0 et 2.4.0 |
| Album | `TALB` | ID3v2.3.0 et 2.4.0 |
| **Image attachée** (la pochette) | `APIC` | ID3v2.3.0 et 2.4.0 |

La trame `APIC` contient, dans l'ordre : un octet d'**encodage du texte**, le
**type MIME** de l'image (par exemple `image/jpeg`), un octet de **type d'image**
(`$03` désigne la « pochette avant », *Cover (front)*), une **description**, puis
les **octets de l'image** (spécification ID3v2.4.0, lue sur `id3.org`).

Le test du projet construit à la main un MP3 portant exactement ces trames, en
version **ID3v2.3** (octets de version `3, 0, 0`, `backend/test/tracks.test.js:42-67`) :
c'est ce qui permet de tester la lecture des tags sans dépendre d'un fichier
externe.

### Pourquoi on ne peut pas leur faire confiance

Les tags sont écrits par n'importe quel logiciel, ou à la main. Il faut donc
prévoir qu'ils soient :

- **absents** : un fichier peut n'avoir aucun tag, ou aucune image ;
- **faux ou incohérents** : un titre ou un artiste mal orthographié, une image qui
  ne correspond pas au morceau ;
- **invalides** : un tag corrompu, ou une image dont le contenu n'est pas une
  image (voir `CORRUPT_ID3`, `tracks.test.js:36-38`) ;
- **volumineux** : rien dans le format ne borne la taille de l'image.

C'est pourquoi le backend traite les tags comme une **entrée externe non fiable**
(règle de sécurité du cours : valider les entrées aux frontières).

---

## 3. `music-metadata` : lecture des tags côté serveur

| | |
|---|---|
| Paquet | `music-metadata` |
| Déclaration | `backend/package.json:18` (`"^11.16.1"`) |
| Version installée | 11.16.1 (`node_modules/music-metadata/package.json`) |
| Licence | MIT (même fichier, champ `license`) |
| Dernière version | le registre npm indique `latest` = `11.16.1` (consulté pendant la rédaction) |
| Date de publication | **septembre 2026**, d'après l'orchestrateur ; **non recoupée** dans cette session (le registre consulté n'a pas fourni la date) |
| Raison | lire les tags ID3 (et autres formats) sans écrire un analyseur binaire |

### Comment le code s'en sert

`backend/src/app.js:136-154` (`readAudioTags`) :

```js
const { common } = await parseFile(filePath, { duration: false });
const picture = selectCover(common.picture);
return { title: cleanTag(common.title), artist: cleanTag(common.artist),
         album: cleanTag(common.album), picture: picture ? Buffer.from(picture.data) : null };
```

- `parseFile` lit le fichier déjà écrit sur le disque ; `duration: false` demande
  de ne pas calculer la durée, dont on n'a pas besoin ici.
- `selectCover` choisit l'image de couverture parmi celles du fichier.
- `cleanTag` (`:131-134`) rogne les espaces, plafonne à 200 caractères
  (`TAG_MAX_LENGTH`) et renvoie `undefined` pour une valeur vide ou non textuelle.

### « Lecture non bloquante » : deux sens à ne pas confondre

1. **Elle n'empêche jamais l'upload d'aboutir.** Tout le corps est dans un
   `try/catch` : en cas d'erreur, elle est journalisée et la fonction renvoie `{}`
   (`app.js:150-153`) — aucun tag n'est retenu, et l'upload continue. Test
   « tags ID3 illisibles : l'upload réussit quand même » (`tracks.test.js:319`) :
   `201`, titre = nom du fichier, `artist` et `album` nuls, aucune pochette.
2. **Elle est asynchrone** : `await parseFile(…)` ne bloque pas la boucle
   d'événements de Node pendant la lecture du disque.

### L'ordre de priorité des sources

`backend/src/app.js:625-634` :

| Information | Priorité (de la plus forte à la plus faible) |
|---|---|
| **Titre** | champ `title` du formulaire → titre ID3 → nom du fichier (`req.body.title \|\| tags.title \|\| audioFile.originalname`, `:634`) |
| **Pochette** | image envoyée avec la piste (`cover`) → image embarquée dans les tags ID3 (`cover ??= await storeId3Cover(tags.picture)`, `:630`) → aucune |

Le test « pochette fournie à l'upload : prioritaire sur l'image ID3 »
(`tracks.test.js:331`) verrouille la seconde règle, et « upload sans titre : le
titre ID3 sert de repli » (`:313`) la première.

### L'image ID3 est validée comme n'importe quelle image

`storeId3Cover` (`app.js:156-166`) transmet l'image à `storeCover`
(`:105-116`), qui vérifie la **taille** (2 Mo) et la **nature** par les octets
magiques (`detectImageType`, `:92-102`), pas par le type MIME déclaré dans le tag.
Une image invalide est **ignorée** avec un avertissement, sans faire échouer
l'upload.

> **Point à connaître, déduit de l'ordre du code** : `readAudioTags` copie
> l'image en mémoire (`Buffer.from(picture.data)`, `:148`) **avant** que
> `storeCover` n'en vérifie la taille. Une image embarquée très volumineuse est
> donc lue en mémoire avant d'être refusée ; le seul garde-fou en amont est la
> limite de 25 Mo du fichier audio. Ce n'est pas un défaut observé, c'est une
> propriété de l'ordre des opérations.

### Observé en réel

Lecture réelle des tags de `song4` (`frontend-starter/fichiers-audio-de-test/`) :
`artist` « Kevin MacLeod », `album` « Royalty Free », pochette embarquée extraite
(`hasCover` vrai, `coverSource` « id3 »), aucun nom de fichier exposé. **On ne sait
pas** si les autres fichiers de test portent des tags : cela n'a pas été relevé.

---

## 4. Les services Web publics de pochettes

### Le tableau comparatif

| Service | Clé / inscription | Limites annoncées | Particularités | Statut ici |
|---|---|---|---|---|
| **iTunes Search API** (Apple) — **retenu** | aucune clé | « environ 20 appels par minute (susceptible de changer) » | paramètres `term`, `media`, `entity`, `limit` ; champ `artworkUrl100` (image 100×100, présent seulement si disponible) ; conditions d'utilisation d'Apple | **observé en réel** (12 candidats, téléchargement réel) |
| **MusicBrainz** + **Cover Art Archive** | aucune clé mentionnée | MusicBrainz : 1 requête par seconde en moyenne par IP (503 au-delà) ; Cover Art Archive : « aucune règle de limitation » actuellement | MusicBrainz **exige** un en-tête `User-Agent` permettant de contacter l'auteur de l'application ; en 2 temps : chercher l'identifiant (MBID) de la sortie, puis `/release/{mbid}/front` (redirection 307 vers l'image) ; la page lue ne précise pas la licence des images | documentation lue, **jamais appelé** |
| **Last.fm** | **clé d'API obligatoire** (`api_key` requis pour `album.getInfo`) | usage « raisonnable » ; compte suspendu en cas d'appels excessifs | `User-Agent` identifiable demandé ; contact obligatoire pour un usage commercial ; images en trois tailles (« small », « medium », « large », sans dimensions précisées) | documentation lue, **jamais appelé** |
| **Spotify** | **inscription de l'application** : identifiant client + **secret client** à garder côté serveur (flux « client credentials ») | non relevées | donne accès aux ressources sans données utilisateur ; nécessite un secret dans le backend | documentation lue, **jamais appelé** |
| **Deezer** | **non vérifié dans cette session** | **non vérifié** | les pages consultées n'indiquent qu'une connexion pour accepter les conditions de l'API simple | **non vérifié** |

Les informations de ce tableau proviennent des pages de documentation officielles
de chaque service, lues pendant la rédaction (résumées par l'outil de lecture, donc
à relire sur la source avant toute décision). Elles peuvent évoluer ; les limites
d'Apple sont elles-mêmes annoncées « susceptibles de changer ».

### Pourquoi iTunes Search a été retenu

1. **Aucune clé.** Il n'y a donc aucun secret supplémentaire à stocker, à faire
   passer dans un `.env` ou à risquer de coller dans un prompt (règles de
   sécurité du TP1). Last.fm et Spotify auraient ajouté un secret au backend.
2. **Un seul appel** donne à la fois les candidats et l'URL de leur image.
   MusicBrainz + Cover Art Archive en demandent deux, et un `User-Agent`
   conforme.
3. **Hôtes d'images prévisibles** : les pochettes sont servies depuis
   `*.mzstatic.com`, ce qui permet une **liste blanche** simple (voir §5).
4. **Résolution supérieure par réécriture d'URL** : le backend remplace
   `100x100bb` par `600x600bb` dans l'URL de l'image
   (`backend/src/app.js:264`) ; le téléchargement réel d'une image obtenue ainsi
   a été validé.

### Ses inconvénients, à connaître

- **Limite d'environ 20 appels par minute**, et **le backend n'en applique aucune
  de son côté** (aucun mécanisme de limitation de débit dans `backend/src/app.js` :
  recherche négative). Un utilisateur qui multiplierait les recherches pourrait
  atteindre la limite d'Apple ; le serveur répondrait alors `502`
  (`app.js:820-822`) — comportement testé par simulation (`tracks.test.js:614`),
  jamais provoqué en réel.
- **La recherche est textuelle** : le terme est « artiste + titre », ou le nom du
  fichier à défaut (`app.js:810-813`). Elle renvoie des **morceaux** (`entity:
  "song"`, `app.js:281`) et peut proposer des candidats qui ne correspondent pas ;
  c'est pourquoi l'utilisateur **choisit** parmi les résultats au lieu de
  l'application qui décide.
- **Couverture du catalogue** : elle n'a pas été évaluée. Rien ne garantit que
  tout morceau (indépendant, libre de droits…) y soit présent.
- **Dépendance à un tiers** : le service peut être indisponible ou changer ; d'où
  le `502` explicite (`app.js:817-823`) et la possibilité d'importer sa propre
  image à la place.

---

## 5. Droits d'utilisation et sécurité

### Droits d'usage des images

- **Les pochettes appartiennent à leurs ayants droit.** Les résultats d'iTunes ne
  sont pas libres de droits.
- **Usage restreint** : une pochette n'est affichée que dans **la bibliothèque
  privée de l'utilisateur** qui l'a choisie. Elle n'est **jamais redistribuée** :
  la route de lecture est protégée par JWT et filtrée par propriétaire
  (`GET /tracks/:id/cover`, `backend/src/app.js:734`).
- **Attribution** : la réponse de recherche contient un champ `attribution`
  (`app.js:826-831`, texte `COVER_ATTRIBUTION`, `:68-69`) rappelant que les
  pochettes proviennent de l'API iTunes Search et « restent la propriété de leurs
  ayants droit ». `API_CONTRACT.md` demande de l'afficher. *(Son affichage dans
  l'interface relève du lot de documentation sur l'interface des pochettes.)*
- **Recherche déclenchée uniquement sur action explicite.** Le contrat le dit
  (« uniquement sur action de l'utilisateur », `API_CONTRACT.md:32`). Côté
  frontend, au moment de la relecture, l'appel `searchCover` n'est atteint que par
  un clic sur un bouton (`tracks-page.html:314` → `tracks-page.ts:881`, puis
  `cover-search-dialog.ts:69`). **Jamais de recherche automatique à l'upload**.
- **Pochette que l'utilisateur envoie lui-même** : il lui appartient de s'assurer
  de ses droits ; le serveur ne peut pas le vérifier.

### Décision ouverte : copier l'image sur notre serveur, ou ne garder que l'URL ?

> **Cette décision n'est pas tranchée.** Ce document la **pose**.

**Le constat.** La page de conditions d'utilisation de l'API de recherche d'Apple,
lue pendant la rédaction, mentionne que certains contenus (les extraits audio,
d'après le résumé obtenu) doivent être *diffusés sans être téléchargés ni mis en
cache*. Notre backend, lui, **télécharge puis conserve une copie** de l'image
choisie dans `data/uploads/covers` (`POST /tracks/:id/cover/web`,
`backend/src/app.js:839`, `storeCover()` `:105`). La page lue parle des extraits
promotionnels et le résumé obtenu ne permet pas de dire si la règle couvre aussi les
pochettes : **ce point n'est pas résolu par ce document**, et ce résumé est lui-même
de seconde main (à relire sur la source).

**Ce qui est distinct dans notre application** :

| Usage | Comment | Question posée |
|---|---|---|
| **Miniatures de la recherche** | affichées par le navigateur depuis `*.mzstatic.com` (`cover-search-dialog.html:39-46`), sans copie chez nous | proche d'un simple affichage |
| **Pochette retenue par l'utilisateur** | le backend la télécharge puis la **conserve** | c'est cette **copie persistante** qui fait question |

**Option réversible à envisager : ne pas enregistrer l'image, seulement l'URL.**

| | Copie locale (actuel) | URL seule (option) |
|---|---|---|
| Conformité aux conditions d'Apple | à établir | plus proche d'un simple affichage |
| Dépendance à `mzstatic.com` | aucune une fois la copie faite | **oui** : l'image disparaît si l'URL expire ou change |
| Affichage hors ligne / si Apple est indisponible | fonctionne | **cassé** |
| Sécurité (SSRF, taille, octets magiques) | validée côté serveur avant stockage | l'URL doit rester **validée** (liste blanche) ; le navigateur chargerait directement l'image : l'IP de l'utilisateur est exposée à chaque affichage, pas seulement à la recherche |
| Cohérence avec les autres sources | uniforme (upload, ID3, Web = fichier local) | **hétérogène** : une pochette serait un fichier, une autre une URL |
| Effort | nul | modèle de données (`coverUrl`), route, interface, tests |

L'option est **réversible** : on peut l'adopter plus tard sans perdre les pochettes
déjà copiées (elles resteraient valables). Elle n'est **pas implémentée**.

### Sécurité : la liste blanche d'hôtes (anti-SSRF)

Une **SSRF** (*Server-Side Request Forgery*) consiste à faire exécuter une
requête **par le serveur** vers une cible choisie par l'attaquant : un service
interne (`localhost`), les métadonnées d'un fournisseur cloud
(`169.254.169.254`), un fichier local (`file://`). Ici, `POST /tracks/:id/cover/web`
reçoit une URL (`imageUrl`) et le **serveur** la télécharge : sans précaution,
c'est exactement ce risque.

Défenses du code (`backend/src/app.js`) :

| Défense | Où |
|---|---|
| `https` uniquement | `parseAllowedCoverUrl`, `:200-211` |
| Hôte **se terminant par** `.mzstatic.com` (pas « contenant ») | `COVER_HOST_SUFFIX`, `:64` ; test `endsWith`, `:206` |
| Pas de port, pas d'identifiants dans l'URL | `:207-209` |
| URL de 2048 caractères maximum | `MAX_URL_LENGTH`, `:65`, `:202` |
| Redirections suivies **à la main** et **revalidées** à chaque étape ; 3 maximum | `redirect: "manual"` `:242`, `MAX_REDIRECTS` `:67`, revalidation `:249-252` |
| Délai de 5 secondes | `REMOTE_TIMEOUT_MS`, `:66`, `AbortSignal.timeout` `:239` |
| 2 Mo maximum, lus **par morceaux** et interrompus au dépassement | `readLimitedBody`, `:213-226` |
| Contenu vérifié par les **octets magiques**, pas par le `Content-Type` | `detectImageType`, `:92-102` |
| La recherche n'accepte aussi que des images `mzstatic` en retour | `toCoverCandidate`, `:262-273` |

**Le piège du suffixe.** Tester que l'hôte *contient* `mzstatic.com` accepterait
`mzstatic.com.evil.com`. Le code teste que le nom **se termine** par
`.mzstatic.com` (le point initial compte) : `mzstatic.com.evil.com` et
`evilmzstatic.com` sont refusés. Les deux sont couverts par un test
(`tracks.test.js:642`, URL `https://mzstatic.com.evil.example/a.png` et
`https://evilmzstatic.com/a.png`) et le premier a aussi été essayé **en réel**
(`https://mzstatic.com.evil.com/…` → 400).

**Pourquoi revalider chaque redirection** : une URL initiale acceptée peut
répondre par une redirection vers `http://169.254.169.254/…`. Suivre les
redirections automatiquement contournerait la liste blanche. Test
`tracks.test.js:666` : une redirection vers cette adresse donne `400`, une seule
requête sortante a été faite et rien n'est écrit sur le disque.

**Vérification par mutation** (agent backend, non rejouée ici) : sans la liste
blanche d'hôtes, les tests SSRF et celui de la recherche iTunes échouent.

---

## 6. Récapitulatif : prouvé en réel, prouvé par test, non prouvé

| Affirmation | Réel | Test simulé | Non vérifié |
|---|---|---|---|
| Lecture des tags ID3 d'un MP3 réel | oui (`song4`) | oui (MP3 synthétique) | autres fichiers de test |
| Recherche iTunes (12 candidats, hôte `mzstatic`) | oui | oui | stabilité dans le temps |
| Téléchargement d'une pochette réelle | oui | oui | |
| URL hors liste blanche refusées (7 cas réels) | oui | oui (11 cas) | |
| Délai de 5 s partagé, limite de 3 redirections | | oui (`securite-bonus.test.js:284` : 4 appels au plus, même signal, `redirect: "manual"`) | le délai réel de 5 s n'a jamais été atteint |
| Limite d'appels d'Apple (~20/min) | | | oui, jamais atteinte |
| Conditions d'Apple vs copie locale de l'image | | | oui : **décision ouverte** (§5) |
| Services MusicBrainz, Last.fm, Spotify | | | jamais appelés |
| Deezer | | | **non vérifié** |
