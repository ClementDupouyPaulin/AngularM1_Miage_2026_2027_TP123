# Rapport d'usage de l'IA — TP1, TP2 (TP3 en cours)

Pour chaque mission, détailler et fournir des explications concernant : objectif; prompt principal; plan proposé par l'agent; vérifications réalisées par le binôme; erreurs ou propositions rejetées; fichiers effectivement modifiés; preuve de fonctionnement; ce que chaque membre sait maintenant expliquer sans l'agent.

> Les sections ci-dessous sont pré-remplies par l'assistant IA avec les
> éléments factuels de la session (prompts réels, fichiers touchés,
> vérifications lancées). Les parties marquées **[À COMPLÉTER PAR LE
> BINÔME]** ne peuvent pas être écrites par l'assistant : elles demandent
> vos captures d'écran et votre propre évaluation de ce que vous savez
> expliquer sans aide.

## Assistant et mode utilisés

- **Outil** : Claude Code (extension VS Code), mode CLI intégré à l'IDE — pas
  une interface web.
- **Modèle** : Claude Sonnet 5 (`claude-sonnet-5`).

## Remarque de sécurité (transparence)

Pendant la préparation Atlas, un mot de passe MongoDB réel a été collé par
erreur dans le chat de l'assistant (au lieu d'être saisi directement dans
`.env`). L'assistant l'a signalé immédiatement et a demandé la rotation du
mot de passe sur Atlas avant de continuer. **[À COMPLÉTER PAR LE BINÔME]** :
confirmer ici que le mot de passe a bien été changé, et noter cet incident
comme rappel de la règle "ne jamais transmettre un secret à un assistant"
(section 9 de `CONSEILS_POUR_UTIISER_ASSISTANT_AI.md`).

---

## Mission 0 — Cartographier l'application

**Objectif** : identifier le composant racine, les routes, l'enregistrement
de `HttpClient`, les modèles/services/pages, et le mécanisme d'ajout du JWT,
sans modifier le code ; produire un schéma annoté du flux de connexion.

**Prompt principal** : sélection du texte de la Mission 0 dans
`SUJET_ETUDIANT_TP1.md` (pas de consigne additionnelle — l'assistant a suivi
la méthode recommandée par le cours : lire `AGENTS.md`/`CLAUDE.md`, analyser
sans modifier, résumer le flux).

**Plan suivi par l'agent** :
1. Lister les fichiers source de `frontend-starter/src`.
2. Lire `main.ts`, `routes.ts`, `app.ts`, `auth.service.ts`,
   `auth.interceptor.ts`, `login-page.ts`, `auth.guard.ts`, `API_CONTRACT.md`.
3. Produire un tableau de cartographie et un diagramme de séquence
   (Mermaid) du clic sur "Se connecter".
4. Distinguer routes publiques/protégées à partir de `API_CONTRACT.md`.

**Vérifications réalisées** : lecture directe du code source uniquement,
aucune commande d'exécution nécessaire (mission d'analyse pure). Le schéma a
été recoupé avec le contenu réel de `auth.guard.ts` et `auth.interceptor.ts`
pour éviter toute invention.

**Erreurs ou propositions rejetées** : aucune — mission d'analyse, aucun code
produit à cette étape.

**Fichiers effectivement modifiés** : aucun (conforme à la consigne "sans
modifier le code au début"). Livrable ajouté ensuite :
[`frontend-starter/docs/mission1/flux-connexion-et-signals.md`](frontend-starter/docs/mission1/flux-connexion-et-signals.md)
(schéma + explication Signal vs `localStorage`).

**Preuve de fonctionnement** : sans objet (pas de code exécuté).

**Ce que chaque membre sait maintenant expliquer sans l'agent** :
**[À COMPLÉTER PAR LE BINÔME]** — par exemple : le trajet complet d'une
requête `login`, pourquoi `authGuard` ne suffit pas à garantir un token
valide, la différence entre l'intercepteur qui *ajoute* le token et celui
qui *réagit* à un 401.

---

## Mission 1 — Inscription, connexion et profil

**Objectif** : compléter la partie utilisateur du frontend (formulaires,
validations, déconnexion, chargement automatique du profil, gestion du 401),
en respectant l'architecture composant → `AuthService` → `HttpClient`.

**Prompts principaux** (verbatim) :
1. *"je souhaite simplement que tu analyses cela sans ecrire de code et que
   tu mexpliques les problemes qui apparaissent et me donnes les
   solutions"*
2. *"ok ok reprenons le tp je veux que tu me fasses un document .md pour la
   reponse des questions puis structure 1 md par probleme pour statuer de
   cela puis il faudra que tu fasses une batterie de tests qui doit etre
   valide avant de mettre en place definitivement les changements le but
   est de ne pas tout faire dun coup sans comprendre"*
3. *"suit lordre"* (implémenter les correctifs un par un, dans l'ordre des
   fichiers de problèmes).

**Plan proposé et suivi par l'agent** :
1. Analyse du code existant (`login-page`, `register-page`, `profile-page`,
   `auth.service`, `auth.guard`, `app.html`) → identification de 5
   problèmes par rapport à la checklist du sujet.
2. Documentation : un `.md` par problème
   (`frontend-starter/docs/mission1/probleme-1-...md` à `probleme-5-...md`)
   avec constat, fichiers concernés, impact, solution proposée, critères
   d'acceptation.
3. Écriture d'une batterie de tests Vitest traduisant ces critères
   d'acceptation, **avant** tout correctif (état rouge vérifié : 6 tests en
   échec sur 10, pour la bonne raison).
4. Implémentation des correctifs un par un, avec relance de la suite
   complète après chaque étape pour vérifier l'absence de régression.

**Vérifications réalisées par l'agent (à recontrôler par le binôme)** :
- `npm test` relancé après chaque correctif (5 étapes), résultat final :
  **13 tests verts sur 13**.
- `npx tsc --noEmit` sur `tsconfig.app.json` et `tsconfig.spec.json` pour
  confirmer l'absence d'erreur de compilation.
- Vérification manuelle que les serveurs (`ng serve` sur 4200, backend sur
  3000) répondaient toujours (`curl` → 200) après les changements.

**Erreurs ou propositions rejetées / problèmes rencontrés et corrigés en
cours de route** :
- Le testeur Angular 22 (`@angular/build:unit-test`) ne fonctionnait pas
  tel quel dans ce starter : `jsdom` manquant, `tsconfig.spec.json` absent
  (erreurs `describe`/`it`/`expect` non reconnus), `buildTarget` invalide
  dans `angular.json` (`gpc:build:development` n'existait pas), et
  `AuthService` plantait dans les tests car `localStorage` n'était pas
  disponible dans l'environnement de test (polyfill ajouté dans
  `src/test-setup.ts`).
- `tsconfig.app.json` incluait aussi les fichiers `*.spec.ts` sans les types
  Vitest, ce qui faisait apparaître des erreurs de compilation dans l'IDE
  (mais pas dans `npm test`, qui utilise `tsconfig.spec.json`) : corrigé en
  excluant les specs de `tsconfig.app.json`.
- Pour le Problème 3 (gestion du 401), aucun fichier n'existait pour
  accrocher un test avant l'implémentation : le test et le code ont donc été
  écrits ensemble (documenté explicitement dans
  `probleme-3-gestion-401.md`), contrairement aux 4 autres problèmes.

**Fichiers effectivement modifiés** :

Code applicatif :
- `frontend-starter/src/app/components/app/app.ts`, `app.html`
- `frontend-starter/src/app/components/profile-page/profile-page.ts`
- `frontend-starter/src/app/components/register-page/register-page.ts`,
  `register-page.html`
- `frontend-starter/src/app/components/login-page/login-page.html`
- `frontend-starter/src/app/shared/interceptors/auth-error.interceptor.ts`
  (nouveau)
- `frontend-starter/src/main.ts`

Tests :
- `frontend-starter/src/app/components/app/app.spec.ts`
- `frontend-starter/src/app/components/profile-page/profile-page.spec.ts`
- `frontend-starter/src/app/components/login-page/login-page.spec.ts`
- `frontend-starter/src/app/components/register-page/register-page.spec.ts`
- `frontend-starter/src/app/shared/interceptors/auth-error.interceptor.spec.ts`

Outillage (pas lié aux problèmes métier) :
- `frontend-starter/angular.json`, `tsconfig.app.json`,
  `tsconfig.spec.json` (nouveau), `src/test-setup.ts` (nouveau)

Documentation :
- `frontend-starter/docs/mission1/` (README, questions-réponses, 5
  fichiers problème, schéma de flux)

**Preuve de fonctionnement** :
- Résultat automatisé : `npm test` → 13/13 tests verts (dernier run vérifié
  dans la session). *Ce chiffre est celui mesuré à la fin de la Mission 1 ; la
  suite de tests a grossi depuis, par paliers : **13 → 36 → 41 → 59 → 65 → 66**
  (66 = fin du TP3). Le total final, après les bonus, est de **188 tests verts sur
  188** ; détail au § « Bilan des vérifications automatisées » en fin de rapport.*
- **[À COMPLÉTER PAR LE BINÔME]** : capture(s) d'écran du terminal
  `npm test` en vert, et captures DevTools/Network demandées par le
  Checkpoint du sujet (connexion réussie, connexion refusée, requête
  `/api/users/me`) — à réaliser en testant vous-même l'application dans le
  navigateur, avec vos identifiants, pas ceux de l'assistant.

