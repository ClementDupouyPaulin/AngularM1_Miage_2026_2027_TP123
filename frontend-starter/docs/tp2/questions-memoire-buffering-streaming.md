# TP2 — Réponses aux questions sur mémoire, buffering et streaming

Livrable TP2 : « réponses aux questions sur mémoire, buffering et streaming
audio » (`SUJET_ETUDIANT_TP2.md`, section « Questions sur mémoire buffering et
streaming »).

Les cinq questions sont reprises **mot pour mot**. Chaque réponse est justifiée
par le code, avec `fichier:ligne`. Les notions de fond (`Blob`, `ObjectURL`,
pourquoi ce détour) sont expliquées dans
[`upload-et-lecture-audio.md`](./upload-et-lecture-audio.md).

Chemins frontend relatifs à `frontend-starter/`, chemins backend relatifs à la
racine du dépôt.

> **Numéros de ligne** : re-vérifiés sur le **code figé** (`tracks-page.ts` 1039
> lignes, `backend/src/app.js` 885 lignes). Tout changement ultérieur les décalera ;
> le **nom de la méthode ou de l'élément**, cité à côté, fait foi
> (`grep -n "nom" src/app/components/tracks-page/tracks-page.ts`).

---

## Q1. Le backend envoie-t-il le fichier entier en mémoire, ou peut-il l'envoyer progressivement depuis le disque ?

**Réponse : progressivement depuis le disque. Le fichier n'est jamais chargé
entièrement dans la mémoire de Node.**

La preuve tient en une ligne, `backend/src/app.js:674` :

```js
res.sendFile(audioPath, (error) => { /* ... */ });
```

`res.sendFile()` est une méthode d'Express qui, en interne, ouvre un flux de
lecture sur le fichier et le raccorde (`pipe`) à la réponse HTTP. Les octets
transitent par morceaux (*chunks*) : lire un morceau → l'écrire dans la socket →
lire le suivant. La mémoire occupée reste faible et **constante**, quelle que
soit la taille du fichier. Un fichier de 25 Mo ne coûte pas 25 Mo de RAM.

Ce qu'il faut remarquer, c'est ce que le code ne fait **pas** :

- il n'y a **aucun** `fs.readFile()` ni `fsPromises.readFile()` sur le chemin
  audio (on peut le vérifier : `grep -n "readFile" backend/src/app.js` ne
  renvoie rien) ;
- rien n'est mis en mémoire tampon dans une variable avant l'envoi.

Deux éléments de contexte confirment le raisonnement :

1. **Les octets sont sur le disque, pas dans MongoDB.** Multer est configuré en
   `diskStorage` (`backend/src/app.js:335-348`), qui écrit le fichier dans
   `data/uploads` (`:16`). MongoDB ne contient que des métadonnées
   (`Track.create({ ownerId, title, originalName, storedName, mimeType, size, artist, album, … })`,
   `:632-642`). C'est aussi ce que dit `API_CONTRACT.md` : « les octets des
   fichiers audio restent sur le disque du serveur ». Il y a donc bien un
   fichier à streamer.
2. **Le type MIME est posé avant l'envoi** : `res.type(track.mimeType)`
   (`:672`). C'est nécessaire parce que `storedName` est un UUID dont
   l'extension ne suffirait pas toujours à faire deviner le type à Express.

**Bonus — `sendFile` gère aussi les requêtes `Range`.** Express répond
`206 Partial Content` si le client demande un intervalle d'octets. Notre
frontend ne s'en sert pas (voir Q4), mais le backend est déjà capable de servir
un lecteur qui ferait du buffering. Aucune modification du backend ne serait
nécessaire pour cela — seule l'authentification bloque cette approche (voir Q4).

---

## Q2. Avec `HttpClient` et `responseType: "blob"`, à quel moment le composant reçoit-il généralement le fichier ?

