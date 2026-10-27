# TP2 / Mission 3 — Flux d'upload et de lecture audio

Livrables TP2 : « explication écrite du choix `Blob` et `ObjectURL` » et le
repérage demandé par la Mission 3 (« identifiez dans quels fichiers et quelles
méthodes se trouvent… »).

Les réponses aux **questions sur mémoire, buffering et streaming** sont dans le
document voisin
[`questions-memoire-buffering-streaming.md`](./questions-memoire-buffering-streaming.md).

Conventions : les chemins frontend sont relatifs à `frontend-starter/`, les
chemins backend à la racine du dépôt. Chaque affirmation est accompagnée de son
`fichier:ligne`.

> **Périmètre de cette version** : la barre de progression de l'upload et la
> suppression d'une piste (bonus TP3) existent dans le code mais ne sont pas
> encore documentées ici — elles feront l'objet d'un second lot, quand leur
> comportement sera stabilisé.
>
> **Mise à jour après la refonte de la page des pistes** : le fichier choisi est
> désormais validé **dès sa sélection** (`selectFile()` appelle `validateFile()` et
> affiche l'erreur tout de suite), en plus de la revalidation dans `upload()` ; un
> glisser-déposer (`onDrop`) est accepté ; l'upload peut aussi joindre une
> pochette (champ `cover`). Les sections ci-dessous décrivent le flux de base, qui
> n'a pas changé.
>
> **Numéros de ligne** : re-vérifiés sur le **code figé** (`tracks-page.ts` 1039
> lignes, `backend/src/app.js` 885 lignes). Tout changement ultérieur les décalera ;
> le **nom de la méthode ou de l'élément**, cité à côté, fait foi
> (`grep -n "nom" src/app/components/tracks-page/tracks-page.ts`).

---

## 1. Tableau de repérage demandé par la Mission 3

C'est la réponse directe à « identifiez dans quels fichiers et quelles méthodes
se trouvent… ». À lire de haut en bas : c'est l'ordre chronologique.

| Étape de la Mission 3 | Fichier | Méthode / élément | Ligne |
|---|---|---|---|
| **Le choix du fichier** | `src/app/components/tracks-page/tracks-page.html` | `<input type="file" (change)="choose($event)">` | 22-29 |
| | `src/app/components/tracks-page/tracks-page.ts` | `choose(event)` → `selectFile(file)` → `this.file.set(file)` ; le dépôt par glisser-déposer (`onDrop`) passe par la même méthode `selectFile` | (voir `choose`, `selectFile`) |
| **La construction du `FormData`** | `src/app/shared/services/track.service.ts` | `upload()` : `body.append('audio', file)` puis `body.append('title', title)` | 40-41 |
| **L'appel HTTP d'upload** | `src/app/shared/services/track.service.ts` | `this.http.post<Track>('/api/tracks', body, {...})` | 43-46 |
| | *(déclenché par)* `src/app/components/tracks-page/tracks-page.ts` | `upload()` → `this.service.upload(file, submittedTitle)` | 502 et 538-539 |
| **L'ajout du JWT** | `src/app/shared/interceptors/auth.interceptor.ts` | `authInterceptor` | 6-16 |
| **La récupération du `Blob`** | `src/app/shared/services/track.service.ts` | `audio(id)` : `this.http.get(..., { responseType: 'blob' })` | 54-58 |
| | *(déclenché par)* `src/app/components/tracks-page/tracks-page.ts` | `play(track)` → `playRequests.next(track)`, puis le `switchMap` du constructeur | 968-971 et 275-287 |
| **La création de l'`ObjectURL`** | `src/app/components/tracks-page/tracks-page.ts` | `this.audioUrl.set(URL.createObjectURL(blob))` | 294 |
| **L'affectation au lecteur `<audio>`** | `src/app/components/tracks-page/tracks-page.html` | `<audio [src]="audioUrl()" controls autoplay (error)="onAudioError()">` | 408-414 |
| **La révocation de l'ancienne URL** | `src/app/components/tracks-page/tracks-page.ts` | `this.revokeAudioUrl()` appelé **avant** chaque nouvelle création | 293 |
| | `src/app/components/tracks-page/tracks-page.ts` | `revokeAudioUrl()` : `URL.revokeObjectURL(url)` | 984-991 |
| **La révocation finale (destruction)** | `src/app/components/tracks-page/tracks-page.ts` | `this.destroyRef.onDestroy(() => …)` (qui appelle `revokeAudioUrl()`) | 343-346 |
| **La validation frontend du fichier** | `src/app/components/tracks-page/tracks-page.ts` | `validateFile(file)` | 701-720 |
| **La validation backend (l'autorité)** | `backend/src/app.js` | `multer({ storage, limits, fileFilter })` | 355-372 |

---

## 2. Le flux d'upload : composant → service → `HttpClient` → API

### Schéma

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant TP as TracksPageComponent
    participant TS as TrackService
    participant IC as authInterceptor
    participant MU as Multer (backend)
    participant DB as MongoDB

    U->>TP: choisit un fichier — (change)="choose($event)" (html:29)
    TP->>TP: selectFile(files?.[0]) : this.file.set(...) + validation immédiate (méthodes choose / selectFile)
    U->>TP: clic « Envoyer » — (click)="upload()" (html:111)
    TP->>TP: garde anti-double-soumission : if (this.uploading()) return (ts:505-508)
    TP->>TP: validateFile(file) (ts:518) — si invalide : message, AUCUNE requête
    TP->>TS: service.upload(file, titre, cover) (ts:538-539)
    TS->>TS: new FormData(); append('audio', file); append('title', title) (service:39-41)
    TS->>IC: POST /api/tracks, body = FormData (service:43)
    Note over IC: ajoute Authorization: Bearer <token> (interceptor:12)
    IC->>MU: POST /api/tracks (multipart/form-data)
    Note over MU: auth vérifie le JWT (app.js:608)<br/>upload.fields([audio, cover]) écrit les fichiers sur DISQUE (app.js:609-612)
    MU->>DB: Track.create({ ownerId, title, storedName, mimeType, size, artist, album, … }) (app.js:632-642)
    DB-->>MU: document créé
    MU-->>TP: 201 Track (JSON, app.js:645)
    TP->>TP: message de succès, formulaire vidé, page.set(1), load() (ts:562-570)
```

### Ce qu'il faut savoir expliquer

**Pourquoi `FormData` et pas du JSON ?** Un fichier est une suite d'octets
binaires ; JSON ne transporte que du texte. Il faudrait l'encoder en base64,
ce qui gonfle la taille d'environ 33 % et oblige le serveur à tout décoder en
mémoire. `FormData` produit une requête `multipart/form-data`, le format que
les formulaires HTML utilisent depuis toujours et que Multer sait découper.

**On ne pose jamais `Content-Type` soi-même.** `track.service.ts:43-46` ne
définit aucun en-tête. C'est volontaire : quand le corps d'une requête est un
`FormData`, le navigateur écrit lui-même
`Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...`. Ce
`boundary` est une chaîne aléatoire qui sert de séparateur entre les champs.
Si on écrivait `Content-Type: multipart/form-data` à la main, le `boundary`
serait absent et le serveur ne pourrait plus découper la requête : Multer
échouerait, `req.files?.audio` serait vide et le backend répondrait
`400 { message: "Fichier audio requis" }` (`backend/src/app.js:619-623`).

**Les noms de champs `audio` et `title` ne sont pas décoratifs.** Ce sont des
noms de contrat :

| Champ du `FormData` | Écrit en | Lu côté backend par | À la ligne |
|---|---|---|---|
| `audio` | `track.service.ts:40` | `upload.fields([{ name: "audio" }, { name: "cover" }])` → `req.files.audio[0]` | `backend/src/app.js:609-614` |
| `title` | `track.service.ts:41` | `req.body.title` | `backend/src/app.js:634` |

Une faute de frappe (`file` au lieu de `audio`) ne provoque **aucune erreur
TypeScript** — `FormData.append` accepte n'importe quelle chaîne — mais
`req.files.audio` resterait `undefined` et l'upload échouerait en `400`. C'est
typiquement le genre de bug qu'on ne trouve que dans l'onglet Network, en
dépliant le *Payload* de la requête.

**Le titre a une valeur de repli.** `tracks-page.ts:530` :
`this.title.value.trim() || file.name`. Le backend fait de son côté le même
repli, plus riche depuis la lecture des tags ID3 : `req.body.title || tags.title ||
audioFile.originalname` (`backend/src/app.js:634`) — le titre saisi, sinon le titre
ID3, sinon le nom du fichier. Une piste a donc toujours un titre affichable.

**Le fichier ne passe pas par la RAM du serveur.** Multer est configuré en
`diskStorage` (`backend/src/app.js:335-348`) : les octets sont écrits directement
dans `data/uploads` (`backend/src/app.js:16`) sous un nom aléatoire
(`crypto.randomUUID()`, `:343-344`), ce qui évite qu'un utilisateur puisse deviner ou
écraser le fichier d'un autre. MongoDB ne reçoit que des **métadonnées**
(`Track.create`, `:632-642`). Le nom de stockage réel, `storedName`, est
`select: false` dans le schéma (`backend/src/models/Track.js:22`) et exclu de
`toPublic()` (`Track.js:45-59`) : il n'est donc jamais exposé au client.

---

## 3. Le flux de lecture : API → `Blob` → `ObjectURL` → lecteur

### Schéma

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant TP as TracksPageComponent
    participant TS as TrackService
    participant IC as authInterceptor
    participant API as GET /api/tracks/:id/audio
    participant AU as élément &lt;audio&gt;

    U->>TP: clic « Lire » sur une card (html:276)
    TP->>TP: play(track) → playRequests.next(track) (ts:968)
    Note over TP: switchMap ANNULE la requête précédente (ts:275)
    TP->>TS: service.audio(track.id) (ts:276)
    TS->>IC: GET /api/tracks/:id/audio, responseType: 'blob' (service:55-57)
    Note over IC: ajoute Authorization: Bearer <token>
    IC->>API: GET avec JWT
    Note over API: auth vérifie le JWT (app.js:659)<br/>findOne({_id, ownerId}) — filtre sur le PROPRIÉTAIRE (app.js:661-664)<br/>res.type(mimeType) (app.js:672) puis res.sendFile(path) (app.js:674)
    API-->>TS: 200 + octets audio
    TS-->>TP: un seul next() avec le Blob complet
    TP->>TP: revokeAudioUrl() — libère l'URL précédente (ts:293)
    TP->>TP: audioUrl.set(URL.createObjectURL(blob)) (ts:294)
    TP->>AU: [src]="audioUrl()" (html:180)
    AU->>AU: lecture (autoplay, html:182)
```

### Ce qu'il faut savoir expliquer

**Un `Blob`, c'est quoi ?** Un objet JavaScript qui représente une suite
d'octets *immuable*, en mémoire, avec un type MIME. Ici il contient tout le
fichier audio. C'est ce que `HttpClient` produit quand on lui passe
`responseType: 'blob'` (`track.service.ts:56`) au lieu de tenter d'interpréter
la réponse comme du JSON — ce qui échouerait immédiatement sur des octets
binaires.

**Un `ObjectURL`, c'est quoi ?** `URL.createObjectURL(blob)` renvoie une URL de
la forme `blob:http://localhost:4200/8f3c...`. Ce n'est pas une adresse réseau :
c'est une **référence locale** vers le `Blob` déjà présent en mémoire,
enregistrée dans une table interne du document. Elle permet de donner à un
élément HTML qui attend une URL (`<audio src>`, `<img src>`, `<video src>`) un
contenu que le JavaScript détient déjà. Aucune requête réseau supplémentaire
n'est émise quand le lecteur lit cette URL.

**Pourquoi ce détour ? La réponse est dans le §4 : c'est le JWT.**

**Le `switchMap` n'est pas un détail de style.** `tracks-page.ts:275-287` fait
passer toutes les demandes de lecture par un `Subject` (`playRequests`,
`:263`). Sans lui, en cliquant sur « Lire » de la piste A puis rapidement de
la piste B, l'ordre d'arrivée des réponses n'est pas garanti : un fichier A plus
petit pourrait revenir *après* B et écraser le lecteur, qui jouerait A alors
que l'interface affiche B. `switchMap` **annule** l'abonnement précédent : la
réponse tardive est ignorée. C'est la façon RxJS standard de traiter une course
entre requêtes (*race condition*).

**Le backend filtre sur le propriétaire.** `backend/src/app.js:661-664` :
`Track.findOne({ _id: req.params.id, ownerId: req.auth.sub })`. Une piste
inexistante et une piste appartenant à quelqu'un d'autre renvoient *toutes les
deux* `404 { message: "Piste inconnue" }` (`:668`). C'est volontaire : répondre
`403` sur la piste d'un autre révélerait son existence. Côté frontend, le
message est donc prudemment formulé (« introuvable **ou** ne vous appartient
pas », `tracks-page.ts:1028`), parce que le client ne peut honnêtement pas
distinguer les deux cas.

**Deux sources d'erreur distinctes sont traitées séparément :**

| Erreur | Origine | Traitement |
|---|---|---|
| Le téléchargement échoue (`401`, `404`, serveur injoignable) | `HttpClient` | `catchError` dans le pipe (`tracks-page.ts:278-285`) → `audioErrorMessage()` (`:1025-1038`) |
| Le téléchargement réussit mais le navigateur ne sait pas décoder les octets | l'élément `<audio>` lui-même | `(error)="onAudioError()"` (`tracks-page.html:412`) → `onAudioError()` (`tracks-page.ts:974-982`) |

Le second cas est réel : le backend accepte `audio/mp4` et `audio/x-m4a`
(`backend/src/app.js:43-44`), mais tous les navigateurs ne décodent pas tous
les codecs contenus dans ces conteneurs. Sans le gestionnaire `(error)`,
l'utilisateur verrait un lecteur muet sans aucune explication.

**Particularité des erreurs en mode `blob`** : quand on demande
`responseType: 'blob'`, le corps d'une réponse d'erreur est lui aussi un `Blob`,
pas du JSON. `error.error.message` n'existe donc pas. C'est pourquoi
`audioErrorMessage()` (`tracks-page.ts:1025-1038`) traduit le **statut HTTP** en
message, au lieu de lire le corps comme le fait `serverMessage()` (`:1010-1019`)
pour les réponses JSON. C'est une subtilité facile à manquer.

---

## 4. Pourquoi une URL placée directement dans `src` ne reçoit pas le JWT

C'est la question centrale de la Mission 3. Le code « naïf » serait :

```html
<!-- NE FONCTIONNE PAS : 401 -->
<audio [src]="'/api/tracks/' + track.id + '/audio'" controls></audio>
```

### La raison en une phrase

`authInterceptor` est un morceau de code Angular branché sur `HttpClient`
(`src/main.ts:14` → `withInterceptors([...])`). Quand le **navigateur** va
chercher lui-même la ressource d'un attribut `src`, il ne passe pas par
`HttpClient` — donc pas par l'intercepteur, donc sans en-tête `Authorization`.

### Le détail

Deux mondes très différents émettent des requêtes dans une page web :

| | `HttpClient` (Angular) | Chargement d'une sous-ressource (`src`) |
|---|---|---|
| Qui déclenche ? | votre code TypeScript | le moteur de rendu du navigateur, en analysant le DOM |
| Passe par les intercepteurs Angular ? | **oui** | **non** — Angular n'est jamais sollicité |
| En-têtes personnalisables ? | oui, `request.clone({ setHeaders })` | **non** : un attribut `src` n'a pas de syntaxe pour cela |
| Ce qui est envoyé automatiquement | ce que vous mettez | cookies du domaine, `Referer`, `Range`… mais jamais un en-tête applicatif |

Le point clé : **il n'existe aucun moyen, en HTML, d'attacher un en-tête à un
attribut `src`.** Ce n'est pas une limitation d'Angular, c'est la plateforme
web. Le navigateur envoie automatiquement les cookies, mais notre API
n'utilise pas de cookie : elle attend `Authorization: Bearer <token>`
(`backend/src/app.js:309`), qui est un en-tête **applicatif** que seul du code
peut poser.

Résultat sans le détour par le `Blob` : le middleware `auth` ne trouve pas
d'en-tête `Authorization`, journalise l'avertissement (`app.js:310`) et répond
`401 { message: "Authentification requise" }` (`app.js:311`). L'élément
`<audio>` déclenche son événement `error` et reste muet.

### Ce que le détour résout, étape par étape

1. **Le code Angular** demande les octets : `this.http.get(..., { responseType:
   'blob' })` (`track.service.ts:55-57`) → c'est `HttpClient`, donc
   `authInterceptor` ajoute l'en-tête (`auth.interceptor.ts:12`). Requête
   authentifiée : `200`.
2. Les octets arrivent sous forme de `Blob`, **déjà en mémoire dans la page**.
3. `URL.createObjectURL(blob)` (`tracks-page.ts:294`) crée une URL `blob:` qui
   pointe vers cette mémoire.
4. `<audio [src]="audioUrl()">` (`tracks-page.html:409`) : le navigateur charge
   bien cette URL lui-même — mais elle est **locale**. Aucune requête réseau,
   donc aucun besoin d'authentification.

En résumé : on remplace *une requête réseau que le navigateur ferait sans
pouvoir s'authentifier* par *une requête réseau faite par Angular avec le JWT,
suivie d'une référence purement locale*.

---

## 5. `Blob` téléchargé, buffering navigateur, streaming serveur

Trois notions que le sujet demande explicitement de distinguer. Elles décrivent
trois endroits différents de la chaîne, et elles ne s'excluent pas : dans notre
application, **le serveur streame pendant que le client, lui, télécharge tout
avant de jouer**.

### Les trois notions

| | **Streaming côté serveur** | **Téléchargement complet d'un `Blob`** | **Buffering navigateur** |
|---|---|---|---|
| Où ça se passe | sur le serveur, à l'émission | dans le code JavaScript de la page | dans le lecteur média du navigateur |
| Qui décide | `res.sendFile()` (`backend/src/app.js:674`) | `responseType: 'blob'` (`track.service.ts:56`) | le navigateur, tout seul |
| En quoi ça consiste | lire le fichier par morceaux sur le disque et les pousser dans la socket, sans jamais tout charger en RAM | attendre la **totalité** des octets, puis livrer un seul objet `Blob` à l'abonné | ne télécharger qu'un début de fichier, commencer à jouer, et continuer à télécharger pendant la lecture (requêtes `Range`) |
| Consommation mémoire | faible et constante côté serveur, quelle que soit la taille du fichier | toute la taille du fichier dans la mémoire de l'onglet | quelques secondes d'audio à la fois |
| Utilisé dans notre app ? | **oui** | **oui** | **non** — voir ci-dessous |

### Pourquoi les trois coexistent (ou pas) ici

- **Le serveur streame.** `res.sendFile()` (`backend/src/app.js:674`) ouvre un
  flux de lecture sur le fichier et le raccorde à la réponse HTTP. Le fichier
  n'est jamais entièrement chargé dans la mémoire de Node. Un fichier de 25 Mo
  ne coûte pas 25 Mo de RAM serveur. C'est du streaming au sens strict.
- **Le client, lui, attend tout.** `responseType: 'blob'` ne produit **aucun**
  résultat intermédiaire : l'abonné ne reçoit son unique `next()` que lorsque le
  dernier octet est arrivé (`tracks-page.ts:291`). On perd donc le bénéfice du
  streaming *pour le démarrage de la lecture* : rien ne se joue avant la fin du
  téléchargement.
- **Le buffering du navigateur est court-circuité.** Le lecteur ne reçoit pas
  une URL HTTP mais une URL `blob:` (`tracks-page.html:409`) : le contenu est
  déjà intégralement en mémoire, il n'y a rien à bufferiser et aucune requête
  `Range` à émettre. Le navigateur *sait* faire du buffering — c'est ce qu'il
  fait avec un `<audio src="https://...">` — mais il n'en a pas l'occasion ici.

### Le compromis assumé, et pourquoi

| Ce qu'on perd | Ce qu'on gagne |
|---|---|
| La lecture ne démarre qu'à la fin du téléchargement (latence visible sur un gros fichier) | **L'authentification par JWT fonctionne** — c'est la contrainte de départ, voir §4 |
| Toute la piste occupe la mémoire de l'onglet tant que l'URL n'est pas révoquée | Le déplacement dans la piste est instantané : tout est déjà local |
| Le navigateur ne peut pas sauter directement au milieu du fichier sans tout télécharger | Une fois chargée, la lecture est insensible aux coupures réseau |

Pour un TP et des fichiers de moins de 25 Mo
(`MAX_FILE_SIZE`, `backend/src/app.js:35`), ce compromis est raisonnable. Pour
un vrai service de streaming, on utiliserait plutôt des URL signées à durée de
vie limitée (*presigned URL*) : le token est alors dans l'URL elle-même, qui
peut donc être mise directement dans `src` — et le buffering natif du
navigateur redevient possible.

---

## 6. Validation frontend et validation backend

### Les contrôles, des deux côtés

| Contrôle | Frontend | Backend (l'autorité) |
|---|---|---|
| Un fichier est présent | `tracks-page.ts:513-516` (`if (!file)`) | `app.js:619-623` → `400 { message: "Fichier audio requis" }` |
| Type MIME autorisé | `ALLOWED_MIME_TYPES` (`tracks-page.ts:58-65`) testé en `:703-709` | `fileFilter` de Multer (`app.js:358-371`), à partir du `Set allowed` (`app.js:38-45`) |
| Taille ≤ 25 Mo | `MAX_FILE_SIZE` (`tracks-page.ts:52`) testé en `:711-713` | `limits: { fileSize: MAX_FILE_SIZE }` (`app.js:357`), `MAX_FILE_SIZE` défini en `app.js:35` |
| Fichier non vide | `tracks-page.ts:715-717` | *(pas de contrôle explicite)* |
| Pré-filtrage du sélecteur de fichiers | `[accept]="acceptAttribute"` (`tracks-page.html:26`), construit en `tracks-page.ts:266` | *(sans objet)* |

Les constantes frontend sont **copiées à l'identique** du backend, et leurs
commentaires citent la ligne source (au-dessus de `MAX_FILE_SIZE`, `tracks-page.ts:47-51`, et de `ALLOWED_MIME_TYPES`) : c'est
ce qui permet de repérer une divergence si le backend évolue. Le backend refuse
avec un `400 { message }` via son gestionnaire d'erreurs central
(`app.js:861-866` : une `MulterError` — dont le dépassement de taille — ou le
message `"Format audio non accepté"` deviennent un `400`).

### Pourquoi la validation frontend ne remplace jamais la validation backend

**Elle est contournable — entièrement.** Le code frontend s'exécute sur la
machine de l'utilisateur, qui en est maître. Il suffit de :

- désactiver JavaScript, ou modifier le code dans les DevTools ;
- reconstruire la requête à la main (`curl`, Postman) avec un JWT valide
  récupéré depuis son propre `localStorage` ;
- écrire un client tiers qui parle au même contrat HTTP.

Aucune de ces trois voies ne passe par `validateFile()`. L'attribut
`accept` de l'`<input type="file">` est encore plus faible : c'est un simple
**filtre d'affichage** dans la boîte de dialogue du système, et la plupart des
systèmes laissent choisir « Tous les fichiers ».

**Formuler la règle proprement** :

> Une vérification qui s'exécute chez le client est une **aide à la saisie**.
> Une vérification qui s'exécute sur le serveur est une **garantie**.

Ce n'est pas propre aux fichiers : c'est le même raisonnement que pour
`authGuard` (qui ne protège que l'affichage d'une page) face au middleware
`auth` (qui protège les données) — voir
[`../mission0-cartographie.md`](../mission0-cartographie.md#deux-notions-de--protection--à-ne-pas-confondre).

**Alors à quoi sert la validation frontend ?** À trois choses précises, qu'un
serveur ne peut pas offrir :

1. **Un retour immédiat.** Un message apparaît sans aller-retour réseau
   (`tracks-page.ts:518-522`), et l'erreur désigne la cause exacte : le format
   refusé (`:708`) ou la taille réelle comparée au maximum (`:712`).
2. **Ne pas transférer inutilement.** Envoyer 40 Mo pour se faire répondre
   `400` gaspille la bande passante de l'utilisateur (coûteux en 4G) et le temps
   du serveur. Le refus local coûte zéro octet.
3. **Une tolérance impossible côté serveur.** `tracks-page.ts:703-705` : si
   `file.type` est vide — ce qui arrive selon le système et l'extension —, on
   retombe sur l'extension du nom de fichier (`ALLOWED_EXTENSIONS`, `:72`)
   plutôt que de bloquer un fichier que le backend accepterait. Le frontend est
   ici volontairement **plus permissif**, et laisse le backend trancher. C'est
   le bon sens de la dépendance : le frontend ne doit jamais refuser ce que le
   serveur accepterait, et son acceptation n'engage rien.
