# TP3 / Mission 6 — Progression de l'upload

Livrable TP3 : « progression d'upload ou, à défaut, état d'upload correctement
géré ». Cette mission demande aussi d'**expliquer pourquoi un upload avec
progression ne se traite pas exactement comme une requête qui n'émet qu'une
réponse finale** — c'est le §3 de ce document.

Le flux d'upload lui-même (choix du fichier, `FormData`, validation) est
documenté dans
[`../tp2/upload-et-lecture-audio.md`](../tp2/upload-et-lecture-audio.md) ; ce
document ne traite que la couche de progression ajoutée au TP3.

> **Numéros de ligne** : re-vérifiés sur le **code figé** (`tracks-page.ts` 1039
> lignes, `backend/src/app.js` 885 lignes). Tout changement ultérieur les décalera ;
> le **nom de la méthode ou de l'élément**, cité à côté, fait foi
> (`grep -n "nom" src/app/components/tracks-page/tracks-page.ts`).
> La confirmation de suppression est désormais un dialogue Material, voir
> [`suppression-de-piste.md`](./suppression-de-piste.md).

---

## 1. Tableau de repérage

| Élément demandé par le sujet | Fichier | Méthode / élément | Ligne |
|---|---|---|---|
| Demander les événements de progression | `src/app/shared/services/track.service.ts` | `observe: 'events'` + `reportProgress: true` | 44-45 |
| Le backend XHR est requis pour cela | `src/main.ts` | commentaire + `provideHttpClient(...)` **sans** `withFetch()` | 12-14 |
| Signal de progression | `src/app/components/tracks-page/tracks-page.ts` | `uploadProgress = signal<number \| null>(null)` | 206 |
| Calcul du pourcentage | `src/app/components/tracks-page/tracks-page.ts` | `event.loaded / event.total` | 546-549 |
| État indéterminé si `total` absent | `src/app/components/tracks-page/tracks-page.ts` | `else { uploadProgress.set(null) }` | 550-552 |
| La réussite (uniquement sur `Response`) | `src/app/components/tracks-page/tracks-page.ts` | `if (event.type !== HttpEventType.Response) return;` | 558 |
| L'échec | `src/app/components/tracks-page/tracks-page.ts` | callback `error` | 571-579 |
| Contrôles désactivés pendant l'envoi | `src/app/components/tracks-page/tracks-page.html` | `[disabled]="!canUpload()"` (bouton, :112), `[disabled]="uploading()"` (champ fichier, :28) | 28, 112 |
| Double soumission empêchée | `src/app/components/tracks-page/tracks-page.ts` | `if (this.uploading()) { ... return; }` | 505-508 |
| Affichage de la barre | `src/app/components/tracks-page/tracks-page.html` | `<progress>` déterminée / indéterminée | 118-139 |

---

## 2. Les quatre états demandés par le sujet

Le sujet exige de distinguer « l'absence d'upload en cours », « l'upload en
cours avec un pourcentage », « la réussite » et « l'échec ». Ces quatre états ne
sont **pas** un seul signal à quatre valeurs : ils se lisent dans la combinaison
de trois signaux, ce qui évite les états impossibles.

| État | `uploading()` | `uploadProgress()` | `uploadSuccess()` / `uploadError()` | Ce que voit l'utilisateur |
|---|---|---|---|---|
| **Aucun upload** | `false` | `null` | vides | bouton « Envoyer » actif, aucune barre |
| **En cours, indéterminé** | `true` | `null` | vides | barre `<progress>` sans valeur (animation), « Envoi en cours… » |
| **En cours, mesuré** | `true` | `0`–`100` | vides | barre remplie, « N % des octets transmis » |
| **Réussite** | `false` | `null` | succès renseigné | message de succès, formulaire vidé, liste rechargée |
| **Échec** | `false` | `null` | erreur renseignée | message d'erreur, **le fichier et le titre sont conservés** |

Le template lit ces états avec le contrôle de flux natif :
`@if (uploading())` pour la zone de progression (`tracks-page.html:118`), et à
l'intérieur `@if (uploadProgress() !== null)` pour choisir entre la barre
mesurée et la barre indéterminée (`:120` / `:131`).

### Pourquoi `number | null` et non `number`

