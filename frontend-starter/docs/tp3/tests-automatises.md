# TP3 / Mission 7 — Tests automatisés

Livrables TP3 : « au moins trois tests frontend » et « rapport des tests avec
résultats attendus et observés ». Le sujet prévient :

> « Une fonctionnalité non expliquée ou un test qui ne vérifie aucune assertion
> utile ne permet pas de valider la mission. »

Ce document explique donc autant **pourquoi** ces tests sont écrits ainsi que ce
qu'ils vérifient.

---

## 1. Ce que le sujet demandait, et ce qui est couvert

Le sujet propose sept tests et en exige **au moins trois**. Les sept sont
couverts.

| Test demandé par le sujet | Où | Ligne |
|---|---|---|
| `AuthService.login()` utilise `POST /api/auth/login` avec le bon corps | `auth.service.spec.ts` | 45 |
| `TrackService.list()` transmet `page` et `limit` | `track.service.spec.ts` | 76 |
| L'intercepteur ajoute `Authorization` lorsqu'un token existe | `auth.interceptor.spec.ts` | *(voir §5)* |
| Le guard redirige un utilisateur sans token | `auth.guard.spec.ts` | 37 |
| Le composant affiche une erreur après un échec HTTP | `tracks-page.spec.ts` | 403 |
| La suppression appelle `DELETE /api/tracks/:id` et recharge la liste | `tracks-page.spec.ts` | 141 |
| L'upload met à jour l'état de progression et traite l'erreur | `tracks-page.spec.ts` | 246 et 301 |

Tous les fichiers sont dans `src/app/`, à côté du code qu'ils testent.

---

## 2. État de la suite de tests