**Réponse : une seule fois, à la toute fin — quand le dernier octet est arrivé.
Jamais avant, et jamais par morceaux.**

L'appel est `track.service.ts:54-58` :

```ts
audio(id: string): Observable<Blob> {
  return this.http.get(`/api/tracks/${id}/audio`, { responseType: 'blob' });
}
```

Sans `observe: 'events'`, `HttpClient` renvoie un Observable **du corps de la
réponse**. Un `Blob` est un objet immuable : il ne peut pas exister « à moitié
rempli ». Angular doit donc accumuler la totalité des octets avant de pouvoir
construire l'objet et l'émettre.

Concrètement, l'Observable retourné émet :

1. `next(blob)` — **une seule fois**, avec le fichier complet ;
2. `complete()` — immédiatement après.

C'est ce `next` unique qui exécute `tracks-page.ts:291-297` : c'est seulement
là que l'`ObjectURL` est créée (`:294`) et que le lecteur reçoit sa source.

### Ce que cela implique, et comment le code le prend en compte

Il y a donc un **temps d'attente** entre le clic et le début de la lecture. Le
composant le rend visible : `audioLoadingId` est posé dès la demande
(`tracks-page.ts:273`), remis à `''` à l'arrivée du `Blob` (`:296`) ou en cas
d'erreur (`:280`). Le bouton concerné est désactivé pendant ce temps
(`tracks-page.html:277`) et affiche un indicateur d'attente (`:281-282`).

### Contraste utile : l'upload, lui, *est* progressif

`TrackService.upload()` (`track.service.ts:38-47`) demande explicitement
`observe: 'events'` avec `reportProgress: true`. Le composant reçoit alors une
**suite** d'événements (`HttpEventType.UploadProgress`, puis
`HttpEventType.Response`), qu'il distingue en `tracks-page.ts` (méthode `upload()`, bloc `next` : `HttpEventType.UploadProgress` puis `Response`). La
différence n'est donc pas une propriété de `HttpClient` en général, mais une
conséquence de ce qu'on lui demande d'observer.

> Note : la barre de progression s'appuyant sur ces événements relève des bonus
> TP3 et sera documentée dans un second lot.

### Et si on voulait jouer avant la fin ?

Il faudrait renoncer au `Blob` complet : soit une URL HTTP directe dans `src`
(impossible avec un JWT en en-tête, voir Q4), soit l'API **Media Source
Extensions** en alimentant le lecteur morceau par morceau. C'est hors périmètre
de ce TP, mais c'est ce qu'utilisent les vraies plateformes de streaming.

---

## Q3. Si la bibliothèque contient 100 morceaux, les 100 fichiers audio sont-ils chargés en mémoire dès l'affichage de la liste ? Justifier à partir du code.

**Réponse : non. Aucun octet audio n'est téléchargé à l'affichage de la liste.
Au maximum un seul fichier est en mémoire à la fois, et seulement après un clic
sur « Lire ».**

Trois arguments, tous vérifiables dans le code.

### Argument 1 — `list()` ne renvoie que des métadonnées JSON

`track.service.ts:22-27` appelle `GET /api/tracks?page=&limit=`, typé
`Page<Track>`. Or `Track` (`src/app/shared/models/track.model.ts`) ne contient
que `id`, `title`, `originalName`, `mimeType`, `size`, `createdAt`, `artist`, `album`,
`hasCover` et `coverSource` — **aucun champ de contenu binaire** (les champs de
pochette sont un booléen et une origine, pas l'image).

Côté backend, `GET /api/tracks` (`backend/src/app.js:538-593`) interroge
MongoDB par un pipeline d'agrégation paginé (`Track.aggregate` puis
`Track.aggregatePaginate`, `:566-574` ; voir
[`../bonus/pagination-mongoose.md`](../bonus/pagination-mongoose.md)) et répond en
JSON (`res.json({ items, page, limit, total, pages, hasPrevPage, … })`, `:578-588`). Il ne touche
jamais au dossier `data/uploads`. Le champ `size` est un **nombre** (le poids en
octets, affiché par `formatSize()`, `tracks-page.ts:996-1001`) : c'est de
l'information *sur* le fichier, pas le fichier.