**Ce que chaque membre sait maintenant expliquer sans l'agent** :
**[À COMPLÉTER PAR LE BINÔME]** — par exemple : pourquoi `currentUser` n'est
pas persisté comme `token`, ce que fait concrètement
`authErrorInterceptor` et pourquoi il est nécessaire en plus de
`authGuard`, pourquoi `Validators.minLength(8)` côté frontend n'est pas une
vraie mesure de sécurité tant que le backend ne valide rien.

---

## Organisation du travail à partir du TP2 — équipe de sous-agents

À partir du TP2, la méthode de travail avec l'assistant a changé et cela doit
être déclaré honnêtement, parce que c'est une différence importante par rapport
aux Missions 0 et 1.

**Ce qui change** : les Missions 0 et 1 ont été menées dans une **conversation
unique**, avec les prompts cités verbatim plus haut. Les missions suivantes ont
été confiées à une **équipe de sous-agents pilotée par un orchestrateur** : une
session principale découpe le travail, lance plusieurs agents spécialisés en
parallèle, chacun avec son propre périmètre de fichiers, puis relit et intègre
leurs résultats.

**Répartition des périmètres** :

| Agent | Périmètre exclusif | Mission |
|---|---|---|
| **A** | authentification | Audit et correction du TP1 : intercepteurs, `AuthService`, pages login/register/profile |
| **B** | bibliothèque et audio | TP2 : pagination serveur, upload, lecture ; puis bonus TP3 (suppression, progression) |
| **C** | tests et revue | Tests automatisés (`*.spec.ts`) et relecture critique du code produit par A et B |
| **D** | documentation | `frontend-starter/docs/` et ce rapport ; aucun accès en écriture au code |
| **Orchestrateur** | configuration et intégration | `main.ts`, `angular.json`, `tsconfig*`, `package.json` ; découpage des tâches, relecture, exécution des tests et du build, validation finale |

Les agents n'exécutent ni `npm install`, ni `npm test`, ni `npm run build` :
c'est l'orchestrateur qui mesure, ce qui évite que chaque agent rapporte un
chiffre obtenu dans un état différent du dépôt. Tous les chiffres de ce rapport
viennent de ses mesures.

**Pourquoi ce découpage** : donner à chaque agent un périmètre de fichiers
**exclusif** évite que deux agents modifient le même fichier en même temps et
écrasent mutuellement leur travail. C'est aussi une application directe du
conseil de `CONSEILS_POUR_UTIISER_ASSISTANT_AI.md` (section 8) : demander une
modification ciblée plutôt qu'un changement massif, et annuler ou reformuler dès
que le périmètre dérape.

**Conséquence sur les prompts** : il n'existe plus un prompt initial unique à
citer pour ces missions, mais une consigne d'orchestration par agent. Les
prompts verbatim des Missions 0 et 1 restent cités ci-dessus, car ils
correspondent à une vraie conversation unique.

**Problème réel rencontré, à signaler honnêtement** : l'agent C (tests et revue)
a remonté **deux défauts qui se sont révélés périmés** — il avait lu les fichiers
*avant* que l'agent A ne les corrige, et signalait donc des problèmes déjà
résolus. C'est un risque propre au travail en parallèle : un agent raisonne sur
une photographie du code, pas sur son état courant. La résolution a été de
**revérifier systématiquement le code avant d'acter un défaut**, plutôt que de
faire confiance au rapport d'un agent. Le même problème s'est produit côté
documentation : des numéros de ligne cités sont devenus faux pendant la
rédaction, parce que l'agent B modifiait encore le fichier concerné.

**Ce qu'on en retient, et c'est transposable hors IA** : un rapport de revue a
une date de validité. Le réflexe utile est de traiter tout constat — humain ou
produit par un assistant — comme une **hypothèse à revérifier dans le code**, pas
comme un fait acquis. C'est exactement la consigne du cours : être capable
d'expliquer, tester et corriger compte davantage que d'obtenir une réponse vite.

**Limite à connaître** : un sous-agent démarre sans le contexte de la
conversation principale. Il faut donc lui redonner explicitement le périmètre,
les contraintes (`AGENTS.md`, `CLAUDE.md`, `API_CONTRACT.md`) et l'interdiction
de toucher au backend. Un agent mal briefé produit du code cohérent avec
lui-même mais incohérent avec le reste du projet. Deux garde-fous ont été
utilisés : les tests automatisés de l'agent C, et la vérification systématique
des affirmations de chaque agent dans le code par l'agent D (voir la section
« Mission Documentation » plus bas).

**[À COMPLÉTER PAR LE BINÔME]** : indiquer ici le modèle et le niveau de
raisonnement effectivement utilisés pour ces sessions (relevé dans l'outil, pas
demandé à l'assistant : voir la procédure dans
`frontend-starter/docs/mission1/questions-reponses.md`), ainsi que la
consommation observée si votre outil l'affiche (`/cost` dans Claude Code en mode
interactif). Une estimation donnée par le modèle n'est pas une mesure.

---

## Mission 1 bis — Corrections d'authentification après revue (TP1 consolidé)

**Objectif** : corriger trois défauts découverts en relisant le travail de la
Mission 1, avant de passer au TP2.

**Agent** : A (périmètre : authentification).

**Problèmes trouvés et décisions prises** :

1. **Un mot de passe refusé provoquait une fin de session.**
   `authErrorInterceptor` appelait `logout()` + redirection sur **tout** `401`,
   y compris celui de `POST /api/auth/login`. La navigation vers `/login`
   recréait le composant, donc remettait son Signal `error()` à `''` :
   l'utilisateur ne voyait jamais pourquoi sa connexion avait échoué.
   *Décision* : exclure les routes publiques du contrat
   (`PUBLIC_AUTH_ROUTES` = `/api/auth/login`, `/api/auth/register`) du
   déclenchement du logout, en conservant la propagation de l'erreur pour que le
   formulaire affiche son message. Un `401` a deux sens selon la route : la
   distinction est maintenant explicite dans le code et commentée.
   *Documenté dans* `frontend-starter/docs/mission1/flux-connexion-et-signals.md`
   (§ « Cas de la connexion refusée »).

2. **Les messages d'erreur HTTP n'étaient pas présentables.**
   *Décision* : une méthode `AuthService.messageFromError(error, fallback)`,
   centralisée dans le service plutôt que dupliquée dans chaque composant. Elle
   réutilise le `{ message }` français déjà renvoyé par le backend, traite le
   statut `0` (serveur injoignable) et retombe sinon sur un libellé fourni par
   l'appelant. Elle n'affiche jamais un objet d'erreur brut.

3. **`localStorage` pouvait faire planter l'application.**
   `localStorage` lève une exception en navigation privée, quand le stockage de
   site est bloqué, en cas de quota dépassé, et n'existe pas dans
   l'environnement de test.
   *Décision* : `try/catch` sur les trois accès (lecture au démarrage, écriture
   au login, suppression au logout), avec une stratégie de repli différente pour
   chacun — les Signals restent la source de vérité pour la session en cours.
   *Détail du raisonnement* dans
   `frontend-starter/docs/mission1/flux-connexion-et-signals.md`
   (§ « Compléments après relecture du code actuel »).

**Deux autres corrections d'ergonomie** : les erreurs et la confirmation sont
désormais visibles à l'écran sur la page profil (elles n'étaient que dans la
console), et les liens vers les pages protégées sont masqués dans l'en-tête
quand aucun token n'est présent (`app.html`, branche `@else`).

**Fichiers modifiés** :
- `frontend-starter/src/app/shared/interceptors/auth-error.interceptor.ts`
- `frontend-starter/src/app/shared/services/auth.service.ts`
- `frontend-starter/src/app/components/profile-page/profile-page.ts`, `.html`
- `frontend-starter/src/app/components/app/app.ts`, `app.html`

**Preuve de fonctionnement** : la suite de tests était au vert après cette
étape, et quatre tests ont été ajoutés sur l'exclusion des routes publiques
(`auth-error.interceptor.spec.ts`, qui passe ainsi de 3 à 7 tests). La suite a
grossi par paliers successifs — **13 → 36 → 41 → 59 → 65 → 66** (fin du TP3) — puis
jusqu'à **188** après les bonus ; le total final mesuré est au § « Bilan des
vérifications automatisées » en fin de rapport.

**[À COMPLÉTER PAR LE BINÔME]** — vérification manuelle demandée : se connecter
avec un mot de passe volontairement faux et constater que (a) le message
d'erreur apparaît sous le formulaire, (b) on **reste** sur `/login`, (c) dans
l'onglet Network, la requête `POST /api/auth/login` est bien en `401`. Puis, à
l'inverse, altérer un caractère du token dans `localStorage` (clé `gpc_token`),
naviguer vers `/profile`, et constater le `401` **suivi** d'une redirection
automatique vers `/login` : c'est la démonstration que les deux sens du `401`
sont bien distingués. Joindre les captures.

---

## Mission 2 — Bibliothèque paginée (TP2)

**Objectif** : `TrackService.list(page, limit)` doit réellement transmettre
`page` et `limit` au serveur, et la page doit représenter son état avec des
Signals. Le sujet l'interdit explicitement : récupérer toutes les pistes puis
les découper localement dans Angular.

**Agent** : B (périmètre : bibliothèque et audio).

**Décisions prises** :

- **Pagination serveur, pas de découpage local.** `list()` passe `page` et
  `limit` en query params ; `load()` déclenche une nouvelle requête HTTP à chaque
  changement de page, et `tracks.set(response.items)` **remplace** le tableau au
  lieu de l'agrandir. Le nombre de pages affiché vient de `response.pages`,
  calculé par le backend — le frontend ne le recalcule pas.
- **L'état vient de la réponse, pas de l'optimisme local.** `go(page)` borne la
  cible, puis c'est `response.page` qui fixe la page courante. Si le serveur
  corrige la demande (il plafonne `limit` à 20), l'affichage reste cohérent.