> **Chiffres définitifs** (mesurés par l'orchestrateur, code figé) : frontend
> **188 tests / 15 fichiers, 188 verts, 0 rouge** ; backend **52 tests, 52 verts**.
> Les jalons plus anciens (13 à la fin de la Mission 1, 66 à la fin du TP3) sont
> conservés plus bas comme **jalons datés**, pas comme état actuel.

### Répartition par fichier (frontend)

Comptage statique effectué en lisant les fichiers : les blocs `it(…)` **plus les cas
générés par les `it.each`**. C'est pour cela que le total (188) dépasse le nombre de
blocs `it(` (167) : 21 cas supplémentaires viennent des `it.each`. Aucun test n'est
désactivé (`grep -rn "it.skip\|it.todo\|xit("` dans `src/app` ne renvoie rien) : un
test ignoré ne prouve rien, et un `it.skip` oublié est une régression invisible.

| Fichier (`src/app/…`) | Tests | Ce qu'il couvre |
|---|---|---|
| `shared/services/auth.service.spec.ts` | 11 | `login()`, `register()`, `profile()`, `update()`, `messageFromError()`, `logout()` |
| `shared/services/track.service.spec.ts` | 20 | `list()` (dont `q`, 3 cas de `q` absent), upload avec ou sans `cover`, cinq méthodes de pochette, `remove()`, `audio()` |
| `shared/interceptors/auth-error.interceptor.spec.ts` | 7 | `401` sur route protégée vs route publique, `404`, succès |
| `shared/interceptors/auth.interceptor.spec.ts` | 4 | ajout de l'en-tête `Authorization` |
| `shared/guards/auth.guard.spec.ts` | 3 | redirection sans token, passage avec token, token vide |
| `components/tracks-page/tracks-page.spec.ts` | 68 | suppression, progression, pagination, filtre, états vides, `MatPaginator`, dialogues, pochettes, page hors bornes, focus |
| `components/tracks-page/tracks-page.review.spec.ts` | 6 | relecture indépendante : page hors bornes, courses, aperçu `ObjectURL`, tags non fiables |
| `components/tracks-page/track-cover/track-cover.spec.ts` | 9 | affichage d'une pochette, version, révocation |
| `components/tracks-page/cover-search-dialog/cover-search-dialog.spec.ts` | 6 | recherche Web, `502`, confirmation, Échap |
| `components/tracks-page/cover-search-dialog/cover-search-dialog.review.spec.ts` | 3 | relecture : `javascript:`, texte hostile, référent |
| `components/tracks-page/cover-file.review.spec.ts` | 11 | types d'image acceptés et refusés, 2 Mo, extension absente |
| `components/app/app.spec.ts` | 13 | déconnexion, lien d'évitement, `aria-current`, restauration du profil |
| `components/login-page/login-page.spec.ts` | 8 | validation, message du backend, redirection, accessibilité |
| `components/register-page/register-page.spec.ts` | 9 | validation, mot de passe, nom ≥ 2 caractères, accessibilité |
| `components/profile-page/profile-page.spec.ts` | 10 | chargement, bouton « Enregistrer », initiales, squelette, nom ≥ 2 caractères |
| **Total** | **188** | 15 fichiers |

**Backend** : `api.test.js` 2 + `tracks.test.js` 31 + `securite-bonus.test.js` 19 =
**52 tests** (voir [`../bonus/tests-de-contrat-backend.md`](../bonus/tests-de-contrat-backend.md)).

### Progression de la suite (jalons datés)

| Moment | Tests frontend |
|---|---|
| Fin de la Mission 1 (TP1) | 13 |
| Paliers intermédiaires | 36 → 41 → 59 → 65 |
| **Fin du TP3** | **66** |
| **État final** (après bonus, refonte UI/UX, relecture) | **188** |

Les paliers intermédiaires sont ceux mesurés par l'orchestrateur au fil du projet ;
leur détail n'est pas conservé ici. Le passage de 59 à 65 puis 66 ne vient pas de
nouvelles fonctionnalités mais d'une **relecture indépendante** du code déjà écrit,
puis d'un **bug de course** qu'elle a révélé et qui a été corrigé avec son test
(voir §2 *bis*).

### Résultats des autres vérifications (définitifs)

| Commande | Résultat |
|---|---|
| `npm test` (frontend) | **188 verts / 188, 0 rouge, 15 fichiers** |
| `npm test` (backend) | **52 verts / 52** |
| `npx tsc --noEmit -p tsconfig.app.json` | **exit 0, aucune erreur** |
| `npx tsc --noEmit -p tsconfig.spec.json` | **exit 0, aucune erreur** |
| `npm run build` | **succès, 737,04 kB initial (161,41 kB transférés)**, sans avertissement |
| Intégration réelle (serveur + MongoDB Atlas + iTunes) | **56 OK / 0 KO**, plus 5 cas (voir [`../bonus/preuves-integration-reelle.md`](../bonus/preuves-integration-reelle.md)) |

**À propos du poids du bundle** : 296,06 kB (78,37 kB transférés) à l'état initial du
starter ; 456,75 kB (112,38 kB) à la fin du TP3, avec le `MatSnackBar` ; **737,04 kB
(161,41 kB)** après les bonus (paginator, dialogues, thème Material, pochettes). La
part de chaque élément n'a pas été mesurée. À savoir expliquer : importer un composant
Material entraîne aussi son thème et une partie du CDK, d'où une augmentation bien
supérieure à la taille du seul composant.

**Le backend et le contrat.** Pendant les missions obligatoires, le backend n'a pas
été modifié. Pour les **bonus uniquement**, le gel a été levé (pagination Mongoose,
filtre, pochettes) et `API_CONTRACT.md` mis à jour dans le même lot ; les clés
existantes du contrat n'ont été ni renommées ni retirées. Voir
[`../bonus/pagination-mongoose.md`](../bonus/pagination-mongoose.md).

---

## 2 bis. Ce que la relecture indépendante a trouvé

Les deux derniers paliers de la suite de tests (59 → 65 → 66) ne viennent pas de
nouvelles fonctionnalités : ils viennent d'une **relecture du code par un agent
qui ne l'avait pas écrit**. C'est le résultat le plus intéressant de la Mission 7,
parce qu'il montre ce qu'une suite verte ne garantit pas.

### Un commentaire faux (pas un bug, mais presque pire)

Le commentaire de `canUpload` (`tracks-page.ts:231-237`) affirmait que `upload()`
« revalide systématiquement ». C'était inexact : `upload()` revalide le
**fichier** (`validateFile()`, `:701-720`, appelé en `:518`) mais **pas le
titre**. Pour le titre, le bouton désactivé (`tracks-page.html:112`) est la seule
barrière côté client, et c'est le backend qui tranche.

Le commentaire est maintenant rectifié. Un commentaire faux est plus dangereux
qu'un commentaire absent : il décourage la vérification. Aucun test ne peut
l'attraper — seule une relecture le peut.

### Un bug de course, trouvé et corrigé avec son test

Deux appels à `load()` peuvent se chevaucher. Le cas réel : **une suppression
confirmée pendant un changement de page** émet deux `GET /api/tracks` concurrents
(l'un par `go()`, l'autre par le rechargement de `remove()`). Si la réponse la
plus ancienne arrive en dernier, elle écrase l'état affiché par la plus récente :
l'utilisateur voit une liste périmée, sans aucune erreur nulle part.

Le correctif est un compteur de séquence (`loadSequence`, `tracks-page.ts:360` ; `beginLoad()` `:407-411`) :

```ts
private loadSequence = 0;

load(): void {
  const sequence = ++this.loadSequence;
  // …
  next: (response) => {
    if (sequence !== this.loadSequence) return;   // applyPage, :414 — réponse périmée : ignorée
    // …
  },
  error: (error) => {
    if (sequence !== this.loadSequence) return;   // applyLoadError, :424 — même garde côté erreur
```

Chaque appel capture son numéro ; seule la réponse du **dernier** appel émis a le
droit d'écrire dans les signaux. La garde est posée dans les **deux** callbacks
(`applyPage`, `:414`, et `applyLoadError`, `:424`) : une erreur périmée ne doit pas non plus afficher un message
sur un état qui a déjà changé.

**À savoir expliquer** : pourquoi ne pas avoir utilisé `switchMap`, comme pour la
lecture audio (`:275`) ? Parce que `switchMap` annule l'abonnement précédent, ce
qui convient quand les appels partent d'un même flux (le `Subject`
`playRequests`). Ici, les deux `load()` sont déclenchés par des chemins
indépendants (une pagination et une suppression) ; un compteur est plus simple à
lire et ne change pas la structure du composant. Les deux approches résolvent le
même problème — une course entre requêtes — à des endroits différents.