Une réponse JSON pour 100 pistes pèse quelques kilo-octets. 100 fichiers MP3 en
pèseraient plusieurs centaines de méga-octets.

### Argument 2 — `audio(id)` n'est appelé que depuis la lecture

C'est la seule méthode qui télécharge des octets (`track.service.ts:54`). On
peut chercher tous ses appels :

```bash
grep -rn "service.audio(" frontend-starter/src/app
```

Il n'y en a **qu'un seul** : `tracks-page.ts:276`, à l'intérieur du `switchMap`
alimenté par le `Subject` `playRequests` (`:263`). Et ce `Subject` n'est
alimenté qu'à un seul endroit : `play(track)` (`:968`), déclenché par le bouton
« Lire » d'une card (`tracks-page.html:276`).

**Conséquence : pas de clic, pas de requête audio.** La liste peut contenir
1 000 pistes, aucun octet audio ne partira.

### Argument 3 — le template ne crée pas 100 lecteurs

Dans `tracks-page.html`, les cards de la boucle `@for` n'incluent **aucun**
élément `<audio>`. Il n'y a qu'un seul lecteur dans toute la page, en dehors de
la boucle (`:408-414`), et il n'est même rendu que si une URL existe :
`@if (audioUrl())` (`:402`). Tant que rien n'a été demandé, `audioUrl()` vaut
`''` (`tracks-page.ts:253`) et le lecteur n'existe pas dans le DOM.

> **Nuance depuis l'ajout des pochettes** (interface décrite dans
> [`../bonus/pochettes.md`](../bonus/pochettes.md)). La liste reste du JSON de métadonnées, et
> **aucun octet audio** n'est téléchargé avant un clic sur « Lire » : ce qui
> précède reste exact pour **l'audio**. En revanche, chaque card affiche
> désormais une pochette : le composant `TrackCoverComponent`
> (`src/app/components/tracks-page/track-cover/track-cover.ts`) appelle
> `TrackService.cover(id)` pour les pistes dont `hasCover` est vrai, et crée une
> `ObjectURL` par image. À l'affichage d'une page, ce sont donc **jusqu'à autant
> d'images (2 Mo maximum chacune) que de pistes affichées** qui sont téléchargées
> — jamais le fichier audio. La question « 100 pistes ⇒ 100 fichiers audio en
> mémoire ? » garde la même réponse (non) ; elle ne dit rien de la mémoire des
> pochettes.

### Combien de fichiers en mémoire, alors ?

**Au plus un.** À chaque nouvelle lecture, `revokeAudioUrl()` est appelé
**avant** `createObjectURL` (`tracks-page.ts:293-294`) : la référence au `Blob`
précédent est relâchée avant que la nouvelle soit posée. Écouter les 100 pistes
l'une après l'autre ne fait donc pas grimper la mémoire de l'onglet.

Et la liste elle-même ? Elle ne contient jamais 100 éléments : la pagination est
faite **par le serveur**, par les étapes `$skip` et `$limit` du pipeline que génère
`mongoose-aggregate-paginate-v2` (version d'origine : `.skip().limit()` de `find`),
et `limit` est plafonné à 20 (`backend/src/app.js:541`). Le frontend
demande 5 pistes par page par défaut (signal `limit`, `tracks-page.ts`) et
`tracks.set(response.items)` (méthode `applyPage`) **remplace** le tableau au lieu de l'agrandir. Le sujet l'exige
d'ailleurs : « il est interdit de récupérer toutes les pistes puis de les
découper localement dans Angular ».

---

## Q4. Quelle différence y aurait-il avec 100 éléments `<audio>` utilisant directement une URL HTTP ?

Hypothèse : on écrirait, dans la boucle `@for`, une card contenant

```html
<!-- variante hypothétique -->
<audio [src]="'/api/tracks/' + track.id + '/audio'" controls></audio>
```

**Réponse courte : cette variante serait plus économe en mémoire et permettrait
une lecture instantanée… mais elle ne fonctionnerait pas du tout ici, parce
qu'aucun JWT ne serait envoyé. Les 100 lecteurs afficheraient une erreur.**

### Ce qui changerait techniquement (si l'authentification n'était pas un
problème)

