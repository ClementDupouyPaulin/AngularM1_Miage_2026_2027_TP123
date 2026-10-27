# Comprendre Film Pulse — le guide de l'étudiant

> Ce document t'explique **ce qui a été construit, comment ça marche et pourquoi**, avec le
> niveau d'un étudiant de Master 1 informatique. Il sert aussi de préparation à l'oral : la
> dernière partie liste les questions probables. Les autres documents (`REPORT.md`,
> `film-pulse-guide.md`, `API_CONTRACT.md`) sont plus factuels ; celui-ci est pédagogique.

## Sommaire

1. [L'idée en deux minutes](#1-lidée-en-deux-minutes)
2. [Vue d'ensemble : qui fait quoi](#2-vue-densemble--qui-fait-quoi)
3. [Les algorithmes, pas à pas](#3-les-algorithmes-pas-à-pas)
4. [Le backend et la sécurité](#4-le-backend-et-la-sécurité)
5. [Les notions Angular à connaître](#5-les-notions-angular-à-connaître)
6. [Les tests : quatre niveaux](#6-les-tests--quatre-niveaux)
7. [Comment le travail a été mené avec l'IA](#7-comment-le-travail-a-été-mené-avec-lia)
8. [Ce qui a été fait juste avant le rendu](#8-ce-qui-a-été-fait-juste-avant-le-rendu)
9. [Les limites, dites honnêtement](#9-les-limites-dites-honnêtement)
10. [Questions probables à l'oral](#10-questions-probables-à-loral)
11. [Glossaire](#11-glossaire)
12. [Checklist du rendu](#12-checklist-du-rendu)

---

## 1. L'idée en deux minutes

Un film est une suite de **plans** (une prise de vue continue) séparés par des **coupes**
(le moment où l'image change brusquement). Le nombre de coupes par minute donne le
**rythme de montage** : un film d'action coupe toutes les secondes, un film contemplatif
garde un plan 20 secondes.

**Film Pulse** mesure ce rythme et l'affiche comme un électrocardiogramme.

```
  extrait vidéo ──► analyse dans le navigateur ──► JSON « analyse »
   (MP4/WebM)        (canvas + Web Worker)            │
                                                      ▼
   écran : timeline, stats, palette  ◄──────  API Express + MongoDB
```

Ce que l'analyse produit :

| Donnée | Signification |
|---|---|
| `cuts` | instants (s) des coupes |
| `transitions` | coupes **et** fondus (changement progressif) |
| `beats` | instants des temps forts de la musique (si la vidéo a une piste audio) |
| `syncScore` | les coupes tombent-elles sur les temps forts ? (≈ 1 = hasard, > 1,25 = calé) |
| `palette` | couleur dominante de chaque seconde |
| `diffs` | différence d'image à image (la donnée brute, voir §3) |
| pellicule | une image JPEG contenant ≤ 41 vignettes de l'extrait |

Le projet est un **mini-projet libre** du TP4 : il s'ajoute au projet des TP1 à TP3
(*Guitar Practice Cloud*, gestion de pistes audio) sans le casser. La page « Bandes-son »
est l'ancien projet ; elle fournit les musiques.

---

## 2. Vue d'ensemble : qui fait quoi

### 2.1 Le parcours d'un utilisateur, et le code qui le porte

| Étape | Page (route) | Composant principal | Service / API |
|---|---|---|---|
| Se connecter | `/login` | `login-page` | `AuthService` → `POST /api/auth/login` |
| Importer et analyser | `/clips` (Studio) | `clips-page` | `ClipAnalyzerService` (navigateur) puis `ClipService.create` → `POST /api/clips` |
| Régler la sensibilité | `/clips/:id` | `clip-detail` | `redetect()` (navigateur, sans réseau) puis `PUT /api/clips/:id/analysis` |
| Annoter | `/clips/:id` | `clip-detail` | `POST /api/clips/:id/annotations` |
| Partager | `/clips/:id` | `share-dialog` | `PATCH /api/clips/:id` (`visibility`, `sharedWith`) |
| Comparer | `/clips/compare` | `clip-compare` | deux `GET /api/clips/:id` |
| Découvrir | `/discover` | `discover-page` | `GET /api/clips/discover` |
| Amis et activité | `/friends` | `friends-page` | `/api/friends`, `/api/activity` |

### 2.2 Arborescence commentée

```
backend/
  src/app.js              toutes les routes Express + validation + règle d'accès
  src/models/             Clip, Friendship (nouveaux) ; Track, User (TP1-3)
  test/                   tests node:test (API simulée par fake-mongo.js)
frontend-starter/
  src/app/shared/analysis/    algorithmes PURS (aucun DOM) : cut-detector, beat-detector,
                              transitions, palette, tempo, sync-score, rhythm, redetect
  src/app/shared/services/    clip-analyzer (vidéo/audio/canvas), clip, friend, activity,
                              analysis.worker (calcul des beats hors du thread principal)
  src/app/shared/models/      types TypeScript du contrat d'API (source de vérité du front)
  src/app/components/         une page ou un widget par dossier
  e2e/                        tests Playwright sur de vraies vidéos
```

**Principe d'architecture à retenir : séparer le calcul de l'interface.** Les algorithmes
sont des fonctions pures (`entrée → sortie`, sans `<video>` ni `<canvas>`). On les teste avec
des tableaux de nombres fabriqués, sans navigateur. Seule `clip-analyzer.service.ts` touche
au DOM (extraire les pixels, décoder l'audio).

### 2.3 Pourquoi analyser dans le navigateur ?

- Pas besoin d'installer `ffmpeg` sur un serveur.
- Le serveur ne reçoit qu'un petit JSON (< 1 Mo) en plus de la vidéo.
- Contre-partie : **le client peut mentir**. Le backend ne fait donc pas confiance à ce JSON
  (voir §4.3).

---

## 3. Les algorithmes, pas à pas

Tout est dans `frontend-starter/src/app/shared/analysis/`. Chaque fonction a un fichier
`.spec.ts` à côté avec ses tests.

### 3.1 Échantillonner la vidéo

On ne lit pas la vidéo en continu. Pour chaque instant `t = i / 10` (10 images par seconde,
`SAMPLE_FPS`), on déplace la tête de lecture (`video.currentTime = t`, un *seek*), on attend
l'événement `seeked`, puis on dessine l'image dans un `<canvas>` de **64 × 36 pixels** et on lit
les pixels avec `getImageData`. Réduire l'image rend le calcul très rapide et élimine le bruit.

### 3.2 Différence entre deux images (`frameDifference`)

Fichier `cut-detector.ts`. Idée : une coupe change **tout** le contenu de l'image ; un
mouvement de caméra n'en change qu'une partie, qui *se déplace*.

1. Chaque pixel est converti en **luminance** (clarté) : `0,299·R + 0,587·G + 0,114·B`
   (formule Rec. 601 : l'œil est plus sensible au vert).
2. L'image 64 × 36 est découpée en **blocs de 16 × 12 pixels** (16 blocs).
3. Pour chaque bloc de l'image B, on cherche dans l'image A le bloc le plus ressemblant, **en
   autorisant un décalage de ± 4 pixels** : c'est un mini *block matching*, la même idée que
   la compression vidéo. Un bloc qui a juste bougé retrouve son jumeau → différence faible.
4. On moyenne l'écart sur tous les blocs et on divise par 255 → un nombre entre 0 et 1.

Résultat : `diffs[i]` = différence entre l'image `i` et `i+1`. Exemples d'ordres de grandeur :
plan fixe ≈ 0,00–0,02 ; mouvement de caméra ≈ 0,03–0,10 ; **coupe ≈ 0,3–0,6**.

> *Pourquoi pas un histogramme de couleurs ?* C'était la première version (phase 1). Elle
> donnait 50 % de rappel et 44 % de précision sur la bande-annonce de test : deux plans
> différents mais de même ambiance de couleur ne se distinguaient pas. La comparaison spatiale
> par blocs corrige ça (voir §8).

### 3.3 Décider qu'un pic est une coupe (`detectCuts`)

Un seuil **fixe** (« coupe si diff > 0,2 ») échoue : dans une scène d'action, tout bouge
beaucoup ; dans un dialogue, presque rien. Il faut un seuil **local et adaptatif**.

Pour chaque image `i` (`cutThresholds`) :

```
niveau    = médiane des diffs dans ± 1 s autour de i (en excluant les 2 voisins immédiats)
écart     = MAD = médiane des |diff − niveau|           (« écart absolu médian »)
seuil[i]  = max( 0,04 ,  niveau + k × max(écart, 0,02) )        avec k = 4 par défaut
```

**Exemple chiffré.** Autour de l'image 83, la médiane locale est 0,02 et la MAD 0,01. Comme
0,01 < 0,02 on utilise 0,02 (`MIN_DEVIATION`). Seuil = 0,02 + 4 × 0,02 = **0,10**. Une
différence de 0,45 dépasse largement 0,10 : c'est une coupe candidate. Un mouvement à 0,07, non.

*Pourquoi médiane + MAD plutôt que moyenne + écart-type ?* Parce que la coupe elle-même est
une valeur extrême : elle gonflerait la moyenne et l'écart-type et relèverait son propre
seuil. Médiane et MAD sont **robustes aux valeurs aberrantes**. On exclut aussi les voisins
immédiats pour la même raison.

Trois filtres s'ajoutent (tous dans `detectCuts`) :

1. **Dominance** : le pic doit être le maximum dans ± 0,2 s (`minGapSec`) — sinon une seule
   coupe étalée sur 2 images serait comptée deux fois.
2. **Seuil absolu** `minDiff = 0,04` : sur un plan parfaitement fixe, la MAD est nulle et le
   moindre bruit passerait.
3. **Artefact d'une image isolée** (`isStillShotArtifact`) : sur plan fixe, un flash d'une
   seule image (artefact d'encodage) donne *deux* grandes différences consécutives puis un
   retour au calme. Une vraie coupe, elle, ne laisse qu'**un** pic. C'est ce qui a supprimé les
   fausses coupes sur la vidéo « méduse ».

Le coefficient **k** est le curseur de **sensibilité** (1 à 6) : plus k est petit, plus on
détecte de coupes. Le défaut `k = 4` a été choisi en **mesurant** (voir §3.8).

### 3.4 Détecter les fondus (`detectTransitions`)

Un fondu enchaîné est une suite d'images avec des différences **modérées mais soutenues** :
chaque différence est trop faible pour être une coupe, mais elles s'additionnent. Fichier
`transitions.ts` : on cherche ≥ 3 images consécutives au-dessus de « moyenne + 1σ » (calculée
sans les coupes, sinon elles gonfleraient σ) et sous le seuil de coupe, dont la **somme**
dépasse 0,35, sans coupe à l'intérieur. Un fondu est daté au centre de sa fenêtre.

### 3.5 Re-détecter sans relire la vidéo (`redetect`)

Comme `diffs` est **enregistré** dans l'analyse, changer le curseur k ne demande pas de
relire la vidéo : `redetect(diffs, fps, k)` recalcule `cuts` et `transitions` en quelques
millisecondes. C'est un bon exemple de **séparation mesure / interprétation** : on stocke la
mesure brute (coûteuse), on recalcule l'interprétation (gratuite).

### 3.6 La musique : beats, tempo, synchronisation

**Beats** (`beat-detector.ts`) : on décode l'audio (`decodeAudioData`) puis, par fenêtres de
20 ms, on calcule l'énergie **RMS** (racine de la moyenne des carrés). Le **flux** est la
*hausse* d'énergie d'une fenêtre à la suivante (une attaque de note). Un beat est un pic de
flux supérieur à 1,5 × la moyenne locale (sur 1 s) et espacé d'au moins 0,25 s des autres.
Ce calcul est lourd : il tourne dans un **Web Worker** (un thread séparé) pour ne pas figer
l'interface.

**Tempo** (`tempo.ts`) : on prend les intervalles entre beats, on les convertit en BPM
(`60 / intervalle`), on les « replie » dans 70–180 BPM (on double ou divise par 2 : un
tempo de 40 est presque sûrement 80), puis on garde le **pic d'un histogramme** (fenêtre
± 2 BPM). C'est un vote : peu sensible aux beats manqués ou en trop.

**Score de synchronisation** (`sync-score.ts`) :

```
hitRate    = part des coupes situées à ± 0,08 s d'un beat
chanceRate = part de la durée couverte par les fenêtres [beat ± 0,08 s]   (le « hasard »)
score      = hitRate / chanceRate          (plafonné à 10)
```

**Exemple chiffré.** Extrait de 10 s, beats toutes les 0,5 s (19 beats), 3 coupes à 2,0 s,
5,0 s et 8,1 s. Les deux premières sont sur un beat, la troisième est à 0,1 s du beat le plus
proche (> 0,08) : `hitRate = 2/3 = 0,67`. Les 19 fenêtres de 0,16 s couvrent 3,04 s sur 10 :
`chanceRate = 0,30`. Score = 0,67 / 0,30 ≈ **2,2** : les coupes tombent sur la musique 2,2
fois plus que le hasard ne le prédirait.

*Pourquoi diviser par le hasard ?* Avec une musique très dense en beats, presque n'importe
quelle coupe tombe près d'un beat. Normaliser par la couverture rend le score **comparable**
entre extraits : ≈ 1 = aucun lien, `SYNC_ALIGNED_THRESHOLD = 1,25` = « calé ».

### 3.7 Profil de rythme (`rhythm.ts`)

`n` coupes découpent l'extrait en `n + 1` plans. **ASL** (*Average Shot Length*) =
`durée / (n + 1)`. Exemple : 60 s et 15 coupes → 16 plans → ASL = 3,75 s. L'étiquette
vient de paliers :

| ASL (s) | ≥ 8 | ≥ 4 | ≥ 2,5 | ≥ 1,2 | sinon |
|---|---|---|---|---|---|
| Profil | Contemplatif | Posé | Soutenu | Nerveux | Frénétique |

Ici 3,75 s → **Soutenu**. La médiane des durées de plan est aussi affichée : elle résiste
mieux qu'une moyenne à un seul plan très long.

### 3.8 Comment on sait que la détection est bonne (et pas seulement « elle semble bonne »)

On a établi **à la main une vérité terrain** : en regardant des images de la bande-annonce
Sintel, on a relevé les vraies coupes (il n'y en a que 8 ; le reste sont des fondus). Le
test `e2e/detection-quality.spec.ts` mesure :

- **rappel** = vraies coupes retrouvées / vraies coupes (peu d'oublis) ;
- **précision** = vraies coupes parmi les coupes annoncées (peu de fausses alertes).

Avant : rappel 0,50 et précision 0,44. Après le nouvel algorithme : **rappel 0,88 et
précision 1,00** sur la bande-annonce, et zéro fausse coupe sur la vidéo « méduse ». Le détail
est dans `REPORT.md`, section « Qualité de la détection ».

> **Attention à citer honnêtement :** le réglage repose sur **3 vidéos**. Il y a donc un
> risque de *surapprentissage* (réglé pour ces vidéos-là). Dis-le à l'oral avant qu'on te le
> demande.

---

## 4. Le backend et la sécurité

### 4.1 Les ressources

| Ressource | Rôle |
|---|---|
| `Clip` | titre, fichier vidéo sur disque, `analysis` (JSON), pellicule, étiquettes, `visibility` (`private`/`shared`/`public`), `sharedWith`, annotations |
| `Friendship` | une demande d'amitié et son état (en attente / acceptée) |
| `/api/activity` | fil construit à partir des clips d'amis et des annotations reçues |

Les routes complètes (méthode, URL, corps, codes d'erreur) sont dans `API_CONTRACT.md`.

### 4.2 La règle d'accès — le cœur de la sécurité

Dans `backend/src/app.js`, fonction `canReadClip` :

```js
async function canReadClip(clip, userId) {
  if (String(clip.ownerId) === String(userId)) return true;     // je suis le propriétaire
  if (clip.visibility === "public") return true;                // tout le monde
  if (clip.visibility !== "shared") return false;               // privé : non
  if (!clip.sharedWith.some(id => String(id) === String(userId))) return false; // pas invité
  return areFriends(clip.ownerId, userId);   // amitié ENCORE acceptée, vérifiée maintenant
}
```

Points à savoir expliquer :

- **L'amitié est revérifiée à chaque lecture.** Si le propriétaire retire un ami, l'accès
  disparaît aussitôt, même si l'identifiant est resté dans `sharedWith`.
- Un clip inaccessible renvoie **`404 « Clip inconnu »`**, jamais `403`. Avec un `403`, un
  attaquant apprendrait qu'un clip existe. Le `404` ne distingue pas « n'existe pas » de « tu
  n'y as pas droit ».
- Cette classe de faille (accéder à la ressource d'un autre en changeant l'identifiant dans
  l'URL) s'appelle **IDOR** (*Insecure Direct Object Reference*). C'est la n° 1 à vérifier
  dans toute API. Les deux revues indépendantes en ont fait leur priorité : **aucune IDOR
  trouvée**.

### 4.3 Ne jamais faire confiance au client

| Risque | Parade dans le code |
|---|---|
| Le client envoie un faux `cutCount` ou un faux `syncScore` pour monter au classement | le serveur **recalcule** `cutCount`, `avgShotLength`, `syncScore`, `sparkline` à partir de `cuts`/`beats` |
| JSON d'analyse gigantesque ou malformé | validation stricte : clés connues, `diffs` ≤ 1300 valeurs dans [0,1], tableaux triés et bornés, `sensitivity` ∈ [1,6] |
| Faux fichier (un `.txt` renommé `.mp4`) | vérification des **octets magiques** (en-tête du fichier), pas seulement de l'extension ou du `Content-Type` annoncé |
| Savoir si un e-mail a un compte (énumération) | `POST /friends/requests` répond **toujours `202`** avec le même message, que le compte existe ou non |
| Remplir la base (déni de service) | limites de taille multipart, 50 invitations en attente max, 200 annotations max par clip (vérifié de façon atomique) |
| Recherche piégée (injection de regex, requête énorme) | longueur limitée à 100 caractères (`MAX_QUERY_LENGTH`) et caractères spéciaux échappés (`escapeRegex`) avant le `$regex` ; agrégations bornées |

Limite assumée : `durationSec` est **déclarative** (envoyée par le client) ; le serveur ne
relit pas la vidéo pour la vérifier.

### 4.4 Pourquoi lire la vidéo avec `HttpClient` et non `<video src="…">` ?

Une balise `<video src>` ne sait pas ajouter l'en-tête `Authorization: Bearer <JWT>`.
On télécharge donc le fichier avec `HttpClient` (l'intercepteur ajoute le JWT) sous forme de
`Blob`, puis `URL.createObjectURL(blob)` donne une URL locale à mettre dans `src`. Il faut
`revokeObjectURL` ensuite, sinon fuite de mémoire.

---

## 5. Les notions Angular à connaître

| Notion | Où la voir | À retenir |
|---|---|---|
| Composants *standalone* | tous les `components/*` | pas de `NgModule` ; chaque composant déclare ses `imports` |
| **Signals** (`signal`, `computed`, `effect`) | `clips-page`, `clip-detail` | état réactif synchrone ; `computed` se recalcule seul |
| `inject()` | partout | injection de dépendances sans constructeur |
| Flux de contrôle `@if` / `@for` | templates `.html` | remplace `*ngIf` / `*ngFor` |
| Formulaires réactifs | login, import, partage | validation déclarée dans le code |
| Intercepteurs HTTP | `main.ts` | ajoutent le JWT ; un autre gère les erreurs 401 |
| **`withXhr()`** | `main.ts` | **Angular 22 utilise `fetch` par défaut, qui n'émet pas `UploadProgress`** : sans `withXhr()` la barre d'envoi ne bougeait plus. Bug découvert par les tests, corrigé en une ligne |
| Web Worker | `analysis.worker.ts` | calcul lourd hors du thread de l'interface |
| `Blob` + `ObjectURL` | `video-player` | lecture authentifiée (§4.4) |
| `Material` + jetons CSS | `styles.css` | thème sombre/clair par variables CSS (`--bg`, `--accent`…) |

---

## 6. Les tests : quatre niveaux

| Niveau | Outil | Ce qu'il prouve | Limite |
|---|---|---|---|
| 1. Unitaires front | Vitest (jsdom) | les algorithmes et composants se comportent comme prévu sur des données fabriquées | jsdom n'a ni vrai `<video>` ni vrai `<canvas>` |
| 2. API back | `node:test` + `fake-mongo.js` | routes, validation, règle d'accès, codes HTTP | **MongoDB est simulé** : un écart de comportement avec le vrai Mongo passerait inaperçu |
| 3. Intégration vrai Mongo | `node:test` + `mongodb-memory-server` | mêmes parcours contre un **vrai** MongoDB éphémère (13 tests, tous réussis) | pas de réseau ni de navigateur |
| 4. Bout en bout | Playwright + Chrome | le vrai navigateur analyse de **vraies vidéos** ; mesure rappel/précision | l'API y est simulée |

À retenir : ce n'est pas « beaucoup de tests » qui compte, c'est de savoir **ce que chaque
niveau prouve et ne prouve pas**. Exemple vécu : les tests unitaires passaient alors que la
barre d'envoi était cassée (niveau 4 l'a trouvé : `withXhr()`).

Commandes :

```bash
cd backend && npm test                      # niveau 2
cd backend && npm run test:integration      # niveau 3 (télécharge mongod la 1re fois)
cd frontend-starter && npx ng test --watch=false     # niveau 1
cd frontend-starter && npm run e2e          # niveau 4 (Chrome requis)
cd frontend-starter && npm run build        # build de production
```

---

## 7. Comment le travail a été mené avec l'IA

Le sujet du TP demande d'expliquer l'usage de l'IA. Voici la méthode, réellement suivie :

1. **Cadrage** : une analyse du projet et du sujet, puis `PLAN.md` (phase 1, le MVP) et
   `PLAN-STUDIO.md` (phase 2). Un plan écrit **avant** de coder, avec un contrat d'API.
2. **Agents spécialisés en parallèle**, chacun avec **ses propres fichiers** (pour ne jamais
   éditer le même fichier à deux) : backend, algorithmes, services, composants graphiques,
   pages, design, tests, documentation. Le modèle le moins cher capable de réussir était
   choisi pour chaque tâche.
3. **Revues indépendantes** par un autre modèle, deux fois (backend puis frontend), avec
   priorité à la sécurité. Elles ont trouvé de vrais défauts : énumération de comptes,
   limites multipart absentes, agrégations non bornées, requêtes non annulées au changement
   de page, `syncScore` falsifiable, etc. Tous corrigés.
4. **Vérification par mesure** et non par impression : vérité terrain pour la détection,
   tests sur vraies vidéos.
5. **Commits atomiques** (un sujet par commit, format *Conventional Commits*), sur une
   branche dédiée `feat/film-pulse-studio`, sans `push` sans ton accord.

**Ce que l'IA a mal fait, et comment on l'a su** (utile pour la partie « esprit critique » du
rapport) : la première détection était mauvaise (rappel 0,50) alors qu'elle « avait l'air de
marcher » ; un agent a lancé un `git stash` en parallèle (vérifié : rien de perdu) ; des
agents de documentation ont été refusés par l'outil d'écriture, j'ai dû rédiger moi-même.
**Règle à retenir : l'IA propose, tu vérifies.** Chaque affirmation de ce guide peut être
retrouvée dans le code, avec les noms de fichiers cités.

---

## 8. Ce qui a été fait juste avant le rendu

| Tâche | Résultat |
|---|---|
| Correctif Safari du champ d'import (`accept="audio/*,…"`) | commité (`fix(tracks)`) ; Safari grisait les fichiers WAV et M4A dans le sélecteur. Cause probable : la liste `accept` contenait des types MIME peu courants (`audio/x-wav`, `audio/x-m4a`). Le correctif est testé par les specs, mais pas revérifié dans Safari par moi : à confirmer de ton côté |
| Fichiers de test | 41 fichiers audio (MP3/WAV/OGG/M4A) + 41 pochettes + vidéos dans `~/Downloads/` |
| Test d'intégration sur **vrai MongoDB** | 13 tests passent (`npm run test:integration`). Aucun écart avec la simulation sur ce parcours. Ignorés par `npm test` pour rester rapide et hors-ligne |
| Captures d'écran de l'application (clair et sombre) | 26 images (13 pages × 2 thèmes) dans `docs/captures/film-pulse/`, plus un tableau des requêtes `/api` du parcours. Générées par Playwright avec une **API simulée** : ce ne sont pas des captures DevTools. Relancer : `npm run captures` |
| Relecture de `REPORT.md` contre le code | un agent a vérifié chemins, routes, constantes, codes HTTP et nombres de tests. 5 erreurs de détail trouvées et corrigées (nombre de tests 505 → 512, route `/discover`, seuil 0,2 s, pas de planche contact, défaut k = 4). Le reste était exact |
| **Bug trouvé grâce aux captures** | recharger la page sur `/clips/<id>` donnait une page blanche : `index.html` n'avait pas de `<base href="/">`, donc `main.js` et `styles.css` étaient cherchés sous `/clips/`. Corrigé (`fix(app)`). Leçon : une route à plusieurs niveaux révèle ce que `/tracks` cachait |
| Branche | prête ; **non poussée** (voir §12) |

**Les captures « Network » du TP.** Les sujets TP2/TP3 demandent des captures de l'onglet
Network des DevTools (authentification, upload, suppression, pagination). Ce sont **tes**
preuves : je ne peux pas les fabriquer à ta place et elles doivent venir de **ton**
navigateur. La procédure précise, en 5 minutes, est dans le dossier
`frontend-starter/docs/captures/` (fichier `COMMENT-FAIRE-LES-CAPTURES-NETWORK.md`).

---

## 9. Les limites, dites honnêtement

Un bon rapport nomme ses limites ; les citer toi-même est un point positif.

1. **Réglage sur 3 vidéos** : risque de surapprentissage de la détection.
2. **Une coupe manquée** à 13,9 s sur la bande-annonce, et les rafales de coupes < 0,3 s
   comptent pour une seule.
3. **Fondu et mouvement rapide** se distinguent mal.
4. **Durée déclarative** : le serveur ne vérifie pas `durationSec` en relisant la vidéo.
5. **Anciennes analyses** (histogramme) : elles se recalculent mal avec le curseur.
6. **Clips v1** : pas de réglage de sensibilité (pas de `diffs` stockés).
7. **Un test `tracks-page` intermittent** (délais dépassés), antérieur à mes changements.
8. **Deux défauts d'interface connus, non corrigés** : la boîte de partage coupe le 3e ami sur un écran de 900 px de haut (elle défile), et l'affiche d'un extrait est sa première image, noire quand la vidéo commence par un fondu.
9. **Pas de `push`** : tout est local tant que tu n'as pas décidé.

---

## 10. Questions probables à l'oral

**Comment détectez-vous une coupe ?**
Je compare des images successives réduites en 64 × 36, par blocs avec recalage ± 4 px. Un pic
est une coupe s'il dépasse un seuil local « médiane + k × MAD » et domine ses voisins (§3.3).

**Pourquoi médiane et MAD et pas moyenne et écart-type ?**
Parce que la coupe est elle-même une valeur extrême : elle fausserait moyenne et écart-type.
La médiane et la MAD sont robustes.

**Comment mesurez-vous que c'est fiable ?**
Vérité terrain relevée à la main sur la bande-annonce, puis rappel et précision (0,88 et 1,00).
Mais je précise que c'est sur 3 vidéos seulement (§3.8).

**Qu'est-ce que le score de synchronisation ?**
La part des coupes proches d'un beat, divisée par la part attendue au hasard. ≈ 1 : pas de
lien ; > 1,25 : calé sur la musique (§3.6).

**Que se passe-t-il si un client malveillant envoie un faux score ?**
Il est ignoré : le serveur recalcule `cutCount`, ASL, `syncScore` et la mini-courbe (§4.3).

**Comment empêchez-vous d'accéder au clip d'un autre ?**
Règle `canReadClip` : propriétaire, ou public, ou partagé + invité + amitié acceptée vérifiée
au moment de la lecture. Sinon `404`, jamais `403` (§4.2).

**Pourquoi ne pas utiliser `<video src>` avec l'URL de l'API ?**
La balise ne peut pas envoyer le JWT ; on télécharge en `Blob` via `HttpClient` (§4.4).

**Pourquoi un Web Worker ?**
Le calcul des beats (décodage et fenêtres d'énergie) est lourd ; dans le thread principal il
figerait l'interface.

**Qu'est-ce qui n'a pas marché ?**
La première détection (histogramme), 50 % de rappel ; la progression d'upload cassée par le
passage à `fetch` d'Angular 22 ; la sécurité des invitations (énumération). Tout est dans
`REPORT.md`.

**Quelle est la limite principale des tests backend ?**
MongoDB y était simulé. J'ai ajouté un test d'intégration contre un vrai MongoDB éphémère
pour fermer cet écart (§6).

**Quelle dépendance avez-vous ajoutée, et pourquoi ?**
`@playwright/test` (devDependency, Apache-2.0) pour les tests de bout en bout, et
`mongodb-memory-server` (devDependency) pour le test sur vrai Mongo. Aucune dépendance de
production.

---

## 11. Glossaire

| Terme | Définition |
|---|---|
| **Plan** | séquence d'images filmée en continu |
| **Coupe** | changement brusque d'un plan à un autre |
| **Fondu (enchaîné)** | transition progressive entre deux plans |
| **ASL** | *Average Shot Length*, durée moyenne d'un plan |
| **Luminance** | clarté perçue d'un pixel |
| **Médiane / MAD** | valeur centrale / écart absolu médian ; robustes aux valeurs extrêmes |
| **Rappel / précision** | part des vraies coupes retrouvées / part des coupes annoncées qui sont vraies |
| **Vérité terrain** | réponses correctes établies à la main, pour mesurer un algorithme |
| **Beat / BPM** | temps fort de la musique / battements par minute |
| **RMS** | racine de la moyenne des carrés : mesure d'énergie d'un signal |
| **Web Worker** | thread JavaScript séparé du thread de l'interface |
| **JWT** | jeton signé prouvant l'identité, envoyé dans `Authorization: Bearer …` |
| **IDOR** | accès à la ressource d'autrui en changeant un identifiant |
| **Octets magiques** | premiers octets d'un fichier qui identifient son vrai format |
| **Surapprentissage** | réglage trop adapté aux exemples vus, qui généralise mal |
| **Signal** | valeur réactive d'Angular qui prévient ceux qui la lisent |
| **Conventional Commits** | format de message `type(portée): résumé` |

---

## 12. Checklist du rendu

- [ ] `cd backend && npm test` vert
- [ ] `cd frontend-starter && npx ng test --watch=false` vert (un test `tracks-page` peut être
      intermittent : le relancer)
- [ ] `cd frontend-starter && npm run build` passe
- [ ] Lancer l'appli et dérouler la démo de `REPORT.md` (7 étapes)
- [ ] **Faire tes captures Network** (procédure dans `docs/captures/`)
- [ ] Relire `REPORT.md` et ce guide, en pouvant expliquer chaque section
- [ ] Décider du `git push` (la branche est `feat/film-pulse-studio`) :
      `git push -u fork feat/film-pulse-studio`