**Le test qui verrouille le correctif** :
`tracks-page.spec.ts:383`, « ignore la réponse d'un chargement rendu obsolète par
un plus récent ». Il émet deux requêtes, répond à la **plus récente d'abord**,
puis à la plus ancienne, et vérifie que l'état affiché est celui de la récente
(`:397`) et que `loading()` est bien retombé à `false` (`:398`).

**Validé par mutation** : garde retirée → **1 seul échec, exactement ce test** ;
garde remise → **suite entière au vert** (66/66 au moment de cette mutation). C'est la démonstration que le test observe
précisément ce qu'il prétend observer (voir §6).

---

## 3. Test unitaire ou test d'intégration ?

Distinction demandée à l'oral (question 6 du sujet). Réponse détaillée dans
[`restitution-orale.md`](./restitution-orale.md#6-quelle-différence-existe-t-il-entre-un-test-unitaire-et-un-test-dintégration-),
résumé ici parce qu'il conditionne la lecture de toute la suite.

| | Test **unitaire** | Test **d'intégration** |
|---|---|---|
| Périmètre | une unité isolée (une classe, une fonction) | plusieurs briques qui collaborent réellement |
| Dépendances | remplacées par des doubles | réelles (vrai serveur, vraie base) |
| Vitesse | millisecondes | secondes à minutes |
| En cas d'échec | on sait **où** est le problème | on sait qu'il y a un problème, pas forcément où |
| Fragilité | faible | forte (réseau, données, ordre d'exécution) |

**Toute la suite frontend de ce projet est unitaire.** Les tests des services
et intercepteurs isolent la classe testée derrière `HttpTestingController` ; les
tests de composants montent le composant avec `TestBed` mais remplacent la
couche HTTP et, pour `tracks-page.spec.ts`, le `MatSnackBar`.

Le projet contient malgré tout des tests d'intégration, **côté backend** :
`backend/test/api.test.js` démarre une vraie application Express. C'est
d'ailleurs l'extension facultative que propose le sujet.

Un troisième niveau existe, absent ici : le test **end-to-end** (Playwright,
Cypress), qui pilote un vrai navigateur contre l'application complète. C'est le
seul qui pourrait vérifier qu'un fichier audio se joue réellement — d'où les
vérifications manuelles laissées au binôme.

---

## 4. Pourquoi ces tests n'ont pas besoin de MongoDB

Exigence du sujet : « ils ne doivent pas dépendre d'un backend ou d'une base
MongoDB en fonctionnement. »

### Le mécanisme

Deux providers, systématiquement associés dans chaque fichier de test :

```ts
// auth.service.spec.ts:30
providers: [provideHttpClient(), provideHttpClientTesting()],
```

`provideHttpClientTesting()` **remplace le backend HTTP d'Angular** — la couche
de bas niveau qui effectue réellement la requête réseau — par une
implémentation qui ne fait rien d'autre que mettre la requête dans une file
d'attente. Aucun paquet ne quitte le processus de test.

Le test récupère ensuite cette file via `HttpTestingController` et pilote les
deux extrémités de l'échange :

```ts
// ce que le code a DEMANDÉ : on l'inspecte et on l'asserte
const request = httpMock.expectOne('/api/tracks?page=2&limit=3');
expect(request.request.method).toBe('GET');

// ce que le serveur RÉPOND : on le décide
request.flush(fauxPage);          // réponse de succès
request.flush(corps, { status: 404, statusText: 'Not Found' });  // ou erreur
```

### Ce que cela change, concrètement

| Sans doublure (contre un vrai backend) | Avec `HttpTestingController` |
|---|---|
| Il faut lancer Express **et** MongoDB Atlas | rien à lancer |
| Il faut des données de test, et les nettoyer entre les tests | chaque test décide de la réponse, ligne par ligne |
| Provoquer un `404` demande de fabriquer un état réel | une ligne : `flush(..., { status: 404 })` |
| Provoquer un `500` ou un « serveur injoignable » est presque impossible | une ligne |
| Un test rouge peut venir du réseau, de la base, ou du code | un test rouge vient du code |
| Quelques secondes par test | quelques millisecondes |

Le cas des **événements de progression d'upload** (Mission 6) est le plus
parlant : contre un vrai serveur en local, le transfert est trop rapide et le
nombre d'événements `UploadProgress` n'est pas prévisible — un test reposant sur
eux serait *intermittent*, tantôt vert tantôt rouge. Avec
`HttpTestingController`, le test émet exactement les événements qu'il veut, avec
les valeurs `loaded` et `total` qu'il choisit
(`tracks-page.spec.ts:246`, `:260`). Il peut même émettre un `UploadProgress`
**sans** `total`, ce qu'un vrai serveur ne produirait pratiquement jamais — et
c'est justement le cas limite que le code doit gérer.

### La limite à connaître, et à savoir dire

Ces tests vérifient que le frontend **respecte le contrat** décrit dans
`API_CONTRACT.md`. Ils ne vérifient **pas** que le backend le respecte aussi : la
réponse simulée est celle que le test a écrite, pas celle du vrai serveur.

Si le backend changeait la forme de sa réponse — par exemple en renvoyant
`totalPages` au lieu de `pages` — **tous ces tests resteraient verts** et
l'application serait cassée. C'est la faiblesse structurelle du test unitaire
avec doublures : il verrouille une hypothèse, il ne la valide pas.

C'est précisément pour couvrir ce trou que deux autres niveaux de vérification
ont été utilisés, et qu'il faut citer ensemble :

1. les tests d'intégration backend (`backend/test/api.test.js`) ;
2. les vérifications `curl` réellement exécutées contre l'API en fonctionnement
   (§7), dont `GET /api/tracks?page=2&limit=3` qui confirme que le serveur
   renvoie bien `page=2, limit=3`.

### Deux garde-fous dans la configuration des tests

**`httpMock.verify()` dans un `afterEach`** (`auth.service.spec.ts:39-40`) fait
échouer le test s'il reste une requête non traitée. Sans cela, un test qui
déclenche une requête et l'oublie passerait au vert en n'ayant rien vérifié.
C'est aussi ce qui attrape les requêtes *parasites* : une requête émise en trop
devient visible.

**Le polyfill de `localStorage`** (`src/test-setup.ts`) : `AuthService` lit
`localStorage` dès sa construction (`auth.service.ts:16`). Dans cette
configuration jsdom, l'accès lève une exception, et tout test injectant le vrai
`AuthService` plantait avant d'atteindre ses assertions. Le polyfill est une
`MemoryStorage` minimale, installée seulement si l'accès réel échoue.

À noter : `auth.service.spec.ts:27` fait un `localStorage.removeItem('gpc_token')`
avant chaque montage. Le signal `token` étant initialisé à la construction, un
token laissé par un test précédent changerait le comportement du suivant —
c'est la classe de bug la plus pénible en test : un test qui ne passe que selon
l'ordre d'exécution.

---

## 5. Ce que vérifie un test d'intercepteur ou de guard

Question 5 de la restitution orale. Ces deux-là sont les plus intéressants à
tester, parce qu'ils sont **invisibles** : aucun écran ne les montre, et un
utilisateur ne peut pas constater directement leur bon fonctionnement.

### Un test de guard

`auth.guard.spec.ts` — 3 tests. `authGuard` est une fonction `CanActivateFn` :
elle renvoie soit `true`, soit un `UrlTree` de redirection. Le test vérifie donc
**la valeur de retour**, pas un rendu :

| Test | Ligne | Entrée | Attendu |
|---|---|---|---|
| Redirige un utilisateur sans token | 37 | `token()` à `null` | un `UrlTree` vers `/login` |
| Laisse passer un porteur de token | 45 | `token()` renseigné | `true` |
| Refuse aussi un token **vide** | 51 | `token()` à `''` | un `UrlTree` |

Le troisième est le plus utile : c'est un **cas limite**. `''` est *falsy* en
JavaScript, donc `auth.token() ? true : redirect` (`auth.guard.ts:10`) redirige
bien. Mais si quelqu'un réécrivait la condition en
`auth.token() !== null`, une chaîne vide passerait et l'utilisateur atteindrait
une page protégée sans session. Ce test verrouille l'intention (« une session
existe ») plutôt que l'écriture actuelle du code.

Point de méthode : il est plus fiable de tester le guard **directement**, en
l'exécutant dans un contexte d'injection, que de tester une navigation complète.
On teste une décision, pas un routeur.

### Un test d'intercepteur

`auth.interceptor.spec.ts` — 4 tests. Un intercepteur ne peut pas être appelé à
la main utilement : il faut le faire traverser par une vraie requête
`HttpClient`. Le test l'enregistre donc dans le `TestBed`, émet une requête, et
inspecte ce que `HttpTestingController` a reçu — c'est-à-dire la requête **après
transformation** :

```ts
expect(request.request.headers.get('Authorization')).toBe('Bearer …');
```

Les quatre cas couverts :

| Test | Ligne | Vérifie |
|---|---|---|
| Ajoute `Authorization: Bearer <token>` quand un token est présent | 38 | le comportement principal, **et le format exact** attendu par le backend (`backend/src/app.js:309` exige le préfixe `Bearer `) |
| N'ajoute aucun en-tête d'authentification sans token | 50 | le cas du login : surtout pas d'en-tête `Bearer null` |
| Relit le token **à chaque** requête | 63 | qu'une connexion en cours de session est prise en compte : l'intercepteur lit `AuthService.token()` à l'exécution (`auth.interceptor.ts:7`), il ne capture pas une valeur au démarrage |
| Ne modifie ni la méthode, ni l'URL, ni le corps | 78 | que `request.clone({ setHeaders })` (`auth.interceptor.ts:11-13`) n'altère rien d'autre que les en-têtes |

Le troisième est celui qu'on n'écrit pas spontanément, et c'est le plus utile :
si l'intercepteur avait lu le token une fois pour toutes (par exemple dans une
variable de module), la toute première session après un login partirait sans
en-tête. Le test verrouille le fait que la lecture est bien paresseuse.