| | Notre implémentation (`Blob` + `ObjectURL`) | 100 `<audio src="http…">` |
|---|---|---|
| Requêtes au chargement de la liste | **0** | 0 à 100 selon l'attribut `preload` (voir ci-dessous) |
| Ce qui est téléchargé pour jouer | **tout** le fichier, avant de commencer | seulement le début, puis la suite pendant la lecture |
| Mécanisme | un `GET` complet par `HttpClient` | *buffering* natif du navigateur, par requêtes `Range` → réponses `206 Partial Content` |
| Démarrage de la lecture | après le téléchargement complet | quasi immédiat |
| Mémoire pour 100 pistes | un fichier au plus (`revokeAudioUrl` avant chaque création, `tracks-page.ts:293`) | quelques secondes d'audio par lecteur *actif* |
| Déplacement dans la piste | instantané (tout est local) | requête `Range` sur la position visée |
| En-tête `Authorization` | **oui**, ajouté par `authInterceptor` (`auth.interceptor.ts:12`) | **non**, impossible |

À propos de `preload` : par défaut (`preload="metadata"` sur la plupart des
navigateurs), chaque `<audio>` émet une **petite** requête au chargement, juste
pour connaître la durée et le format — 100 lecteurs, 100 requêtes, même sans
aucun clic. Avec `preload="auto"`, le navigateur peut décider de pré-charger
bien davantage. Avec `preload="none"`, rien ne part avant l'interaction. Ce
détail est important : « ne pas charger les fichiers » n'est pas garanti par
défaut dans cette variante, alors qu'il l'est dans la nôtre (Q3, argument 2).

### Pourquoi c'est malgré tout impossible ici

Un attribut `src` est chargé par le **navigateur**, pas par `HttpClient`. Il ne
traverse donc pas `authInterceptor` (enregistré sur `HttpClient` via
`src/main.ts:14`), et il n'existe **aucune syntaxe HTML** pour attacher un
en-tête à un `src`. La requête partirait sans `Authorization`, le middleware
`auth` du backend la rejetterait (`backend/src/app.js:309-312` →
`401 { message: "Authentification requise" }`) et chaque lecteur déclencherait
son événement `error`.