- **Boutons désactivés aux bornes**, via des `computed` (`hasPrevious`,
  `hasNext`) qui tiennent compte de `loading()` : on ne peut pas empiler deux
  changements de page.
- **`takeUntilDestroyed`** sur les requêtes : quitter `/tracks` pendant une
  requête en vol ne doit plus écrire dans les Signals d'un composant détruit.
- **Rendu avec le contrôle de flux natif** d'Angular : `@for` pour la liste,
  `@empty` pour l'état vide, `@if` pour le chargement — comme demandé par le
  sujet, et non `*ngFor`/`*ngIf`.

**Fichiers modifiés** :
- `frontend-starter/src/app/shared/services/track.service.ts`
- `frontend-starter/src/app/components/tracks-page/tracks-page.ts`, `.html`,
  `.css`

**Preuve de fonctionnement** : suite de tests au vert et compilation sans
erreur après cette étape. Les tests de pagination sont dans
`tracks-page.spec.ts` (3 tests : `go(2)` émet bien `page=2`, aucune requête hors
bornes, pas de requête pour la page déjà affichée) et dans
`track.service.spec.ts` (« transmet les valeurs de page et limit demandées dans
la query string »). Chiffres complets au § « Bilan » en fin de rapport.

**[À COMPLÉTER PAR LE BINÔME]** — Checkpoint Network du TP2 : uploader au moins
6 fichiers pour avoir deux pages, puis cliquer « Suivant » et « Précédent » en
gardant l'onglet Network ouvert (filtre XHR/fetch). Relever pour chaque clic la
requête `GET /api/tracks?page=...&limit=...` et vérifier que **le paramètre
`page` change à chaque fois** — c'est exactement la preuve que la pagination est
faite par le serveur et non localement. Joindre la capture.

---

## Mission 3 — Analyse et amélioration de l'upload et de la lecture audio (TP2)

**Objectif** : le mécanisme principal existait déjà dans le starter. La mission
consistait d'abord à **l'analyser** (repérer chaque étape dans le code), puis à
ne compléter que ce qui manquait — sans réimplémenter l'existant ni modifier le
contrat HTTP.

**Agents** : B (code), D (analyse écrite et vérification des affirmations).

**Analyse produite** :
`frontend-starter/docs/tp2/upload-et-lecture-audio.md` — tableau de repérage
(fichier, méthode, ligne) des huit étapes demandées par le sujet, les deux flux
en diagrammes, l'explication du `Blob`/`ObjectURL`, et la réponse à « pourquoi
une URL dans `src` ne reçoit pas le JWT ».
`frontend-starter/docs/tp2/questions-memoire-buffering-streaming.md` — les cinq
questions du sujet sur mémoire, buffering et streaming, chaque réponse justifiée
par une ligne de code.

**Décisions prises côté code** :

- **Validation frontend alignée sur le backend, pas inventée.** Les constantes
  `MAX_FILE_SIZE` et la liste des types MIME sont **copiées à l'identique** du
  backend, et leurs commentaires citent la ligne source
  (`backend/src/app.js:31` et `:34-41`). Le but est qu'une divergence future
  soit repérable. La validation frontend évite un aller-retour réseau inutile
  mais **ne remplace jamais** la validation backend, qui reste l'autorité : elle
  est entièrement contournable.
- **Frontend volontairement plus permissif que le backend.** Quand `File.type`
  est vide — ce qui arrive selon le système d'exploitation — on retombe sur
  l'extension du fichier plutôt que de bloquer un fichier que le backend
  accepterait. Le frontend ne doit jamais refuser ce que le serveur accepterait.