`auth-error.interceptor.spec.ts` — 7 tests — est le cas le plus riche, parce que
l'intercepteur a un **effet de bord** (déconnexion + navigation) et non une
simple transformation. Le test injecte donc des doubles d'`AuthService` et de
`Router`, et vérifie qu'ils ont été appelés — ou non :

| Test | Ligne | Vérifie |
|---|---|---|
| `401` sur route protégée → déconnexion + redirection | 34 | le comportement principal |
| `404` → aucune réaction | 48 | l'intercepteur ne réagit pas à n'importe quelle erreur |
| Réponse réussie → aucune réaction | 60 | il ne casse pas le cas normal |
| `401` sur `POST /api/auth/login` → **ni** logout **ni** redirection | 77 | le correctif de la Mission 1 bis |
| `401` sur `POST /api/auth/register` → idem | 94 | la seconde route publique |
| `401` sur `GET /api/users/me` → déconnexion | 110 | la distinction fonctionne dans les deux sens |
| `401` sur route protégée **avec query string** | 127 | cas limite du `startsWith()` de `auth-error.interceptor.ts:16` |

Les quatre derniers ont été ajoutés avec le correctif d'exclusion des routes
publiques (voir
[`../mission1/probleme-3-gestion-401.md`](../mission1/probleme-3-gestion-401.md)).
Ce fichier compte donc désormais **7** tests, et non 3 comme à l'origine.