L'explication détaillée est au §4 de
[`upload-et-lecture-audio.md`](./upload-et-lecture-audio.md#4-pourquoi-une-url-placée-directement-dans-src-ne-reçoit-pas-le-jwt).

### La bonne conclusion à retenir

Le `Blob` **n'est pas** la technique la plus efficace pour lire de l'audio : le
buffering natif du navigateur est meilleur sur presque tous les critères. C'est
un **contournement imposé par une contrainte de sécurité** : servir un fichier
privé authentifié par un en-tête `Authorization`.

Un vrai service résoudrait le problème autrement, en remettant le token *dans
l'URL* pour qu'elle devienne utilisable dans un `src` :

- **URL signée à durée de vie courte** (*presigned URL*) : le backend renvoie
  `/api/tracks/<id>/audio?sig=<signature>&exp=<timestamp>`, valable quelques
  minutes. Le buffering natif redevient possible, et l'URL ne fuite pas
  durablement.
- **Cookie `HttpOnly` + `SameSite`** : le navigateur l'attache automatiquement,
  y compris sur un `src` — mais cela change tout le modèle d'authentification de
  l'API et ouvre la question du CSRF.

Savoir **pourquoi** on a choisi le `Blob` — et ce qu'on y perd — est exactement
ce que le sujet demande de pouvoir expliquer.

---

## Q5. Pourquoi l'URL créée par `URL.createObjectURL` doit-elle être révoquée ?

**Réponse : parce que cette URL est enregistrée dans une table interne du
document, qui garde une référence forte vers le `Blob`. Tant que l'URL n'est pas
révoquée, le ramasse-miettes ne peut pas libérer les octets — même si plus
personne n'utilise l'URL.**

### Le mécanisme précis

`URL.createObjectURL(blob)` fait deux choses :

1. il renvoie une chaîne, `blob:http://localhost:4200/<uuid>` ;
2. il **enregistre une association** `<uuid> → Blob` dans une table attachée au
   document (la *blob URL store*).

C'est cette table le problème. Elle constitue une référence vers le `Blob` que
le moteur JavaScript doit considérer comme vivante. Mettre la variable à `null`,
vider le Signal, ou même retirer l'élément `<audio>` du DOM **ne libère rien** :
l'entrée reste dans la table. Elle n'est nettoyée automatiquement qu'à la
destruction du document, c'est-à-dire au **rechargement complet de la page** —
ce qui, dans une *single-page application*, peut ne jamais arriver de toute une
session de travail.

`URL.revokeObjectURL(url)` supprime l'entrée. Le `Blob` devient alors
inatteignable et le ramasse-miettes peut récupérer sa mémoire.

### L'ordre de grandeur de la fuite

Chaque piste écoutée immobilise sa taille en mémoire, jusqu'à 25 Mo
(`MAX_FILE_SIZE`, `backend/src/app.js:35`). Sur une session de travail à la
guitare — le cas d'usage de cette application — enchaîner 30 backing tracks de
5 Mo laisserait environ **150 Mo** retenus dans l'onglet, pour des fichiers dont
plus aucun n'est joué. L'onglet ralentit, et finit par être tué par le système
sur une machine modeste. Et une fois l'URL révoquée, elle est définitivement
morte : la rappeler donne un lecteur en erreur.

### Les deux endroits où le code révoque, et pourquoi il en faut deux

| Quand | Ligne | Pourquoi ce point précis |
|---|---|---|
| **Avant chaque nouvelle lecture** | `tracks-page.ts:293` — `this.revokeAudioUrl()` juste avant `createObjectURL` (`:294`) | Sans cela, chaque clic sur « Lire » ajouterait une entrée définitive dans la table : la mémoire croîtrait à chaque morceau écouté |
| **À la destruction du composant** | `tracks-page.ts:343-346` — `this.destroyRef.onDestroy(() => this.revokeAudioUrl())` | La toute **dernière** URL n'a, par construction, aucune lecture suivante pour la révoquer. Quitter `/tracks` pour `/profile` détruit le composant mais **pas** le document : sans ce hook, le dernier `Blob` resterait retenu indéfiniment |

Le second point est exactement ce que demande le sujet : « révoquer
l'`ObjectURL` finale à la destruction du composant ». C'est le cas qu'on oublie
le plus souvent, parce qu'il n'est visible dans aucun test fonctionnel — juste
dans un profileur mémoire.

L'implémentation (`tracks-page.ts:984-991`) est idempotente : elle sort
immédiatement si `audioUrl()` est vide (`:986`), et remet le Signal à `''` après
révocation (`:989`). Elle peut donc être appelée deux fois sans risque —
utile, car elle est aussi invoquée depuis d'autres chemins du composant.

`DestroyRef` est la façon moderne de faire, en Angular, ce qu'on écrivait avant
avec `implements OnDestroy` + `ngOnDestroy()`. Elle a l'avantage de placer
l'enregistrement du nettoyage juste à côté de la logique concernée (ici, dans le
constructeur, à la suite du pipeline de lecture) plutôt que dans une méthode
séparée en bas de la classe.
