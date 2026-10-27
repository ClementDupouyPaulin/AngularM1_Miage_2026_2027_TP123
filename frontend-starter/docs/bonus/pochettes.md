# Bonus TP2 — Image de couverture : l'interface des pochettes

Option « AVANCÉ — Image de couverture » de `SUJET_ETUDIANT_TP2.md`. Ce document
décrit **l'interface** (le frontend) et son lien avec l'API. L'étude préalable
(tags ID3, services Web, droits d'usage, sécurité anti-SSRF) est dans
[`etude-id3-et-services-web.md`](./etude-id3-et-services-web.md) ; les défauts
trouvés à la relecture dans [`relecture-independante.md`](./relecture-independante.md).

Les deux approches proposées par le sujet sont réalisées :

1. **l'utilisateur envoie une image** (à l'upload d'une piste, ou plus tard avec
   « Changer la pochette ») ;
2. **l'application cherche sur le Web** (iTunes Search, via le backend) et
   récupère aussi l'image **embarquée dans les tags ID3** du fichier.

Chemins relatifs à `frontend-starter/` (frontend) ou à la racine du dépôt
(`backend/`). Le code est figé au moment de la rédaction ; chaque renvoi porte
aussi le nom de la fonction, qui reste la référence en cas d'écart.

---

## 1. Vue d'ensemble : qui fait quoi

| Élément | Fichier | Rôle |
|---|---|---|
| Page des pistes | `src/app/components/tracks-page/tracks-page.ts` (+ `.html`) | choix de l'image à l'upload, aperçu, actions « Changer / Chercher sur le Web / Retirer », état d'occupation |
| Affichage d'une pochette | `src/app/components/tracks-page/track-cover/track-cover.ts` | télécharge l'image **avec le JWT**, la montre via une `ObjectURL`, la libère |
| Recherche Web | `src/app/components/tracks-page/cover-search-dialog/cover-search-dialog.ts` | dialogue : **cherche** et **renvoie le candidat** choisi |
| Confirmation de retrait | `src/app/components/tracks-page/confirm-delete-dialog/confirm-delete-dialog.ts` | le même dialogue que la suppression de piste, avec `target: 'cover'` |
| Validation d'image | `src/app/components/tracks-page/cover-file.ts`, `file-extension.ts` | types, taille, extension (confort uniquement) |
| Appels HTTP | `src/app/shared/services/track.service.ts` | `cover()`, `setCover()`, `removeCover()`, `searchCover()`, `setCoverFromWeb()` ; `upload()` accepte une pochette |
| Modèles | `shared/models/track.model.ts`, `cover-search-result.model.ts`, `cover-candidate.model.ts` | `hasCover`, `coverSource`, candidats |
| Routes backend | `backend/src/app.js` | voir `API_CONTRACT.md` (lignes 18-22) |

Aucun composant n'injecte `HttpClient` : tout passe par `TrackService`, comme pour
le reste de l'application.

---

## 2. Choisir une pochette à l'upload (flux et aperçu)

```text
<input type="file" #coverInput> → chooseCover() → selectCover(file)
        → validateCoverFile(file)  — si refus : message, aucune sélection
        → coverFile.set(file) + coverPreviewUrl.set(URL.createObjectURL(file))
« Envoyer » → upload() → TrackService.upload(audio, titre, coverFile())
        → FormData : audio, title et, SI une image est choisie, cover
```

| Étape | Où |
|---|---|
| Champ « Pochette (facultatif) » | `tracks-page.html:67-100` |
| `chooseCover()` puis `selectCover()` | `tracks-page.ts:735-757` |
| Validation locale | `validateCoverFile()` (`cover-file.ts:24-40`) |
| Aperçu local | `coverPreviewUrl` (`tracks-page.ts:214`, créée en `:755`), `<img>` en `tracks-page.html:88-90` |
| Envoi avec la pochette | `this.service.upload(file, submittedTitle, this.coverFile())` (`tracks-page.ts:539`) |
| Champ `cover` du `FormData`, seulement si fourni | `track.service.ts:42` |
| Retirer l'image choisie | `clearCover()` (`tracks-page.ts:760-765`) |
| Remise à zéro après succès | `resetUploadForm()` appelle `clearCover()` (`tracks-page.ts:730`) |