**Ce que ces tests valent vraiment** : les trois premiers décrivent le
comportement attendu, mais ce sont surtout les quatre derniers qui ont de la
valeur, parce qu'ils sont nés d'un **bug réel** — un mot de passe refusé
provoquait une fin de session. Un test écrit après un bug est le seul qui
garantisse que ce bug ne reviendra pas. C'est le meilleur argument à donner si
l'on demande « à quoi servent vos tests ? ».

---

## 6. Comment on sait qu'un test n'est pas vide : la vérification par mutation

Le sujet est explicite : « un test qui ne vérifie aucune assertion utile ne
permet pas de valider la mission ».

Un test peut être vert pour de mauvaises raisons : une assertion qui porte sur
une valeur toujours vraie, un `expect` oublié, une requête simulée qui ne
correspond pas au code réel. **Un test vert ne prouve rien par lui-même.**

La technique utilisée par l'équipe est la **vérification par mutation** :

1. on casse volontairement **une** chose — soit l'assertion du test, soit la
   ligne de code qu'elle est censée protéger ;
2. on relance la suite et on vérifie que **le test attendu, et lui seul**,
   passe au rouge ;
3. on restaure immédiatement, et on vérifie le retour au vert.

Si le test reste vert après qu'on a cassé le code, **le test est inutile** : il
n'observe pas ce qu'il prétend observer. C'est exactement ce qu'on cherche à
détecter.