`uploadProgress` est typé `signal<number | null>(null)` (`tracks-page.ts:206`).
Le `null` n'est pas une commodité : il signifie précisément **« en cours, mais
la progression n'est pas mesurable »**, ce qui est différent de `0`
(« mesurable, et rien n'est encore parti »).

Afficher `0 %` alors qu'on ne sait pas mesurer serait un mensonge : la barre
resterait figée à zéro pendant tout l'envoi, et l'utilisateur croirait que rien
ne se passe. À l'inverse, `null` déclenche une `<progress>` **sans attribut
`value`** (`tracks-page.html:132-135`), que le navigateur affiche comme une
animation indéterminée — le signal visuel universel de « ça travaille, durée
inconnue ».

Le signal est remis à `null` à toutes les sorties : au démarrage (`:269`, avec le
commentaire « aucun octet mesuré encore »), à la réussite (`:304`) et à l'échec
(`:315`).

### Accessibilité de la barre

La `<progress>` mesurée porte `aria-valuemin`, `aria-valuemax` et
`[attr.aria-valuenow]` (`tracks-page.html:126-128`), et un texte lisible double
l'information visuelle (`:130`). Une barre de progression sans équivalent textuel
n'est pas perceptible par un lecteur d'écran. Le libellé « **N % des octets
transmis** » est volontairement précis plutôt que « N % terminé » — voir §4.

---

## 3. Pourquoi un upload avec progression n'est pas une requête ordinaire

C'est la question explicitement posée par le sujet.

### Une requête ordinaire : un seul `next`

```ts
// AuthService.profile() — auth.service.ts:30-32
this.http.get<User>('/api/users/me')   // Observable<User>
```

Sans option d'observation, `HttpClient` renvoie un `Observable` **du corps de la
réponse**. Il émet `next(user)` une seule fois, à la fin, puis `complete()`.
C'est le cas le plus fréquent, et c'est aussi ce qui se passe pour le
téléchargement audio malgré son volume (voir
[`../tp2/questions-memoire-buffering-streaming.md` Q2](../tp2/questions-memoire-buffering-streaming.md)).

### Un upload avec progression : une suite d'événements de natures différentes

```ts
// TrackService.upload() — track.service.ts:38-47
this.http.post<Track>('/api/tracks', body, {
  observe: 'events',      // ← on n'observe plus le corps, mais le cycle de vie
  reportProgress: true,   // ← et on demande les étapes intermédiaires
});                       // Observable<HttpEvent<Track>>
```

Le type de retour change : `Observable<HttpEvent<Track>>` et non
`Observable<Track>`. L'Observable émet alors **plusieurs fois**, avec des objets
de natures différentes :

```text
Sent                    ← la requête part
UploadProgress          ← loaded: 65536,  total: 5242880
UploadProgress          ← loaded: 131072, total: 5242880
UploadProgress          ← … autant de fois que nécessaire
UploadProgress          ← loaded: 5242880, total: 5242880   (100 % des octets)
    ⟨ attente : le serveur écrit sur le disque et enregistre en base ⟩
Response                ← 201 Created, body = Track
complete()
```

**Trois conséquences pratiques, toutes visibles dans le code.**

**1. Il faut trier les événements.** Le callback `next` reçoit des objets
hétérogènes ; on ne peut plus supposer « `next` = j'ai le résultat ». D'où les
deux filtres successifs de `tracks-page.ts:543-558` : d'abord traiter
`UploadProgress` et sortir (`:543-554`), puis **ignorer tout ce qui n'est pas
`Response`** (`:558`). Sans ce second filtre, un événement `Sent` ferait croire à
une réussite et `event.body` serait `undefined`.

**2. Le corps est un cran plus profond.** Avec `observe: 'events'`, le `Track`
n'est plus l'événement : il est dans `event.body` (`:560`). C'est pourquoi le
code écrit `track?.id` et `track?.title ?? file.name` (`:561`, `:565`) — `body`
est typé nullable, car tous les événements n'en ont pas.

**3. L'état d'interface doit vivre pendant la requête.** Une requête ordinaire
n'a que deux états pour l'interface : avant, après. Un upload avec progression a
un état qui **évolue** entre les deux, il faut donc un signal dédié
(`uploadProgress`) mis à jour à chaque événement, et des contrôles verrouillés
pendant toute cette durée : le champ titre (`this.title.disable()`, `:533`), le
champ fichier (`tracks-page.html:28`) et le bouton (`:112`).

### Pourquoi `withFetch()` est proscrit ici

`src/main.ts:12-14` porte un commentaire explicite :

```ts
// Pas de withFetch() : le backend XHR est requis pour recevoir les
// événements de progression d'upload (HttpEventType.UploadProgress).
provideHttpClient(withInterceptors([authInterceptor, authErrorInterceptor])),
```

Par défaut, `HttpClient` s'appuie sur `XMLHttpRequest`. L'option `withFetch()`
le fait basculer sur l'API `fetch` du navigateur, plus moderne à d'autres
égards — mais **`fetch` n'expose pas la progression de l'envoi**. Elle donne
accès au flux de la *réponse* (`response.body`, en téléchargement), pas à
l'avancement du corps de la *requête*. `XMLHttpRequest`, lui, émet un événement
`progress` sur son `upload`, et c'est précisément ce qu'Angular traduit en
`HttpEventType.UploadProgress`.

**Conséquence concrète** : ajouter `withFetch()` ne provoquerait **aucune erreur
de compilation ni aucun test rouge évident**. Les événements `UploadProgress`
cesseraient simplement d'arriver, la barre resterait indéterminée, et la
fonctionnalité se dégraderait en silence. C'est exactement le genre de
régression que le commentaire dans `main.ts` sert à prévenir : sans lui, un
développeur suivant pourrait « moderniser » le code et casser la Mission 6 sans
s'en apercevoir.

---

## 4. Pourquoi 100 % d'octets transmis ≠ réussite

C'est le point le plus important de cette mission, et le plus contre-intuitif.

`tracks-page.ts:556-558` :

```ts
// Seul HttpEventType.Response prouve que le serveur a accepté la
// piste : 100 % d'octets envoyés n'est pas une réussite serveur.
if (event.type !== HttpEventType.Response) return;
```

### Ce que `UploadProgress` mesure exactement

`event.loaded / event.total` compte les **octets sortis du navigateur** : ce qui
a été écrit dans la socket réseau. Rien d'autre. En particulier, cela ne dit
rien sur :

- ce que le serveur a **fait** de ces octets ;
- s'il les a **acceptés** ;
- s'il a **répondu**.

### Tout ce qui peut encore échouer après 100 %

Quand le dernier octet est parti, le travail du serveur **commence** :

| Étape côté serveur | Où | Échec possible après 100 % |
|---|---|---|
| Multer vérifie le type MIME | `backend/src/app.js:358-371` | `400 { message: "Format audio non accepté" }` |
| Multer vérifie la taille | `backend/src/app.js:357` | `400` (`MulterError`, traité en `:861-866`) |
| Écriture du fichier sur le disque | `backend/src/app.js:335-348` | disque plein, permissions |
| Vérification de la présence du champ `audio` | `backend/src/app.js:619-623` | `400 { message: "Fichier audio requis" }` |
| Enregistrement en base | `backend/src/app.js:632-642` | MongoDB indisponible, erreur de validation |

Le cas du **type MIME** est le plus parlant : le `fileFilter` de Multer ne peut
statuer qu'après avoir reçu les en-têtes de la partie multipart, donc le
navigateur peut très bien avoir transmis 100 % d'un fichier qui sera refusé. La
barre atteint 100 %, et la réponse est un `400`.

Le backend gère même le cas où **l'écriture disque réussit mais MongoDB
échoue** : il supprime alors le fichier orphelin (`app.js:649-653`). C'est une
preuve supplémentaire que la fin du transfert n'est pas la fin de l'opération.

### Ce que le code fait en conséquence

- **Aucune déclaration de succès sur `UploadProgress`.** La branche de
  progression ne touche qu'à `uploadProgress` puis sort par `return` (`:553`).
  `uploading` reste `true`, `uploadSuccess` reste vide.
- **Tout ce qui signifie « c'est fini et réussi » est dans la branche
  `Response`** (`:287-296`) : `uploading` à `false`, message de succès,
  formulaire vidé, retour en page 1 et rechargement de la liste. Rien de tout
  cela n'arrive avant.
- **Le libellé de l'interface est honnête** : « N % **des octets transmis** »
  (`tracks-page.html:130`) et non « N % terminé ». Un utilisateur qui voit
  « 100 % terminé » suivi d'une erreur pense à un bug de l'application ; s'il a
  lu « 100 % des octets transmis », le message d'erreur qui suit reste cohérent.
- **Un test verrouille ce comportement** :
  `tracks-page.spec.ts:275`, « ne déclare PAS la réussite à 100 % des octets
  transmis (seul `Response` la prouve) ». C'est le test à montrer si la question
  est posée à l'oral.

> **La phrase à retenir** : la barre de progression décrit le **réseau**, pas le
> **résultat**. Elle dit « les octets sont partis », jamais « le serveur a dit
> oui ».

---

## 5. Gestion de l'échec : ce qui est conservé, ce qui est remis à zéro

`tracks-page.ts:571-579` :

```ts
error: (error: unknown) => {
  console.error('[TracksPage] Envoi impossible', error);
  this.uploading.set(false);
  this.uploadProgress.set(null);
  this.title.enable({ emitEvent: false });
  this.uploadError.set(this.serverMessage(error, 'Envoi impossible, réessayez.'));
},
```

| Élément | Après un échec | Pourquoi |
|---|---|---|
| `uploading` | `false` (`:314`) | sinon l'interface reste bloquée définitivement |
| `uploadProgress` | `null` (`:315`) | la barre disparaît ; laisser 87 % affiché serait trompeur |
| champ titre | **réactivé** (`:316`) | il avait été désactivé pendant l'envoi (`:274`) |
| titre saisi et fichier choisi | **conservés** | l'utilisateur n'a rien fait de mal : lui faire tout ressaisir après une coupure réseau serait une punition. Il peut recliquer « Envoyer » |
| message d'erreur | renseigné (`:317-319`) | via `serverMessage()` (`:486-495`), qui réutilise le `{ message }` français du backend |

Comparer avec la branche de **succès** : là, `resetUploadForm()` (`:308`) vide
le titre, le signal `file` et le champ fichier du DOM (`:433-440`). La règle est
donc : *on ne vide le formulaire que quand le serveur a confirmé.*

### Deux protections contre la double soumission

Le sujet exige « empêcher une seconde soumission ». Il y en a deux, en
profondeur :

1. **Dans le template** : `[disabled]="!canUpload()"` (`tracks-page.html:112`).
   `canUpload` est un `computed` (`tracks-page.ts:238-243`) qui exige trois
   conditions : rien en cours, un fichier choisi, et un titre valide. C'est le
   niveau visible, qui guide l'utilisateur.
2. **Dans la méthode** : `if (this.uploading()) { ...; return; }`
   (`:505-508`), commenté « double garde ». Ce niveau protège contre ce que le
   template ne voit pas : un double-clic très rapide avant le cycle de rendu, ou
   un appel programmatique.

Note de conception : `canUpload` dépend de la validité du `FormControl` du titre,
que Angular n'expose pas sous forme de signal. D'où la projection de
`statusChanges` via `toSignal()` (`tracks-page.ts:197-199`) — sans cela, le
`computed` ne se recalculerait jamais quand la validité du titre change.

---

## 6. Vérifications

### Tests automatisés (réellement exécutés)

`src/app/components/tracks-page/tracks-page.spec.ts:230-344` (bloc `describe('upload() — progression')`) contient **6 tests**
sur la progression :

| Test | Ligne | Ce qu'il verrouille |
|---|---|---|
| Convertit les événements `UploadProgress` en pourcentage | 246 | le calcul `loaded / total` |
| Reste en indéterminé (`null`) quand l'événement n'annonce pas de total | 260 | le `else` de `:550-552` — le cas qu'on oublie |
| **Ne déclare PAS la réussite à 100 % des octets transmis** | 275 | le cœur du §4 |
| Remet l'état à plat en cas d'échec | 301 | pas d'interface bloquée après une erreur |
| Ignore une seconde soumission pendant un envoi | 319 | la garde de `:505-508` |
| Refuse d'envoyer sans fichier et n'émet aucune requête | 333 | la garde de `:513-516` |

Ces tests n'ont besoin d'aucun backend : `HttpTestingController` permet d'émettre
à la main une séquence d'événements HTTP, y compris des `UploadProgress` avec des
valeurs choisies — ce qui serait très difficile à provoquer de façon reproductible
contre un vrai serveur. Voir
[`tests-automatises.md`](./tests-automatises.md).

### Vérifications API (exécutées en ligne de commande contre le backend)

| Vérification | Résultat réel |
|---|---|
| `POST /api/tracks` multipart avec `audio` + `title` | `201` |
| `POST /api/tracks` avec un fichier texte | `400 {"message":"Format audio non accepté"}` |
| `POST /api/tracks` sans fichier | `400 {"message":"Fichier audio requis"}` |

Les deux `400` sont la démonstration concrète du §4 : le transfert s'est terminé
normalement, et pourtant l'opération a échoué.

> Ces vérifications portent sur le contrat HTTP, en ligne de commande. Elles ne
> montrent **pas** la progression, qui n'existe que dans un navigateur.