### Pourquoi l'aperçu est une `ObjectURL`

L'image choisie est un `File` déjà **dans la mémoire du navigateur** : pas besoin
de la renvoyer au serveur pour l'afficher. `URL.createObjectURL(file)` produit une
URL locale qu'un `<img src>` peut lire. Même contrainte de mémoire que pour
l'audio (voir
[`../tp2/questions-memoire-buffering-streaming.md`](../tp2/questions-memoire-buffering-streaming.md),
Q5) : toute `ObjectURL` créée doit être **révoquée**.

### Révocation de l'aperçu sur **tous** les chemins

| Chemin | Où |
|---|---|
| remplacer l'image par une autre | `selectCover()` commence par `revokeCoverPreview()` (`tracks-page.ts:741`) |
| image invalide choisie après une valide | idem : l'aperçu précédent est libéré avant la validation, la sélection est vidée (`:742-750`) |
| « Retirer l'image » | `clearCover()` (`:761`) |
| envoi réussi | `resetUploadForm()` → `clearCover()` (`:730`) |
| destruction de la page | `destroyRef.onDestroy(… revokeCoverPreview())` (`:343-346`) |

Chacun est couvert par un test : « révoque l'aperçu et l'upload repart sans cover »
et « révoque l'aperçu à la destruction de la page » (`tracks-page.spec.ts`, bloc
« pochette optionnelle à l'upload »), puis deux tests de la relecture
indépendante (`tracks-page.review.spec.ts`, bloc « aperçu de la pochette choisie à
l'upload »).

### Ce que décide le backend

Une pochette envoyée avec la piste est **prioritaire** sur l'image ID3 ; sans
pochette envoyée, le backend lit l'image embarquée dans les tags
(`backend/src/app.js:625-630`). Le frontend n'a donc rien à décider : il envoie
`cover` ou non.

---

## 3. Afficher une pochette : `Blob` → `ObjectURL`, et pourquoi pas `<img src>` direct

### La contrainte

Le premier réflexe serait :

```html
<!-- NE FONCTIONNE PAS : 401 -->
<img [src]="'/api/tracks/' + track.id + '/cover'" />
```

C'est exactement le problème de l'audio : une balise `<img>` charge sa source **sans
passer par `HttpClient`**, donc sans l'intercepteur qui ajoute
`Authorization: Bearer …`. La route `GET /api/tracks/:id/cover` est protégée par
`auth` (`backend/src/app.js:734`) : elle répondrait `401`. Le raisonnement complet
est dans
[`../tp2/upload-et-lecture-audio.md`](../tp2/upload-et-lecture-audio.md) §4. Le
commentaire du composant le rappelle (`track-cover.ts:14-18`).

### La solution : `TrackCoverComponent`

```text
<app-track-cover [track] [version]>
   → TrackService.cover(id)  (GET /api/tracks/:id/cover, responseType: 'blob', JWT ajouté)
   → URL.createObjectURL(blob) → <img [src]="url()">
```

| Élément | Où |
|---|---|
| `service.cover(id)` en `responseType: 'blob'` | `track.service.ts:66-68` |
| Entrées : `track` (obligatoire) et `version` | `track-cover.ts:27-33` |
| Ce qui déclenche un rechargement : `{ id, hasCover, version }` | `request`, `track-cover.ts:38-43` |
| Chaîne RxJS (`toObservable` → `switchMap`) | `track-cover.ts:45-75` |
| Création de l'`ObjectURL` | `track-cover.ts:66` |
| `<img>` avec `alt` pertinent, et repli | `track-cover.html:1-12` |

Points de conception :

- **Pas de requête sans pochette.** Si `hasCover` est faux, `of(null)` : aucune
  requête, le visuel de remplacement (une note de musique) s'affiche
  (`track-cover.ts:53`). Test « n'émet aucune requête… ».
- **`switchMap`** : si la piste change avant la réponse, la requête périmée est
  **annulée** (`track-cover.spec.ts`, « annule la requête périmée… »).
- **Échec silencieux côté interface** : un `404` ou une erreur réseau donne le visuel
  de remplacement et une trace `console.warn` (`track-cover.ts:55-58`) ; aucun message
  d'erreur n'interrompt la lecture de la liste. Une image illisible malgré un `200`
  est traitée par `(error)="onImageError()"` (`track-cover.html:2`,
  `track-cover.ts:78-81`).
- **Accessibilité** : `alt="Pochette de <titre>"` (`track-cover.html:2`) ; pendant le
  chargement, le visuel porte `aria-busy` (`:4`).
- **Coût mémoire** : chaque card affichée télécharge sa pochette (2 Mo maximum côté
  backend). Une page de 20 pistes peut donc en charger 20. Voir la nuance dans
  [`../tp2/questions-memoire-buffering-streaming.md`](../tp2/questions-memoire-buffering-streaming.md)
  (Q3).

### Révocation côté affichage

| Chemin | Où |
|---|---|
| la demande change (autre piste, version, pochette retirée) | `tap(() => this.revoke())` avant la nouvelle requête (`track-cover.ts:48-50`) |
| image illisible | `onImageError()` → `revoke()` (`:80`) |
| destruction du composant | `inject(DestroyRef).onDestroy(() => this.revoke())` (`:74`) |

`revoke()` (`:83-88`) est idempotent : il sort si l'URL est vide. Tests :
« révoque l'ancienne ObjectURL quand la piste change », « libère l'image… quand la
pochette est retirée », « révoque l'ObjectURL à la destruction ». Quand une piste est
supprimée, la page libère aussi sa pochette (test « la suppression d'une piste libère
l'ObjectURL de sa pochette »).

### La clé de version

Après un remplacement de pochette, la **route ne change pas** : c'est toujours
`GET /api/tracks/<id>/cover`, avec des octets différents. Un composant qui ne
réagirait qu'à l'identifiant ne rechargerait donc jamais l'image. D'où l'entrée
`version` : un compteur par piste (`coverVersions`, `tracks-page.ts:225`) incrémenté
par la page après chaque modification (`coverUpdated`, `:946-949`) et passé au
composant (`tracks-page.html:237`).

À l'inverse, la comparaison personnalisée de `computed` (`track-cover.ts:40-42`) ne
compare que `id`, `hasCover` et `version` : un **nouvel objet `Track` sans
changement de pochette** (par exemple après un rechargement de la liste) ne relance
**pas** de téléchargement. Test « ne recharge pas pour un nouvel objet Track sans
changement de pochette ».

---

## 4. Modifier une pochette depuis une card

Chaque card propose trois actions (`tracks-page.html:300-331`, groupe nommé
« Pochette de <titre> ») : **Changer la pochette**, **Chercher sur le Web**, et
**Retirer la pochette** (seulement si `track.hasCover`).

### 4.1 Changer la pochette (image locale)

`pickCover()` (`tracks-page.ts:790-794`) ouvre un **sélecteur de fichier unique et
partagé** pour toute la liste (`#coverPicker`, `tracks-page.html:375-381`) et
mémorise la piste visée (`coverTarget`). `onCoverPicked()` (`:796-803`) transmet le
fichier à `changeCover()` (`:806-824`) :

1. refuse localement une image invalide avec un message, **sans requête** (`:809-814`) ;
2. sinon `PUT /api/tracks/:id/cover` en multipart (`TrackService.setCover()`,
   `track.service.ts:71-75`) ;
3. à la réponse, `coverUpdated()` (voir §4.4).

Un seul sélecteur pour N cards évite de créer N éléments `<input type="file">` ; le
revers est l'état partagé `coverTarget`, remis à zéro dès la sélection (`:801`).

### 4.2 Retirer la pochette, avec confirmation

`removeCover()` (`tracks-page.ts:827-862`) ouvre le **même dialogue** que la
suppression de piste, avec `data: { title, target: 'cover' }` (`:835`).
`ConfirmDeleteDialogComponent` affiche alors « Retirer la pochette ? » et précise
que « le morceau reste dans votre bibliothèque »
(`confirm-delete-dialog.html:1-21`). Même rôle `alertdialog`, mêmes options de
focus que la suppression de piste. Seul un clic sur « Retirer » ferme avec `true`
(`:849-856`) ; Annuler, Échap ou un clic extérieur n'envoient **aucune** requête
(test « annuler le retrait de pochette n'émet aucune requête »).

Si l'utilisateur confirme : `deleteCover()` (`:864-878`) → `DELETE
/api/tracks/:id/cover` (`TrackService.removeCover()`, `track.service.ts:78-80`) →
`204` **sans corps** : la piste est mise à jour **localement** en
`{ ...track, hasCover: false, coverSource: null }`.

### 4.3 Chercher sur le Web, et pourquoi le dialogue ne fait que chercher

`searchCover()` (`tracks-page.ts:881-915`) ouvre `CoverSearchDialogComponent` avec
`{ trackId, title }`.

**Décision d'architecture : le dialogue cherche et renvoie le candidat ; c'est la
page qui applique la pochette.** Le dialogue se ferme avec le `CoverCandidate`
choisi (`cover-search-dialog.ts:107-110`), puis la page appelle
`applyWebCover()` → `TrackService.setCoverFromWeb(track.id, candidate.imageUrl)`
(`tracks-page.ts:908`, `:917-926`). Pourquoi ce découpage :

| Raison | Détail |
|---|---|
| **Une seule porte d'entrée pour les modifications** | `coverUpdated()` et `coverFailed()` (SnackBar, version, remplacement dans la liste, resynchronisation sur `404`) existent **une fois**, dans la page. Si le dialogue appliquait lui-même, il faudrait les dupliquer ou les lui injecter |
| **L'état d'occupation appartient à la page** | `coverBusyId`, `coverDialogOpen` et `deletingId` sont des signaux de la page ; le dialogue ne les connaît pas |
| **Testabilité** | le dialogue se teste avec un simple double de `TrackService.searchCover` ; la page se teste sans ouvrir de dialogue réel |
| **Séparation lecture / écriture** | le dialogue ne fait que de la **lecture** (une recherche, sans effet sur les données) ; l'écriture (`POST …/cover/web`) reste décidée à un seul endroit |

Fonctionnement du dialogue :

- **La recherche ne part qu'à l'ouverture, ou sur « Réessayer »** : le constructeur
  appelle `this.search()` (`cover-search-dialog.ts:94`) ; il n'y a **aucune** autre
  source. Elle est donc déclenchée par un clic explicite sur « Chercher sur le Web »
  (`tracks-page.html:314`), jamais automatiquement à l'upload. Test « appelle
  searchCover une seule fois, à l'ouverture ».
- **`switchMap`** (`:68`) : un « Réessayer » rapide annule la requête en vol.
- **Erreurs** (`errorMessage()`, `:112-124`) : un `502` (service iTunes indisponible)
  donne « Le service de recherche de pochettes (iTunes) est momentanément
  indisponible. Réessayez dans un instant. » avec un bouton **« Réessayer »**
  (`cover-search-dialog.html:17-21`). Les `404`, `401` et le statut `0`
  (« Serveur injoignable ») ont chacun leur message. Test « traduit un 502 en
  message compréhensible et permet de réessayer ».
- **Sélection puis confirmation** : cliquer un candidat ne fait que le sélectionner
  (`aria-pressed`, `cover-search-dialog.html:36`) ; « Utiliser cette pochette »
  (`:61`) est désactivé tant qu'aucun candidat n'est retenu. Fermer par Échap ou
  « Annuler » ne renvoie rien : la page n'émet **aucune** requête (tests « Échap
  ferme le dialogue sans candidat » et « fermer la recherche sans choix n'émet
  aucune requête »).
- **Annonce lecteur d'écran** : `announcement()` (`:49-56`) alimente une région
  `role="status" aria-live="polite"` (`cover-search-dialog.html:9`) : « 3 pochettes
  trouvées. », « Aucune pochette trouvée. ».
- **Attribution toujours affichée** : `found.attribution` (`:55`), y compris quand il
  n'y a aucun résultat (test « signale l'absence de résultat et affiche quand même
  l'attribution »). Les pochettes restent la propriété de leurs ayants droit.

### Les miniatures viennent directement d'Apple

Dans le dialogue, chaque candidat est un `<img [src]="candidate.imageUrl">`
(`cover-search-dialog.html:39-46`) : **le navigateur charge ces miniatures lui-même,
depuis `*.mzstatic.com`**, sans passer par `HttpClient` ni par notre serveur. C'est
possible parce que ces images sont publiques (pas de JWT à joindre). Deux
conséquences à connaître :

- l'adresse IP de l'utilisateur est vue par l'hébergeur d'images **au moment où il
  ouvre la recherche** (action explicite, jamais en arrière-plan). L'attribut
  `referrerpolicy="no-referrer"` (`:45`) évite d'envoyer en plus l'adresse de
  l'application. Test « n'envoie pas de référent aux serveurs d'images tiers »
  (`cover-search-dialog.review.spec.ts`) ;
- ce qui est **enregistré** (la copie dans `data/uploads/covers`) est téléchargé par
  le **backend**, pas par le navigateur, après validation (liste blanche d'hôtes,
  octets magiques, 2 Mo). La question des conditions d'usage d'Apple porte sur cette
  copie : voir [`etude-id3-et-services-web.md`](./etude-id3-et-services-web.md) §5.

### 4.4 Remplacement en place dans la liste

`coverUpdated()` (`tracks-page.ts:941-951`) est appelée après **chaque** modification
réussie :

```ts
this.coverBusyId.set('');
this.tracks.update((tracks) => tracks.map((t) => (t.id === updated.id ? updated : t)));
if (this.playingTrack()?.id === updated.id) this.playingTrack.set(updated);
this.coverVersions.update((v) => ({ ...v, [updated.id]: (v[updated.id] ?? 0) + 1 }));
this.snackBar.open(message, 'Fermer', { duration: 4000 });
```

Le commentaire de la méthode dit pourquoi : **ni rechargement complet, ni changement
de page.** On remplace la piste modifiée par la réponse du serveur, on incrémente sa
clé de version et on affiche un SnackBar. Un rechargement coûterait une requête de
plus et pourrait faire sauter l'utilisateur de page ou perdre son filtre. Tests
« remplacement en place, sans rechargement » et « sans saut de page ».

Si la piste a **disparu entre-temps** (`404`), `coverFailed()` (`:953-964`) affiche
« Piste introuvable ou déjà supprimée. » et **resynchronise** la liste (`this.load()`,
`:963`) : c'est ici qu'un rechargement est justifié. Test « un 404 (piste disparue)
affiche un message et resynchronise la liste ».

---

## 5. Anti double-clic et accessibilité de l'état d'occupation

| Mécanisme | Où |
|---|---|
| `coverBusyId` : identifiant de la piste dont la pochette est en cours de modification | `tracks-page.ts:220` |
| `isCoverLocked()` : une seule opération à la fois, **ni pendant une suppression**, ni pendant qu'un dialogue est ouvert (`coverDialogOpen`) | `tracks-page.ts:929-935`, `:229` |
| Chaque action commence par `if (this.isCoverLocked()) return;` | `:791`, `:807`, `:828`, `:882` |
| Boutons désactivés pendant l'opération | `tracks-page.html:305`, `:315`, `:326` |
| `aria-busy` sur le bouton concerné **et** sur la card | `tracks-page.html:306`, `:316`, `:327`, `:234` |
| La suppression de piste est elle aussi bloquée pendant une opération de pochette | `tracks-page.ts:591` |

Pourquoi deux protections : le bouton `disabled` guide l'utilisateur ; la garde
`isCoverLocked()` couvre ce que le template ne voit pas (double-clic avant le cycle de
rendu, appel programmatique). C'est le même principe que `deletingId` pour la
suppression. Tests « ignore les doubles clics pendant une opération et désactive les
boutons (aria-busy) » et « ignore un second « Chercher sur le Web » tant que le
dialogue est ouvert ».

---

## 6. Validation des images : confort côté frontend, autorité côté backend

`validateCoverFile()` (`cover-file.ts:24-40`) refuse : un type hors JPEG/PNG/WebP
(avec repli sur l'extension quand `File.type` est vide), un fichier vide, un fichier
de plus de 2 Mo. Elle s'appuie sur `fileExtension()` (`file-extension.ts:6-9`), qui
renvoie `''` pour un nom **sans point** : sans cette précaution, `slice(-1)`
renverrait le dernier caractère du nom (message « Image non acceptée (e) »). C'était
un défaut trouvé à la relecture : voir
[`relecture-independante.md`](./relecture-independante.md).

Le backend ne se fie **pas** au `Content-Type` déclaré : il identifie JPEG, PNG ou
WebP par les **octets magiques** (`backend/src/app.js:92-102`, `storeCover()`
`:105-116`). Un fichier texte envoyé avec `Content-Type: image/png` est refusé
(`400`). La validation frontend n'est qu'un **retour immédiat** ; elle est
contournable par construction (même argument que pour l'audio :
[`../tp2/upload-et-lecture-audio.md`](../tp2/upload-et-lecture-audio.md) §6).

Un SVG est volontairement **refusé** (`cover-file.review.spec.ts` : « SVG (vecteur de
script) », « SVG sans type MIME ») : une image SVG peut contenir du script.

---

## 7. Accessibilité des cards et des dialogues

- Image de pochette : `alt="Pochette de <titre>"` ; visuel de remplacement
  décoratif (`aria-hidden`) ; états `aria-busy`.
- Groupe d'actions nommé : `role="group"` + `aria-label="Pochette de <titre>"`
  (`tracks-page.html:300`) ; chaque bouton a un `aria-label` qui nomme la piste
  (`:307`, `:317`, `:328`).
- La source de la pochette est annoncée : « Source de la pochette : Tags ID3 / Importée /
  Web (iTunes) » (`tracks-page.html:256-260`, `COVER_SOURCE_LABELS` dans
  `tracks-page.ts`).
- Dialogues Material : titre, description liée (`ariaDescribedBy`), `autoFocus`,
  `restoreFocus: true` (le focus revient au bouton d'origine).
- Données issues des tags ID3 ou d'iTunes (titre, artiste, album) : **traitées comme
  du texte**, jamais comme du HTML (tests « affiche titre, artiste et album hostiles
  comme du texte », « ne laisse aucun schéma `javascript:` dans les `<img src>` »).

> **Non vérifié par un test** : le **piégeage du focus** dans les dialogues (Tab qui
> ne sort pas du dialogue). Les tests couvrent la fermeture (Échap, boutons) mais pas
> la navigation au clavier à l'intérieur. À vérifier à la main.

---

## 8. Vérifications

### Tests automatisés (frontend)

| Fichier | Tests |
|---|---|
| `track-cover/track-cover.spec.ts` | 9 : pas de requête sans pochette, `alt`, révocation, annulation, version, nouvel objet sans rechargement, retrait, destruction, `404` |
| `cover-search-dialog/cover-search-dialog.spec.ts` | 6 : une recherche à l'ouverture, `502` + réessayer, aucun résultat, candidats + attribution, confirmation, Échap |
| `cover-search-dialog/cover-search-dialog.review.spec.ts` | 3 : pas de `javascript:`, texte hostile, pas de référent |
| `cover-file.review.spec.ts` | 11 : types acceptés et refusés (SVG, GIF, `.exe`…), 2 Mo à l'octet près, fichier vide, « type inconnu » |
| `tracks-page.spec.ts` | blocs « pochette optionnelle à l'upload », « affichage des métadonnées de pochette », « actions de pochette sur une card » |
| `tracks-page.review.spec.ts` | aperçu (`ObjectURL`) à l'upload ; rendu non fiable des tags |
| `track.service.spec.ts` | `cover()`, `setCover()`, `removeCover()`, `searchCover()`, `setCoverFromWeb()`, `cover` dans `upload()` |

### Vérifications réelles contre l'API (ligne de commande, serveur + MongoDB Atlas + iTunes)

Annoncées par l'orchestrateur, **non rejouées par l'agent de documentation** :
`PUT` d'un PNG → `200` et `coverSource` « upload » ; `GET` → `200` `image/png` ;
texte déguisé en `image/png` → `400` ; image de plus de 2 Mo refusée ; pochette
d'autrui → `404` sur `GET`, `PUT`, `DELETE` ; upload audio + pochette en une requête ;
`DELETE` → `204` puis `GET` → `404` ; recherche iTunes réelle (12 candidats, hôte
`is1-ssl.mzstatic.com`) ; `POST …/cover/web` avec téléchargement réel → `200`,
`coverSource` « web » ; sept URL SSRF refusées. Détail dans
[`preuves-integration-reelle.md`](./preuves-integration-reelle.md).

> Ces preuves valident le **contrat HTTP**, pas l'interface.