Exemples de mutations. **Honnêteté sur leur statut** : l'équipe a pratiqué cette
vérification, mais parmi les lignes ci-dessous, **une seule est confirmée comme
réellement exécutée** (la dernière, la garde `loadSequence` : 1 seul échec, puis
retour au vert, 66/66 à ce moment-là). Les autres sont des **pistes à tenter**, pas des résultats
rapportés :

| Mutation | Test qui doit rougir |
|---|---|
| Retirer `setHeaders: { Authorization: ... }` dans `auth.interceptor.ts:12` | `auth.interceptor.spec.ts` |
| Remplacer `params: { page, limit }` par `params: { page }` dans `track.service.ts:23` | « transmet les valeurs de page et limit » (`track.service.spec.ts:76`) |
| Retirer la condition `!isPublicAuthRoute(request.url)` (`auth-error.interceptor.ts:29`) | les 2 tests de routes publiques (`:77`, `:94`) |
| Déclarer le succès sur `UploadProgress` au lieu de `Response` | « ne déclare PAS la réussite à 100 % » (`tracks-page.spec.ts:275`) |
| Retirer le test de confirmation dans `remove()` (`tracks-page.ts`, la suppression se lancerait sans attendre la réponse du dialogue) | « n'émet AUCUNE requête DELETE si l'utilisateur refuse » (`tracks-page.spec.ts:126`) |
| Retirer la garde `if (sequence !== this.loadSequence) return;` (`applyPage`, `tracks-page.ts:414`) | « ignore la réponse d'un chargement rendu obsolète » (`tracks-page.spec.ts:383`) — **mutation réellement effectuée** : 1 seul échec, puis 66/66 après restauration |

C'est aussi, sous une autre forme, la logique qui a été suivie dès le TP1 :
écrire les tests **avant** les correctifs et vérifier qu'ils sont rouges pour la
bonne raison (voir [`../mission1/README.md`](../mission1/README.md), « 6 tests
rouges sur 10 »). Un test qui n'a jamais été rouge n'a jamais été vérifié.