- **`switchMap` contre les courses entre requêtes.** Toutes les demandes de
  lecture passent par un `Subject` : enchaîner deux morceaux annule la première
  requête, donc une réponse tardive ne peut plus écraser la plus récente (le
  lecteur jouerait A alors que l'interface affiche B).
- **Révocation de l'`ObjectURL` à deux endroits** : avant chaque nouvelle
  création (sinon la mémoire croît à chaque morceau écouté) **et** à la
  destruction du composant via `DestroyRef.onDestroy` (la dernière URL n'a, par
  construction, aucune lecture suivante pour la révoquer). Le second cas est
  celui qu'on oublie, car il n'est visible dans aucun test fonctionnel.
- **Deux sources d'erreur traitées séparément** : l'échec du téléchargement
  (`catchError` sur le pipe) et l'échec de décodage par l'élément `<audio>`
  lui-même (`(error)="onAudioError()"`). Sans le second, l'utilisateur verrait
  un lecteur muet sans explication — cas réel, car le backend accepte des
  conteneurs que tous les navigateurs ne décodent pas.
- **Message d'erreur honnête sur un `404`.** Le backend filtre sur `ownerId` :
  une piste inexistante et une piste appartenant à autrui renvoient toutes deux
  `404`. Le client ne peut pas les distinguer, donc le message dit « introuvable
  **ou** ne vous appartient pas » plutôt qu'une affirmation fausse.
- **Erreurs en mode `blob`** : le corps d'une réponse d'erreur est alors un
  `Blob`, pas du JSON. `error.error.message` n'existe pas. Une fonction dédiée
  traduit donc le statut HTTP en message, au lieu de lire le corps.

**Problème rencontré pendant la documentation** : les affirmations de l'agent B
sur le comportement du backend ont été **revérifiées ligne par ligne** avant
d'être reprises dans la documentation, plutôt que recopiées. Toutes se sont
confirmées (`res.sendFile` en `backend/src/app.js:394`, Multer en `diskStorage`
en `:88-99`, réponse JSON de métadonnées seules en `:310-316`). Un seul écart a
été trouvé, et il était dans la documentation existante et non dans le code : un
message d'erreur backend y était cité de mémoire (« Identifiants invalides »)
alors que le code écrit « Identifiants incorrects » (`backend/src/app.js:211`).
C'est une erreur bénigne, mais elle illustre exactement pourquoi il faut
revérifier : une citation approximative se propage ensuite dans tout un rapport.

**Fichiers modifiés** :
- `frontend-starter/src/app/shared/services/track.service.ts`
- `frontend-starter/src/app/components/tracks-page/tracks-page.ts`, `.html`,
  `.css`
- `frontend-starter/src/main.ts` (commentaire expliquant l'absence volontaire de
  `withFetch()`, nécessaire pour les événements de progression d'upload)

**Aucun fichier du backend n'a été modifié**, conformément au sujet et à
`frontend-starter/CLAUDE.md`.

**Preuve de fonctionnement** : suite de tests au vert et `npm run build`
réussi après cette étape. Chiffres complets au § « Bilan » en fin de rapport.
Preuves de contrat réellement obtenues contre l'API en fonctionnement :
`POST /api/tracks` multipart → `201` ; avec un fichier texte →
`400 {"message":"Format audio non accepté"}` ; sans fichier →
`400 {"message":"Fichier audio requis"}` ; `GET /api/tracks/:id/audio` avec JWT →
`200`, `content-type: audio/mpeg`, 552 994 octets ; **sans** JWT → `401` (la
démonstration directe de « pourquoi une URL dans `src` ne marche pas »).

**[À COMPLÉTER PAR LE BINÔME]** — trois vérifications, toutes détaillées pas à
pas dans `frontend-starter/docs/tp2/` :

1. **Upload valide** : relever la requête `POST /api/tracks`, vérifier que son
   `Content-Type` contient `multipart/form-data; boundary=...` et que le
   *Payload* montre bien les deux champs `audio` et `title`. Statut attendu
   `201`.
2. **Lecture authentifiée** : relever `GET /api/tracks/<id>/audio`, constater la
   **présence** de l'en-tête `Authorization` — sans jamais recopier sa valeur —
   et le `Content-Type` audio de la réponse.
3. **Erreur `400` sur fichier invalide** : la procédure du §6 de
   `upload-et-lecture-audio.md` explique comment obtenir les **deux** refus, le
   refus local (aucune requête émise) et le refus serveur (`400` avec son
   message). C'est la démonstration concrète que les deux validations ne sont pas
   redondantes.
4. **Isolation entre comptes** : avec un second compte, tenter de lire l'`id`
   d'une piste du premier et constater le `404`.

**Ce que chaque membre sait maintenant expliquer sans l'agent** :
**[À COMPLÉTER PAR LE BINÔME]** — la question la plus probable à l'oral est
« pourquoi ne pas mettre simplement l'URL dans `src` ? ». Assurez-vous de
pouvoir répondre sans notes, puis notez ici ce que chacun sait expliquer : le
trajet complet des octets (composant → service → `HttpClient` → API, puis
API → `Blob` → `ObjectURL` → lecteur), pourquoi un attribut `src` ne peut pas
porter d'en-tête `Authorization`, la différence entre streaming serveur /
téléchargement complet d'un `Blob` / buffering navigateur, ce que le choix du
`Blob` fait perdre, et pourquoi il faut révoquer l'`ObjectURL` à deux endroits
différents.

---

## Mission 5 — Suppression d'une piste (TP3)

**Objectif** : ajouter la suppression d'une piste avec confirmation, état de
suppression, message de succès ou d'erreur via SnackBar, rafraîchissement de la
page, et gestion du cas où la piste n'existe plus ou n'appartient pas à
l'utilisateur.

**Agents** : B (code), C (tests et revue), D (documentation).

**Décisions prises, et pourquoi** :

- **`deletingId` est un signal d'identifiant, pas un booléen.** Il sert à deux
  choses : la garde globale anti-double-clic, et le **ciblage de l'affichage** —
  seule la card concernée est désactivée et passe en « Suppression… ». Un booléen
  aurait grisé toute la liste.
- **Double protection contre le double-clic** : le bouton désactivé dans le
  template, *et* une garde en tête de méthode. La première guide l'utilisateur,
  la seconde couvre ce que le template ne voit pas (double-clic avant le cycle de
  rendu, appel programmatique).
- **`delete<void>`**, parce que le backend répond `204 No Content` : typer
  `delete<Track>` serait un mensonge de typage que le compilateur laisserait
  passer.
- **On recharge la liste depuis le serveur au lieu de retirer l'élément
  localement**, y compris dans la branche d'erreur. Retirer localement laisserait
  `total` et `pages` périmés, et n'afficherait pas la piste qui doit remonter dans
  la page. Sur une erreur `404`, la piste a probablement été supprimée ailleurs :
  la bonne réaction est de resynchroniser, pas de garder une card fantôme.
- **Retour à la page précédente** si on supprime la dernière piste d'une page
  non initiale, sinon l'utilisateur voit une liste vide alors que sa bibliothèque
  n'est pas vide.
- **Le lecteur audio est arrêté** si la piste supprimée était en cours de
  lecture. Sans cela, le morceau continuerait de jouer : son `src` est une URL
  `blob:` en mémoire locale, totalement indépendante du serveur. C'est un cas
  auquel on ne pense pas spontanément.
- **Message d'erreur volontairement prudent sur un `404`** : « Piste introuvable
  **ou** déjà supprimée ». Le backend filtre sur `ownerId`, donc trois situations
  différentes (piste inexistante, déjà supprimée, appartenant à autrui) donnent
  le même `404`. Le client ne peut pas les distinguer ; affirmer davantage serait
  faux. Ce `404` uniforme est d'ailleurs un choix de sécurité côté backend : un
  `403` confirmerait l'existence de la piste d'un autre utilisateur.

**Fichiers modifiés** :
- `frontend-starter/src/app/shared/services/track.service.ts`
- `frontend-starter/src/app/components/tracks-page/tracks-page.ts`, `.html`,
  `.css`
- `frontend-starter/package.json` (ajout de `@angular/material` et
  `@angular/cdk`, requis par le SnackBar demandé par le sujet — modification
  faite par l'orchestrateur, qui détient la configuration)

**Preuve de fonctionnement** : 6 tests dédiés dans `tracks-page.spec.ts` et 2
dans `track.service.spec.ts`. Preuves de contrat obtenues contre l'API réelle :
`DELETE /api/tracks/:id` → **`204` sans corps** ; `DELETE` sur une piste déjà
supprimée → **`404 {"message":"Piste inconnue"}`**.

**Documentation** : `frontend-starter/docs/tp3/suppression-de-piste.md`, dont un
§5 entier répond à la question du sujet « pourquoi le guard Angular et
l'interface ne suffisent pas ».

**[À COMPLÉTER PAR LE BINÔME]** — captures Network demandées : une suppression
**annulée** (aucune requête ne doit apparaître — c'est la moitié de la preuve
qu'on oublie), puis une suppression **confirmée** (`DELETE` en `204`, suivi du
`GET /api/tracks` de rechargement). Procédure détaillée dans
`docs/tp3/suppression-de-piste.md` §6.

---

## Mission 6 — Progression de l'upload (TP3)

**Objectif** : afficher la progression de l'upload en distinguant au minimum
quatre états (aucun envoi, en cours avec pourcentage, réussite, échec), désactiver
les contrôles pendant l'envoi et empêcher une seconde soumission.

**Agents** : B (code), C (tests et revue), D (documentation).

**Décisions prises, et pourquoi** :

- **`uploadProgress` est typé `number | null`.** Le `null` signifie « en cours,
  mais non mesurable », ce qui est différent de `0`. Quand l'événement n'annonce
  pas de `total`, afficher `0 %` serait un mensonge : la barre resterait figée et
  l'utilisateur croirait que rien ne se passe. `null` déclenche une `<progress>`
  sans valeur, que le navigateur rend comme une animation indéterminée.
- **La réussite ne se déclare que sur `HttpEventType.Response`.** C'est le point
  central de la mission : `loaded / total` compte les **octets sortis du
  navigateur**, rien d'autre. Après le dernier octet, le travail du serveur
  *commence* — validation du type MIME, de la taille, écriture disque,
  enregistrement en base. Chacune de ces étapes peut échouer **après** 100 %.
- **Le libellé affiché est « N % des octets transmis »**, pas « N % terminé ».
  Un utilisateur qui lit « 100 % terminé » suivi d'une erreur conclut à un bug ;
  s'il a lu « octets transmis », le message d'erreur reste cohérent.
- **Les quatre états ne sont pas un signal à quatre valeurs** mais la
  combinaison de trois signaux (`uploading`, `uploadProgress`, `uploadSuccess` /
  `uploadError`), ce qui évite de pouvoir représenter un état impossible.
- **En cas d'échec, le fichier et le titre sont conservés.** L'utilisateur n'a
  rien fait de mal : lui faire tout ressaisir après une coupure réseau serait une
  punition. Le formulaire n'est vidé qu'après confirmation du serveur.
- **`withFetch()` est proscrit**, et c'est documenté par un commentaire dans
  `main.ts`. L'API `fetch` du navigateur n'expose pas la progression de l'envoi.
  Le point important : l'ajouter ne provoquerait **aucune erreur de compilation
  ni aucun test rouge évident** — la fonctionnalité se dégraderait en silence. Le
  commentaire existe pour empêcher une « modernisation » bien intentionnée.
- **Accessibilité** : la barre porte `aria-valuemin/max/now` et un texte lisible
  double l'information visuelle. Une barre de progression sans équivalent textuel
  n'est pas perceptible par un lecteur d'écran.

**Fichiers modifiés** :
- `frontend-starter/src/app/shared/services/track.service.ts`
- `frontend-starter/src/app/components/tracks-page/tracks-page.ts`, `.html`,
  `.css`
- `frontend-starter/src/main.ts` (commentaire sur l'absence volontaire de
  `withFetch()`)

**Preuve de fonctionnement** : 6 tests dédiés dans `tracks-page.spec.ts`, dont
« ne déclare PAS la réussite à 100 % des octets transmis (seul `Response` la
prouve) » et « reste en indéterminé (`null`) quand l'événement n'annonce pas de
total » — le cas limite qu'un vrai serveur ne produirait pratiquement jamais, et
que seul `HttpTestingController` permet de provoquer de façon reproductible.

Preuves de contrat obtenues contre l'API réelle, qui illustrent directement le
« 100 % ≠ réussite » : `POST /api/tracks` avec un fichier texte →
**`400 {"message":"Format audio non accepté"}"`** ; sans fichier →
**`400 {"message":"Fichier audio requis"}`** ; multipart valide → **`201`**.

**Documentation** : `frontend-starter/docs/tp3/progression-upload.md`.

**[À COMPLÉTER PAR LE BINÔME]** — deux captures demandées : la barre **en cours**
de remplissage (activer le bridage réseau « Slow 4G » dans l'onglet Network, sinon
le transfert est trop rapide pour être vu), et surtout la capture la plus
démonstrative : un `.txt` renommé en `.mp3`, où la barre atteint **100 %** puis
le message « Format audio non accepté » s'affiche. Procédure dans
`docs/tp3/progression-upload.md` §6.

---

## Mission 7 — Tests automatisés (TP3)

**Objectif** : ajouter des tests ciblés sans remplacer les existants. Le sujet en
exige au moins trois parmi sept, et prévient qu'« un test qui ne vérifie aucune
assertion utile ne permet pas de valider la mission ».

**Agent** : C (tests et revue indépendante), avec relecture de l'orchestrateur.

**Résultat** : les **sept** tests proposés par le sujet sont couverts. La suite
est passée de 13 à **66 tests sur 10 fichiers** à la fin du TP3 (tous verts), puis à
**188 tests sur 15 fichiers** après les bonus.

**Décisions prises, et pourquoi** :

- **Tous les tests frontend sont unitaires**, avec `HttpTestingController` à la
  place de la couche réseau. Aucun test ne dépend d'un backend ou de MongoDB en
  fonctionnement, comme l'exige le sujet.
- **`HttpTestingController` n'est pas qu'une commodité, c'est ce qui rend
  certains tests possibles.** Contre un vrai serveur en local, le nombre
  d'événements `UploadProgress` n'est pas prévisible : le test serait
  *intermittent*, tantôt vert tantôt rouge. Le double permet d'émettre exactement
  la séquence voulue, y compris un `UploadProgress` **sans** `total`.
- **`httpMock.verify()` dans un `afterEach`** : fait échouer le test s'il reste
  une requête non traitée. Sans cela, un test qui déclenche une requête et
  l'oublie passerait au vert sans rien avoir vérifié.
- **`MatSnackBar` remplacé par un double** dans `tracks-page.spec.ts` : cela
  évite de monter un overlay Material sous jsdom (fragile et lent), et surtout
  cela permet d'**asserter le message affiché**, qui est un livrable explicite de
  la Mission 5. Un double n'est pas seulement une béquille, c'est un point
  d'observation.
- **Vérification par mutation systématique** : pour chaque test important, on
  casse volontairement la ligne de code qu'il protège, on vérifie que **ce test
  et lui seul** passe au rouge, puis on restaure. Un test vert ne prouve rien par
  lui-même ; un test qui reste vert quand on casse le code est inutile.
- **La limite est documentée, et il faut savoir la dire** : ces tests vérifient
  que le *frontend respecte le contrat*, pas que le backend le respecte. Si le
  backend renvoyait `totalPages` au lieu de `pages`, tous ces tests resteraient
  verts et l'application serait cassée. D'où les deux niveaux complémentaires :
  les 2 tests d'intégration backend, et les 12 vérifications `curl` contre l'API
  réelle (§ « Bilan »).

**Problèmes rencontrés et résolution** :

1. **Deux défauts signalés puis invalidés.** L'agent C a remonté deux problèmes
   qui n'existaient plus : il avait lu les fichiers avant les correctifs de
   l'agent A. Résolu en revérifiant le code avant d'acter tout défaut (voir la
   section sur l'organisation en sous-agents).
2. **Un commentaire faux découvert par la relecture.** Le commentaire de
   `canUpload` affirmait que `upload()` « revalide systématiquement ». En réalité
   `upload()` revalide le **fichier** mais **pas le titre** : pour le titre, le
   bouton désactivé est la seule barrière côté client, et le backend tranche. Le
   commentaire a été rectifié. À retenir : un commentaire faux est plus dangereux
   qu'un commentaire absent, car il décourage la vérification — et **aucun test
   ne peut l'attraper**.
3. **Un vrai bug de course, trouvé et corrigé avec son test.** Deux appels à
   `load()` peuvent se chevaucher : le cas réel est une **suppression confirmée
   pendant un changement de page**, qui émet deux `GET /api/tracks` concurrents.
   Si la réponse la plus ancienne arrive en dernier, elle écrase l'affichage de
   la plus récente — l'utilisateur voit une liste périmée, sans aucune erreur
   visible. Correctif : un compteur `loadSequence`, chaque appel capturant son
   numéro, et seule la réponse du dernier appel émis ayant le droit d'écrire dans
   les signaux (garde posée dans les **deux** callbacks, succès et erreur).
   Couvert par le test « ignore la réponse d'un chargement rendu obsolète par un
   plus récent », **validé par mutation** : garde retirée → 1 seul échec,
   exactement ce test ; garde remise → suite entière au vert (66/66 à ce moment-là).

C'est le meilleur argument à donner sur l'intérêt d'une relecture indépendante :
la suite était verte **avant** ces trois découvertes. Une suite de tests ne
détecte que ce qu'on a pensé à tester.

**Documentation** : `frontend-starter/docs/tp3/tests-automatises.md` (dont le
« rapport des tests » demandé en livrable) et
`frontend-starter/docs/tp3/restitution-orale.md` (les 6 questions de l'oral).

**[À COMPLÉTER PAR LE BINÔME]** — la vérification la plus rapide et la plus
convaincante à l'oral : choisir une ligne du tableau de mutations
(`docs/tp3/tests-automatises.md` §6), la casser, lancer `npm test`, capturer le
terminal **rouge** en notant quel test échoue et avec quel message, restaurer
(`git diff` pour vérifier qu'il ne reste rien), relancer et capturer le **vert**.
Ces deux captures côte à côte prouvent que vos tests observent réellement quelque
chose — ce qu'une capture verte seule ne prouve pas.

---

## Bonus et refonte UI/UX (facultatifs TP2 et TP3)

**Objectif** : réaliser les fonctionnalités facultatives des sujets (pagination
Mongoose, `MatPaginator`, filtre par titre, image de couverture, extension de tests
backend) et refondre l'interface de la coque, de la connexion, de l'inscription et
du profil, **sans casser** ce qui fonctionnait.

**État final** : code **figé** ; chiffres définitifs ci-dessous ; les 8 documents du
dossier `frontend-starter/docs/bonus/` plus deux nouveaux (`pochettes.md`,
`relecture-independante.md`) sont écrits.

### Orchestration : qui a fait quoi, et à qui les corrections sont revenues

Même équipe de sous-agents pilotée par un orchestrateur, avec des périmètres de
fichiers **exclusifs**.

| Agent | Périmètre | Corrections renvoyées après relecture |
|---|---|---|
| **E** | backend : pagination Mongoose, filtre `q`, tags ID3, routes de pochette, tests de contrat (`tracks.test.js`) | propriétaire de `backend/` : les défauts 1 à 4 de la relecture (dernier gestionnaire d'erreurs, bornes de `page`, extension de nom de fichier, ordre de suppression de la pochette) lui sont revenus |
| **F** | UI/UX de la coque, de la connexion, de l'inscription et du profil | propriétaire de ces fichiers ; le commentaire du lien d'évitement et la validation du nom (écarts signalés par D) ont été corrigés après vérification par l'orchestrateur |
| **G1** | page des pistes : filtre, `MatPaginator`, états vides, dialogue de suppression | propriétaire de `tracks-page/` : les défauts 5 et 6 (repli sur la dernière page valide, extension absente) et la restitution du focus après suppression |
| *vague 2* | interface des pochettes (`track-cover/`, `cover-search-dialog/`) | documentée dans `docs/bonus/pochettes.md` |
| **C** | tests et **relecture indépendante** | a trouvé les 6 défauts et écrit les tests rouges : `securite-bonus.test.js` (19 tests) et trois fichiers `*.review.spec.ts` |
| **D** | documentation (`frontend-starter/docs/**` et ce rapport) ; **aucun accès en écriture au code** | a signalé les écarts code/doc du tableau ci-dessous |
| **Orchestrateur** | configuration, intégration, mesures, validation finale | a corrigé le test incomplet de C (voir « incident de méthode ») et les deux écarts signalés par D qu'il a reconnus |

La règle appliquée : **un défaut est renvoyé à l'agent propriétaire du fichier**, pas
corrigé par celui qui l'a trouvé. C'est ce qui évite que deux agents modifient le même
fichier, et c'est pourquoi l'agent de documentation n'a corrigé aucun code.

### Décision : lever le gel du backend **pour les bonus uniquement**

Jusque-là, le backend était gelé : `SUJET_ETUDIANT_TP2.md` demande de ne pas le
modifier « pour les missions principales », et `frontend-starter/CLAUDE.md`
interdit d'y toucher. Le gel a été levé **uniquement** pour les bonus, parce que
les sujets l'**exigent eux-mêmes** :

- pagination Mongoose : « il faudra donc également mettre à jour
  `API_CONTRACT.md` et le frontend » (`SUJET_ETUDIANT_TP2.md`) ;
- image de couverture : le sujet demande d'« identifier les modifications de
  données et d'API avant toute implémentation » ;
- extension backend (TP3) : des tests, sans modification de route.

**Garde-fous retenus pour que cette dérogation ne casse rien** : contrat enrichi
**sans renommer ni retirer** une clé existante (les cinq clés historiques de
`Page<Track>` sont conservées, quatre sont ajoutées : rétro-compatible) ;
`API_CONTRACT.md` mis à jour dans le même lot ; filtre par propriétaire
(`ownerId`) conservé sur chaque route ; chaque nouvelle défense couverte par un
test, avec vérification par mutation ; preuves contre le vrai serveur ; relecture
indépendante. Les missions **obligatoires** n'ont pas vu leur contrat changer.

### Dépendances ajoutées (à signaler, selon les règles de sécurité du cours)

| Paquet | Où | Version | Licence | Raison | Maintenance |
|---|---|---|---|---|---|
| `mongoose-aggregate-paginate-v2` | backend | `^1.1.5` | MIT | pagination par agrégation, demandée par le sujet | 1.1.5 publiée le 2026-08-03 (registre npm consulté) |
| `music-metadata` | backend | `^11.16.1` | MIT | lecture des tags ID3 | `latest` = 11.16.1 (registre) ; date « septembre 2026 » donnée par l'orchestrateur, **non recoupée** |
| `@angular/material` | frontend | `^22.2.0` | MIT | `MatPaginator`, `MatDialog`, `MatSnackBar` (demandé par les sujets) | même version majeure qu'Angular |
| `@angular/cdk` | frontend | `^22.2.0` | MIT | dépendance de Material | idem |
| `jsdom` | frontend (dev) | `^30.1.0` | *non relevée* | environnement DOM des tests (ajouté dès le TP1) | — |

**Coût mesuré** : le build de production passe de 456,75 kB (112,38 kB transférés)
avant les bonus à **737,04 kB (161,41 kB transférés)**, sans avertissement. Cette
hausse regroupe le paginator, les dialogues, le thème Material et les pochettes ; la
part de chaque élément n'a pas été mesurée.

### Ce qui a été prouvé en réel, et ce qui ne l'a été que par des tests simulés

| Niveau | Contenu | Où |
|---|---|---|
| **Réel** — **56 OK / 0 KO** contre le vrai serveur, MongoDB Atlas et le vrai service iTunes, **rejoués sur le backend corrigé**, plus **5 cas** ajoutés (`page=1e20` → 200 ; `page=Infinity` → 200 ; `:id` invalide → 404 ; `q=a&q=b` → 400 ; extension de 230 caractères → 201) ; résultats rapportés par l'orchestrateur, **non rejoués** par l'agent de documentation | upload de 7 pistes, tags ID3, pagination, filtre, isolation entre comptes, pochettes, 401 sur les 5 nouvelles routes, iTunes réel, 7 URL SSRF refusées, absence de fichier orphelin | `docs/bonus/preuves-integration-reelle.md` |
| **Simulé** — 50 nouveaux tests backend (31 + 19), MongoDB et réseau remplacés | six cas du sujet, ID3, filtre, pochettes, anti-SSRF, durcissements | `docs/bonus/tests-de-contrat-backend.md` |
| **Simulé** — tests frontend avec `HttpTestingController` | filtre, paginator, états vides, dialogues, pochettes | `docs/bonus/` |
| **Jamais prouvé en réel** | JWT expiré (jamais testé), délai réel de 5 s (jamais atteint), limite d'appels d'Apple (~20/min), redirections limitées à 3 (test simulé seulement), valeurs de `prevPage` hors bornes | `docs/bonus/preuves-integration-reelle.md` |
| **Non vérifié du tout** | rendu navigateur : thème sombre, mouvement réduit, contrastes, lecteur d'écran, **piégeage du focus des dialogues** ; **toutes les captures Network** | marqueurs ci-dessous |

Ces preuves en ligne de commande valident le **contrat HTTP**. Elles ne sont **pas**
des captures Network du navigateur et ne les remplacent pas. Le serveur de test
tournait sur le port 3100 (le 3000 étant occupé par le serveur du binôme) : le proxy
du frontend n'était donc pas impliqué. Deux utilisateurs temporaires restent dans la
base (aucune route de suppression de compte).

### Mesures définitives

Mesures de l'orchestrateur sur le code figé.

| Mesure | Valeur |
|---|---|
| `npm test` frontend | **188 tests / 15 fichiers, 188 verts, 0 rouge** (167 blocs `it(` + 21 cas générés par des `it.each`) |
| `cd backend && npm test` | **52 tests, 52 verts** = 2 existants + 31 (`tracks.test.js`) + 19 (`securite-bonus.test.js`) |
| `npx tsc --noEmit` (app **et** spec) | exit 0, aucune erreur |
| `npm run build` | succès, **737,04 kB (161,41 kB transférés)**, contre 456,75 kB (112,38 kB) avant les bonus |
| Intégration réelle | **56 OK / 0 KO** + 5 cas |

### La relecture indépendante (agent C) : six défauts réels

Détail, preuves et limites dans `docs/bonus/relecture-independante.md`. En résumé :
(1) erreur interne non typée → page HTML avec pile d'appels ; (2) `page=1e20` →
`$skip` invalide ; (3) extension de nom de fichier de 300 caractères → `ENAMETOOLONG`
puis 500 ; (4) `DELETE` d'une piste dont l'audio a disparu laissait la pochette
orpheline ; (5) piste supprimée ailleurs puis actualisation → « bibliothèque vide »
alors que `total = 5` ; (6) fichier sans point dans le nom → « Image non acceptée (e) ».
Les défauts 1 à 3 sont **hérités du package initial** (identiques à `HEAD`) : corrigés
parce que les nouvelles routes en dépendent. Chacun a été prouvé par un **test rouge
volontaire** puis vert (séquences rapportées par l'orchestrateur, non rejouées par D).

**Ce qu'elle a examiné sans rien trouver** : propriété inséparable de toute requête,
redirections SSRF revalidées à chaque saut, plafond de 2 Mo appliqué en flux,
`nosniff`, `ObjectURL` révoquées sur tous les chemins, aucun JWT dans les journaux.

**Incident de méthode, sans enjoliver.** Un test écrit par C échouait après le
correctif du défaut 5. L'analyse a montré que **le test était incomplet, pas le
code** : il attendait un état sans le rechargement unique du repli sur la dernière
page. L'orchestrateur l'a corrigé. Moralité : un test rouge ne prouve pas à lui seul
un défaut du code.

**Limites connues, non corrigées** (liste complète dans le document) : secret JWT par
défaut codé en dur dans le package initial ; `authInterceptor` ajoute le Bearer à toute
URL (latent) ; course de deux `PUT` de pochette simultanés ; deux `GET /api/users/me`
après un F5 sur `/profile` ; `hasPrevious`/`hasNext` conservés alors que morts ; focus
piégé des dialogues non vérifié par test ; JWT expiré non testé ; rendu navigateur non
vérifié par un humain.

### Ce que la documentation a révélé : écarts code / doc, avec leur résolution

Le travail de l'agent D consiste aussi à relire le code livré par les autres et à
signaler ce qui ne colle pas.

| Constat | Nature | Traitement |
|---|---|---|
| Les docs du TP3 décrivaient `window.confirm()` ; c'est maintenant un `MatDialog` | doc périmée | `tp3/suppression-de-piste.md`, `restitution-orale.md` corrigés |
| Les docs du TP2 décrivaient `upload.single("audio")` / `req.file` ; le backend utilise `upload.fields(audio, cover)` | doc périmée | `tp2/upload-et-lecture-audio.md`, `mission0-cartographie.md` corrigés |
| Le bouton de lecture s'appelle « Lire » (les docs disaient « Écouter ») | doc périmée | corrigé dans `tp2/` |
| Le sujet TP2 demande `@empty` ; le template n'en utilise plus (**trois** états vides distincts : filtre actif / bibliothèque vide / page disparue) | écart assumé avec le sujet | `bonus/filtre-par-titre.md` §3.4 |
| `hasPrevious` / `hasNext` (`tracks-page.ts`) ne sont plus lus par aucun template ni test | code mort | **signalé, non modifié** |
| Le commentaire du lien d'évitement invoquait `<base href="/">` alors qu'aucune balise `<base>` n'existe | explication fausse dans le code | **corrigée par l'orchestrateur** ; `bonus/ui-ux-authentification.md` §4 |
| Le test du lien d'évitement vérifie le focus, **pas** `preventDefault()` | trou de test | signalé |
| « Enregistrer » : le frontend n'exigeait pas les 2 caractères minimum du backend | trou de validation | **corrigé** (`trimmedMinLength`) ; la comparaison reste faite sur la valeur brute (« Alice␣ » ≠ « Alice »), effet nul |
| Après un F5 sur `/profile`, **deux** `GET /api/users/me` partent (coque + page) | limite connue de F | documentée, non corrigée |
| `prevPage` du plugin de pagination vaut `page - 1` sans plafond | lu dans le code du plugin, **non observé** | `bonus/pagination-mongoose.md` |
| Le tableau de mutations du TP3 était présenté comme « appliqué » alors qu'**une seule** ligne l'était | **sur-affirmation de ma part (lot 2)** | corrigé dans `tp3/tests-automatises.md` |
| Chaque card télécharge désormais sa pochette (jusqu'à une page d'images) : la réponse « aucun fichier chargé à l'affichage de la liste » ne vaut plus que pour l'**audio** | doc à nuancer | nuance ajoutée (`tp2/questions-memoire-buffering-streaming.md`, Q3) |
| « Le backend n'a jamais été modifié » (doc du TP3) devenu faux après la levée du gel | doc périmée | corrigé dans `tp3/tests-automatises.md` |
| Des commentaires **du code** (`cover-file.ts`, `tracks-page.ts`) citent encore des lignes du backend qui ont bougé | commentaires périmés dans le code | **signalé, non modifié** (hors périmètre de D) |
| Conditions d'Apple vs notre copie locale des pochettes web | question de droits | **décision ouverte**, voir ci-dessous |

### Décision ouverte, à prendre par le binôme : copie locale des pochettes web

Les conditions d'utilisation de l'API de recherche d'Apple, lues pendant la rédaction
(résumé obtenu, de seconde main), mentionnent que certains contenus doivent être
*diffusés sans être téléchargés ni mis en cache*. Notre backend, lui, **télécharge puis
conserve une copie** de la pochette choisie dans `data/uploads/covers`. Le texte lu
parle d'extraits promotionnels : **on ne sait pas** s'il couvre les pochettes.

**Cette décision n'est pas tranchée par la documentation.** Option réversible à
envisager : **ne pas enregistrer l'image côté serveur, seulement son URL**, au prix
d'une dépendance à `mzstatic.com` et d'un affichage cassé si l'URL expire (comparaison
détaillée dans `docs/bonus/etude-id3-et-services-web.md` §5). Autres issues possibles :
garder la copie locale, ou retirer la recherche Web et ne garder que l'upload et l'ID3.
Les miniatures de la recherche sont, elles, chargées directement par le navigateur
depuis Apple.

### Problème rencontré : citer des numéros de ligne sur du code qui bouge

Pendant la rédaction, `backend/src/app.js` est passé d'environ 870 à 885 lignes et
`tracks-page.ts` à 1039 lignes. Les numéros de ligne de plusieurs documents sont donc
devenus faux **pendant** l'écriture, y compris ceux du backend, que l'on avait supposé
stable. **Résolution** : quand le code a été gelé, une **passe de vérification** a
re-contrôlé les renvois de l'ensemble des documents : un outil jetable (hors dépôt) a affiché,
pour chaque renvoi, la ligne réellement citée ; chaque écart a été corrigé à la main
d'après le contexte (de l'ordre de 370 remplacements, mesure approximative, dont
quelques corrections de texte associées). L'outil ne comprend pas les phrases : un contrôle automatique de
« la ligne contient le bon mot » a été complété par une relecture ; **il ne garantit
pas** que tous les renvois sont exacts. Là où un numéro n'était pas garanti, seul le
nom de la fonction a été conservé. Le risque réel reste qu'un étudiant se fie à un
numéro sans lire le nom.

### Ce que seul le binôme peut faire (et que personne n'a fait)

Aucun marqueur `[À COMPLÉTER PAR LE BINÔME]` n'a été rempli par un agent. Chacun est
détaillé pas à pas (onglet, clics, valeur à relever) dans le document indiqué.

1. **Captures Network du navigateur** — pagination (`pagination-mongoose.md`), filtre `q` (`filtre-par-titre.md`), paginator (`materiel-paginator.md`), upload avec `cover`, `GET …/cover`, recherche Web, remplacement en place, retrait (`pochettes.md` §8), suppression et upload avec progression (`tp3/`).
2. **Vérification visuelle** : thème clair et sombre, mouvement réduit, contrastes (`ui-ux-authentification.md`).
3. **Vérification au clavier**, dont le **focus des dialogues** (lien d'évitement, `Tab` dans les deux dialogues, focus après suppression) — `ui-ux-authentification.md`, `pochettes.md`, `relecture-independante.md`.
4. **Rejouer une mutation** : retirer `escapeRegex` et capturer le rouge puis le vert — `tests-de-contrat-backend.md`.
5. **Rejouer un défaut de la relecture** (`page=1e20`) avec votre propre jeton, sans le recopier — `relecture-independante.md`.
6. **Décider** de la copie locale des pochettes web après lecture des conditions d'Apple — `etude-id3-et-services-web.md` §5.
7. **Constater** les deux `GET /api/users/me` après un F5 sur `/profile` — `ui-ux-authentification.md` §8.
8. **Cocher** ce que vous avez réellement vérifié, ligne par ligne — `matrice-facultatives.md`.
9. **Test à deux des questions orales** (TP3, grille d'auto-évaluation) et **ce que chaque membre sait expliquer sans l'agent** sur les bonus — par exemple pourquoi un filtre local serait interdit, pourquoi on échappe les métacaractères, ce qu'est une SSRF et pourquoi on teste la *fin* de l'hôte, pourquoi un test qui simule MongoDB ne prouve pas ce que fait MongoDB, pourquoi une suite verte n'a pas empêché six défauts : [À COMPLÉTER PAR LE BINÔME].
10. **Identité du modèle et niveau de raisonnement** réellement utilisés, relevés dans l'outil et non demandés à l'assistant : [À COMPLÉTER PAR LE BINÔME].
11. **Confirmer que le mot de passe MongoDB exposé plus tôt dans le chat a bien été changé sur Atlas** (voir « Remarque de sécurité » au début du rapport) : [À COMPLÉTER PAR LE BINÔME].

**Total des marqueurs `[À COMPLÉTER PAR LE BINÔME]` dans la documentation et ce rapport : 52 occurrences littérales**, comptées par recherche textuelle sur `frontend-starter/docs/**` et ce fichier : 25 consignes de procédure dans les documents thématiques (`mission1/`, `tp2/`, `tp3/`, `bonus/`), 19 dans ce rapport (y compris les rappels de cette liste), 8 renvois dans les deux index (`docs/README.md`, `bonus/README.md`). Toutes sont à traiter par le binôme ; aucune n'a été remplie. Ce décompte est une mesure textuelle, pas une liste de tâches distinctes : plusieurs occurrences désignent la même capture.

**Documentation produite** : `frontend-starter/docs/bonus/` (index, `matrice-facultatives.md`,
`pagination-mongoose.md`, `filtre-par-titre.md`, `materiel-paginator.md`,
`tests-de-contrat-backend.md`, `preuves-integration-reelle.md`,
`etude-id3-et-services-web.md`, `ui-ux-authentification.md`, `pochettes.md`,
`relecture-independante.md`).

---

## Mission Documentation (transversale)

**Objectif** : produire les livrables écrits des TP1 et TP2 et tenir ce rapport
à jour.

**Agent** : D. Périmètre volontairement restreint à
`frontend-starter/docs/**` et `RAPPORT_IA_MODELE.md` — **aucun accès en écriture
au code**, pour qu'une erreur de documentation ne puisse jamais casser
l'application.

**Règle de travail imposée à cet agent** :

1. **Ne rien affirmer sans l'avoir lu dans le code.** Chaque affirmation porte
   son `fichier:ligne`. Les conclusions des autres agents ont été revérifiées à
   la source avant d'être reprises (voir l'écart trouvé, Mission 3).
2. **Ne rien fabriquer d'humain.** Aucune capture Network, aucun résultat de
   test, aucun compteur de tokens, aucune vérification faite par le binôme n'est
   inventé. Chacun de ces points est marqué **[À COMPLÉTER PAR LE BINÔME]** et
   accompagné d'une procédure précise : quel onglet ouvrir, quoi cliquer, quoi
   relever.
3. **Aucun secret.** Pas d'URI MongoDB, pas de secret JWT, pas de mot de passe,
   pas de valeur de token. Les procédures de vérification précisent de ne relever
   que la **présence** de l'en-tête `Authorization`, jamais sa valeur.
4. **Compléter plutôt que réécrire.** La documentation de la Mission 1 a été
   corrigée et enrichie sur place, pas remplacée par de nouveaux fichiers, pour
   éviter deux versions divergentes d'une même explication.

**Fichiers produits ou complétés** :
- `frontend-starter/docs/README.md` *(nouveau)* — index, arborescence, et
  tableau « livrable du sujet → où il se trouve »
- `frontend-starter/docs/mission0-cartographie.md` *(nouveau)* — cartographie
  de l'application, routes publiques vs protégées (y compris `GET /api/health`)
- `frontend-starter/docs/tp2/upload-et-lecture-audio.md` *(nouveau)*
- `frontend-starter/docs/tp2/questions-memoire-buffering-streaming.md`
  *(nouveau)*
- `frontend-starter/docs/mission1/flux-connexion-et-signals.md` *(complété)* —
  diagramme revérifié contre le code, chemin d'erreur ajouté, `try/catch`
  `localStorage` expliqué
- `frontend-starter/docs/mission1/questions-reponses.md` *(complété)* — chaîne
  complète de la mise à jour du profil, front et back, méthode et ligne
- `frontend-starter/docs/mission1/probleme-3-gestion-401.md` *(corrigé)* — une
  affirmation fausse retirée (le retour vers l'URL d'origine après `401` n'est
  pas implémenté), l'exclusion des routes publiques documentée, et le décompte
  de tests porté de 3 à 7
- `frontend-starter/docs/tp3/` *(second lot)* — `suppression-de-piste.md`,
  `progression-upload.md`, `tests-automatises.md`, `restitution-orale.md`
- `frontend-starter/docs/bonus/` *(troisième lot)* — `README.md`,
  `matrice-facultatives.md`, `pagination-mongoose.md`, `filtre-par-titre.md`,
  `materiel-paginator.md`, `tests-de-contrat-backend.md`,
  `preuves-integration-reelle.md`, `etude-id3-et-services-web.md`,
  `ui-ux-authentification.md` (voir la section « Bonus et refonte UI/UX ») ; puis,
  après gel du code (quatrième lot), `pochettes.md` et `relecture-independante.md`
- troisième lot, **corrections** de documents existants : `docs/README.md`,
  `mission0-cartographie.md` (nouvelles routes, `upload.fields`, coque),
  `mission1/questions-reponses.md` et `flux-connexion-et-signals.md` (lignes
  recalées sur l'interface refondue), `tp2/upload-et-lecture-audio.md` et
  `questions-memoire-buffering-streaming.md` (backend modifié, pochettes),
  `tp3/suppression-de-piste.md`, `restitution-orale.md`, `tests-automatises.md`
  (dialogue Material, mutations, instantané des chiffres)
- quatrième lot (code figé) : **passe de vérification des renvois `fichier:ligne`** sur
  l'ensemble des documents (de l'ordre de 370 remplacements), chiffres définitifs
  (188 tests frontend / 52 backend / build 737,04 kB) dans `tp3/tests-automatises.md`,
  `mission1/README.md`, `bonus/materiel-paginator.md`, `bonus/pagination-mongoose.md`,
  `tp3/restitution-orale.md` ; décision ouverte sur les conditions d'Apple posée dans
  `bonus/etude-id3-et-services-web.md` §5
- ce fichier

**Écarts trouvés entre la documentation et le code, et corrigés** — c'est le
cœur du travail de cet agent, et la raison pour laquelle il revérifie tout dans
le code au lieu de recopier les conclusions des autres agents :

| Écart | Nature |
|---|---|
| « en conservant éventuellement l'URL d'origine » (`probleme-3`) | fonctionnalité **jamais implémentée** : `navigateByUrl('/login')` ne transmet aucun `returnUrl` |
| « Identifiants invalides » cité comme message backend | le code écrit **« Identifiants incorrects »** — citation faite de mémoire |
| « 3/3 tests verts » pour `auth-error.interceptor.spec.ts` | le fichier en compte **7** depuis le correctif des routes publiques |
| « 13 tests verts sur 13 » présenté comme état final | c'était l'état **à la fin de la Mission 1** ; le total est passé à 66 à la fin du TP3, puis à 188 |
| Numéros de ligne de `tracks-page.ts` et de `backend/src/app.js` | devenus faux pendant la rédaction (fichiers encore en cours de modification) — recalculés une fois le code figé (passe de vérification du quatrième lot), avec le **nom de la méthode** conservé à côté pour qu'il fasse foi |

Une citation approximative se propage ensuite dans tout un rapport : c'est
précisément ce que la règle « toujours citer `fichier:ligne` » sert à empêcher.

**Second lot (TP3)** : les Missions 5, 6 et 7 ont été documentées dans un second
temps, une fois le code figé — délibérément, pour ne pas décrire un état
intermédiaire. Fichiers ajoutés :
- `frontend-starter/docs/tp3/suppression-de-piste.md`
- `frontend-starter/docs/tp3/progression-upload.md`
- `frontend-starter/docs/tp3/tests-automatises.md`
- `frontend-starter/docs/tp3/restitution-orale.md`

**Problème rencontré, et à retenir du travail en parallèle** : lors du premier
lot de documentation, les numéros de ligne cités pour `tracks-page.ts` sont
devenus faux pendant la rédaction, parce que l'agent B modifiait encore ce
fichier. Ils ont été recalculés, et un avertissement a été ajouté dans les
documents concernés : en cas d'écart, se repérer au **nom de la méthode** (qui
est stable) plutôt qu'au numéro de ligne. C'est une limite réelle de la citation
`fichier:ligne` sur un code en mouvement.

---

## Bilan des vérifications automatisées

Commandes lancées par l'orchestrateur, et non par la documentation. Aucun chiffre
n'est estimé : le tableau ci-dessous reprend la sortie réelle des commandes.

> **Chiffres définitifs.** La colonne « État final » ci-dessous donne les mesures de
> l'orchestrateur sur le code **figé**, après les bonus. Le jalon « 66 tests, build à
> 456,75 kB » est conservé comme **fin du TP3**, daté.

### Avant / après

| Commande | Avant toute intervention | Fin du TP3 | **État final (après bonus)** |
|---|---|---|---|
| `npm test` (frontend) | 13 tests / 5 fichiers, 13 verts | 66 tests / 10 fichiers, 66 verts | **188 tests / 15 fichiers, 188 verts, 0 rouge** |
| `npm run build` (frontend) | 296,06 kB (78,37 kB transférés) | 456,75 kB (112,38 kB transférés) | **737,04 kB (161,41 kB transférés)**, sans avertissement |
| `npm test` (backend) | 2 tests, 2 verts | 2 tests, 2 verts | **52 tests, 52 verts** (2 + 31 + 19) |
| Intégration réelle (serveur + Atlas + iTunes) | — | — | **56 OK / 0 KO** + 5 cas |

| Vérification complémentaire | Résultat |
|---|---|
| `npx tsc --noEmit -p tsconfig.app.json` | **exit 0, aucune erreur** |
| `npx tsc --noEmit -p tsconfig.spec.json` | **exit 0, aucune erreur** |
| `curl http://localhost:3000/api/health` | **HTTP 200**, corps `{"status":"ok"}` |
| `git status` sur `backend/src` et `API_CONTRACT.md` | **modifiés pour les bonus uniquement** (gel levé, voir la section « Bonus ») ; aucune modification pendant les missions obligatoires |

**Progression de la suite de tests** : 13 → 36 → 41 → 59 → 65 → 66 (fin du TP3) →
**188** (état final), soit près de quinze fois le point de départ. Les deux derniers paliers ne viennent pas de nouvelles
fonctionnalités mais d'une **relecture indépendante** du code déjà écrit
(59 → 65), puis d'un **bug de course découvert par cette relecture** et corrigé
avec son test (65 → 66) — voir la Mission 7 ci-dessus. Le passage de 66 à 188 vient des
bonus, de la refonte d'interface et de la relecture indépendante des bonus.

**Sur la hausse du poids du bundle** (296,06 → 456,75 kB, puis 737,04 kB avec les bonus ; la deuxième hausse est détaillée dans la section « Bonus ») : elle vient de l'ajout
d'Angular Material, requis par la Mission 5 du TP3 qui demande explicitement un
« composant Angular SnackBar ». Importer un composant Material entraîne aussi son
thème et une partie du CDK, d'où une augmentation bien supérieure à la taille du
seul SnackBar. C'est un coût assumé, et c'est le genre d'arbitrage qu'il faut
savoir justifier plutôt que subir.

**Le backend et le contrat.** Pendant les missions obligatoires le backend n'a pas été
modifié (ses 2 tests passaient avant et après). Pour les **bonus uniquement**, le gel a
été levé et `API_CONTRACT.md` mis à jour dans le même lot (décision et garde-fous dans
la section « Bonus »). Les 2 tests d'origine passent toujours.

**Concordance vérifiée** : le décompte statique du frontend (167 blocs `it(` + 21 cas
des `it.each` = 188) concorde avec la sortie de `npm test` ; celui du backend (2 + 31 +
19) avec les 52 tests. Répartition par fichier dans
`frontend-starter/docs/tp3/tests-automatises.md` §2.

### Vérifications de contrat exécutées contre l'API réelle

Douze appels en **ligne de commande** contre le backend en fonctionnement, avec
le compte de démonstration. Ils complètent les tests unitaires, qui ne valident
pas le vrai serveur (leurs réponses sont simulées).

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

**Ces appels ne remplacent pas les captures Network.** Ils valident le contrat
HTTP vu de la ligne de commande ; ils ne prouvent rien sur la confirmation de
suppression, le SnackBar, la barre de progression ou la lecture audio, qui
n'existent que dans un navigateur.

**[À COMPLÉTER PAR LE BINÔME]** : relancer vous-mêmes ces commandes et joindre
une capture du terminal. Un résultat rapporté par un assistant n'est pas une
preuve : c'est la commande que vous exécutez qui en est une. Rangez les captures
dans `frontend-starter/docs/captures/` et liez-les depuis ce fichier, par
exemple `![npm test](frontend-starter/docs/captures/npm-test.png)`.

Ce qu'une suite de tests verte **ne** prouve pas, et qu'il faut donc vérifier à
la main dans le navigateur (procédures dans `frontend-starter/docs/`) : que
l'interface est réellement utilisable, que les messages d'erreur sont
compréhensibles, que les requêtes Network sont bien celles attendues, et que
l'`ObjectURL` est effectivement révoquée.

## Journal automatique des modifications

- [2026-10-02 16:36] Write — backend/test/securite-bonus.test.js
- [2026-10-02 16:40] Write — frontend-starter/src/app/components/tracks-page/tracks-page.review.spec.ts
- [2026-10-16 13:34] Edit — README.md
- [2026-10-23 14:12] Write — frontend-starter/src/app/shared/models/clip.model.ts
- [2026-10-23 14:12] Write — frontend-starter/src/app/shared/services/clip.service.ts
- [2026-10-23 14:12] Write — frontend-starter/src/app/shared/services/clip.service.spec.ts
- [2026-10-23 14:13] Write — frontend-starter/src/app/shared/analysis/cut-detector.ts
- [2026-10-23 14:13] Write — frontend-starter/src/app/shared/analysis/beat-detector.ts
- [2026-10-23 14:13] Write — backend/src/models/Clip.js
- [2026-10-23 14:13] Write — frontend-starter/src/app/shared/analysis/sync-score.ts
- [2026-10-23 14:13] Write — frontend-starter/src/app/shared/analysis/shot-length.ts
- [2026-10-23 14:14] Write — frontend-starter/src/app/shared/analysis/cut-detector.spec.ts
- [2026-10-23 14:14] Write — frontend-starter/src/app/shared/analysis/beat-detector.spec.ts
- [2026-10-23 14:14] Write — frontend-starter/src/app/shared/analysis/sync-score.spec.ts
- [2026-10-23 14:14] Write — frontend-starter/src/app/shared/analysis/shot-length.spec.ts
- [2026-10-23 14:15] Write — backend/test/clips.test.js
- [2026-10-23 14:16] Write — frontend-starter/src/app/shared/services/clip-analyzer.service.ts
- [2026-10-23 14:17] Write — frontend-starter/src/app/shared/services/clip-analyzer.service.spec.ts
- [2026-10-23 14:19] Edit — frontend-starter/src/app/shared/services/clip-analyzer.service.spec.ts
- [2026-10-23 14:30] Write — frontend-starter/src/app/components/pulse-timeline/pulse-timeline.ts
- [2026-10-23 14:30] Write — frontend-starter/src/app/components/clips-page/clips-page.ts
- [2026-10-23 14:30] Write — frontend-starter/src/app/components/pulse-timeline/pulse-timeline.html
- [2026-10-23 14:30] Edit — frontend-starter/src/app/components/pulse-timeline/pulse-timeline.html
- [2026-10-23 14:30] Edit — frontend-starter/src/app/components/pulse-timeline/pulse-timeline.ts
- [2026-10-23 14:30] Write — frontend-starter/src/app/components/pulse-timeline/pulse-timeline.css
- [2026-10-26 19:03] Write — frontend-starter/src/app/components/pulse-timeline/pulse-timeline.spec.ts
- [2026-10-26 19:04] Write — frontend-starter/src/app/components/clips-page/clips-page.html
- [2026-10-26 19:04] Write — frontend-starter/src/app/components/clip-detail/clip-detail.ts
- [2026-10-26 19:04] Write — frontend-starter/src/app/components/clip-detail/clip-detail.html
- [2026-10-26 19:04] Write — frontend-starter/src/app/components/clip-detail/clip-detail.css
- [2026-10-26 19:04] Write — frontend-starter/src/app/components/clips-page/clips-page.css
- [2026-10-26 19:05] Write — frontend-starter/src/app/components/clip-detail/clip-detail.spec.ts
- [2026-10-26 19:05] Edit — frontend-starter/src/app/components/clip-detail/clip-detail.spec.ts
- [2026-10-26 19:05] Write — frontend-starter/src/app/components/clips-page/clips-page.spec.ts
- [2026-10-26 19:07] Edit — frontend-starter/src/app/components/pulse-timeline/pulse-timeline.spec.ts
- [2026-10-26 19:08] Write — frontend-starter/src/app/components/clip-compare/clip-compare.ts
- [2026-10-26 19:09] Write — frontend-starter/src/app/components/clip-compare/clip-compare.html
- [2026-10-26 19:09] Write — frontend-starter/src/app/components/clip-compare/clip-compare.css
- [2026-10-26 19:09] Edit — frontend-starter/src/app/routes.ts
- [2026-10-26 19:09] Edit — frontend-starter/src/app/components/clips-page/clips-page.html
- [2026-10-26 19:10] Edit — frontend-starter/src/app/components/clips-page/clips-page.html
- [2026-10-26 19:10] Write — frontend-starter/src/app/components/clip-compare/clip-compare.spec.ts
- [2026-10-26 19:15] Edit — frontend-starter/src/app/components/clips-page/clips-page.spec.ts
- [2026-10-26 19:16] Edit — frontend-starter/src/app/shared/services/clip-analyzer.service.spec.ts
- [2026-10-26 19:18] Edit — README.md
- [2026-10-26 19:18] Write — REPORT.md