> **[À COMPLÉTER PAR LE BINÔME]** — c'est la vérification la plus rapide à
> refaire vous-mêmes, et la plus convaincante à l'oral. Choisissez **une** ligne
> du tableau ci-dessus, appliquez la mutation, lancez `npm test`, capturez le
> terminal **rouge** en notant quel test a échoué et avec quel message, puis
> restaurez le fichier (`git diff` pour vérifier que vous n'avez rien laissé) et
> relancez `npm test` pour capturer le retour au **vert**. Ces deux captures,
> côte à côte, prouvent que votre test observe réellement quelque chose — ce
> qu'une capture verte seule ne prouve pas.

---

## 7. Vérifications de contrat réellement exécutées contre l'API

Douze appels effectués par l'orchestrateur **en ligne de commande** contre le
backend en fonctionnement, avec le compte de démonstration. Ils complètent les
tests unitaires en validant le contrat du vrai serveur — le trou identifié au
§4.

| # | Vérification | Résultat réel |
|---|---|---|
| 1 | Connexion avec un mauvais mot de passe | `401` |
| 2 | Connexion valide | `200` + token |
| 3 | `GET /api/users/me` **sans** JWT | `401` |
| 4 | `GET /api/users/me` avec JWT | `200` |
| 5 | `GET /api/tracks?page=2&limit=3` | le serveur renvoie `page=2, limit=3` → pagination bien serveur |
| 6 | `POST /api/tracks` multipart `audio` + `title` | `201` |
| 7 | `POST /api/tracks` avec un fichier texte | `400 {"message":"Format audio non accepté"}` |
| 8 | `POST /api/tracks` sans fichier | `400 {"message":"Fichier audio requis"}` |
| 9 | `GET /api/tracks/:id/audio` avec JWT | `200`, `content-type: audio/mpeg`, 552 994 octets |
| 10 | `GET /api/tracks/:id/audio` **sans** JWT | `401` |
| 11 | `DELETE /api/tracks/:id` | `204`, sans corps |
| 12 | `DELETE` sur une piste déjà supprimée | `404 {"message":"Piste inconnue"}` |

La piste de test a ensuite été supprimée : la bibliothèque de démonstration est
revenue à son état d'origine.

Les correspondances utiles avec le reste de la documentation : le #5 est la
preuve de pagination serveur exigée par le TP2 ; les #7 et #8 illustrent le
« 100 % ≠ réussite » de la Mission 6 ; le #10 démontre pourquoi une URL dans
`src` ne peut pas fonctionner (voir
[`../tp2/upload-et-lecture-audio.md` §4](../tp2/upload-et-lecture-audio.md#4-pourquoi-une-url-placée-directement-dans-src-ne-reçoit-pas-le-jwt))
et le #12 le `404` indistinguable de la Mission 5.

> **Ces appels ne remplacent pas les captures Network.** Ils vérifient le
> **contrat HTTP** vu de la ligne de commande. Ils ne prouvent rien sur la
> confirmation de suppression, le SnackBar, la barre de progression ou la
> lecture audio, qui n'existent que dans un navigateur. Les procédures
> correspondantes sont dans [`suppression-de-piste.md`](./suppression-de-piste.md)
> et [`progression-upload.md`](./progression-upload.md).

---

## 8. Le « rapport des tests » demandé en livrable

Le sujet demande un « rapport des tests avec résultats attendus et observés ».
Les tableaux des §1, §2, §5 et §7 le constituent : pour chaque test, le
comportement attendu est le libellé du `it(...)`, et le résultat observé est la
sortie de `npm test`.

**[À COMPLÉTER PAR LE BINÔME]** :

1. Lancer `npm test` dans `frontend-starter/`, capturer la sortie complète du
   terminal (le récapitulatif final : nombre de fichiers, nombre de tests,
   durée). **C'est ce chiffre-là qui fait foi**, pas le comptage statique du §2.
2. Lancer `npm test` dans `backend/` et capturer de même (attendu : 2 verts).
3. Lancer `npm run build` dans `frontend-starter/` et capturer le récapitulatif
   de taille.
4. Faire la vérification par mutation du §6 : deux captures, rouge puis vert.
5. Ranger les captures dans `frontend-starter/docs/captures/` et les lier depuis
   `RAPPORT_IA_MODELE.md`.

**Ce que chaque membre sait expliquer sans l'assistant** :
**[À COMPLÉTER PAR LE BINÔME]** — trois des six questions de la restitution
orale portent sur cette mission (tests HTTP sans MongoDB, test d'intercepteur ou
de guard, unitaire vs intégration). Assurez-vous de pouvoir **ouvrir un fichier
de test au hasard et expliquer chaque ligne** : c'est la vérification la plus
probable. Notez ici, chacun pour soi, ce que vous savez redire sans notes.
