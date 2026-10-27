# Relecture indépendante des bonus (agent C)

Une fois les bonus réalisés (backend par l'agent E, interface par F et G1), un
agent qui **ne les avait pas écrits** — l'agent C, tests et revue — a relu le code
avec une consigne simple : chercher ce qui ne va pas, le prouver par un test qui
échoue, puis vérifier que le correctif le fait passer.

Ce document présente honnêtement ce travail : ce qui a été trouvé, comment ça a été
prouvé, ce qui a été examiné **sans** rien trouver, un incident de méthode, et les
limites qui restent.

> **Provenance des résultats.** Les constats, l'ordre « test rouge volontaire puis
> test vert » et les totaux de tests ont été communiqués par l'orchestrateur ;
> l'agent de documentation n'a **pas rejoué** ces séquences. Ce qu'il a vérifié
> lui-même, c'est la **présence dans le code** de chaque correctif et de chaque test
> cité ci-dessous. Les numéros de ligne sont ceux du code figé.

Chemins relatifs à la racine du dépôt (`backend/…`) ou à `frontend-starter/`.

---

## 1. Pourquoi une relecture indépendante

Les agents qui écrivent le code écrivent aussi ses tests, avec les mêmes angles
morts : un test écrit par l'auteur vérifie ce que l'auteur a pensé à vérifier. La
suite de tests était **verte avant** cette relecture. Une suite verte ne prouve
que ce qu'on a pensé à tester ; un second regard cherche ce que le premier n'a pas
pensé à tester. C'est le même argument que pour la vérification par mutation
(voir [`../tp3/tests-automatises.md`](../tp3/tests-automatises.md) §6), à l'échelle
d'une revue.

**Méthode** : pour chaque défaut, (1) écrire un test qui **échoue** (rouge
volontaire) et montre le défaut ; (2) corriger ; (3) vérifier que le test passe au
vert et que le reste de la suite n'a pas bougé.

**Artefacts produits par la relecture** (présents dans le dépôt) :

| Fichier | Contenu |
|---|---|
| `backend/test/securite-bonus.test.js` | **19 tests** (sécurité et cas limites du backend) |
| `frontend-starter/src/app/components/tracks-page/tracks-page.review.spec.ts` | 6 tests |
| `…/tracks-page/cover-search-dialog/cover-search-dialog.review.spec.ts` | 3 tests |
| `…/tracks-page/cover-file.review.spec.ts` | 11 cas (deux `it.each` et deux tests) |

---

## 2. Les six défauts réels

**Une précision importante sur l'origine.** Les défauts **1, 2 et 3** ne sont **pas**
dans le périmètre des bonus eux-mêmes : ils sont **hérités du package initial**.
Leur code est identique à `HEAD` (le commit initial du dépôt) — vérifié : la
version d'origine de `backend/src/app.js` calcule `page` sans borne haute, nomme le
fichier avec `path.extname(file.originalname)` sans limite et ne comporte qu'un
gestionnaire d'erreurs. Ils ont été corrigés **parce que les nouvelles routes de
pochette en dépendent** (elles passent par les mêmes middlewares et le même
gestionnaire d'erreurs).

### Défaut 1 — Une erreur interne non typée renvoyait une page HTML avec la pile d'appels

| | |
|---|---|
| **Symptôme** | une erreur inattendue (par exemple MongoDB qui échoue) retombait sur le gestionnaire par défaut d'Express : une **page HTML** contenant la **pile d'appels** et des chemins du serveur |
| **Pourquoi c'est grave** | fuite d'information (chemins, structure du code) ; et un client qui attend du JSON reçoit du HTML |
| **Correctif** | un **dernier gestionnaire** répond `500 { message: "Erreur interne du serveur" }`, le détail restant dans les journaux (`backend/src/app.js:877-882`) ; il respecte `res.headersSent` (`:879`) |
| **Test** | « erreur interne = 500 JSON { message } du contrat, sans pile d'appels ni chemin serveur » (`backend/test/securite-bonus.test.js:432`) : corps JSON, aucun chemin du serveur, aucune ligne `at …` |

### Défaut 2 — `page=1e20` produisait un `$skip` invalide

| | |
|---|---|
| **Symptôme** | `Number("1e20")` vaut `1e20` : un nombre qui dépasse ce que MongoDB accepte comme entier pour `$skip` ; `(page - 1) * limit` produisait un `$skip` invalide, que MongoDB refusait (erreur interne) |
| **Correctif** | `page` est arrondie (`Math.floor`) et **plafonnée** par `MAX_PAGE = 100000` (`backend/src/app.js:57`, `:540`) ; `limit` est arrondie et reste bornée à 1-20 (`:541`) |
| **Test** | « page/limit aberrants : jamais de `$skip`/`$limit` non entier ou non représentable envoyé à MongoDB » (`securite-bonus.test.js:225`) — douze valeurs : négatif, zéro, `abc`, `2.5`, `Infinity`, `1e400`, `1e20`, 30 chiffres, `limit=-1/0/1000`, `page[]=2` ; chacune doit donner `200` et un `$skip` entier sûr |
| **Réel** | `page=1e20` → `200` ; `page=Infinity` → `200` (rejoué par l'orchestrateur sur le backend corrigé) |

### Défaut 3 — Une extension de 300 caractères provoquait `ENAMETOOLONG` puis une erreur 500

| | |
|---|---|
| **Symptôme** | le nom de stockage gardait l'extension fournie par le client ; une extension démesurée dépassait la limite du système de fichiers |
| **Correctif** | l'extension n'est conservée que si elle correspond à `^\.[a-z0-9]{1,8}$` (`SAFE_EXTENSION`, `backend/src/app.js:58`, utilisée en `:342-344`) ; sinon le fichier est enregistré sans extension |
| **Tests** | « upload : extension démesurée = pas de 500 et pas de fichier résiduel » (`securite-bonus.test.js:406`) ; « nom de fichier malveillant (`../`) n'écrit jamais hors du dossier des uploads » (`:397`) |
| **Réel** | une extension de 230 caractères → `201` ; l'ancien code répondait `500` |

> Le nom de stockage reste un **UUID** : le client ne peut jamais choisir le chemin
> du fichier ; l'extension n'est qu'un suffixe.

### Défaut 4 — Supprimer une piste dont le fichier audio avait disparu laissait la pochette orpheline

| | |
|---|---|
| **Symptôme** | `DELETE /api/tracks/:id` supprimait la métadonnée, puis le fichier audio ; si **ce dernier échouait** (fichier déjà absent), la route répondait `500` **avant** d'avoir supprimé la pochette, qui restait sur le disque sans plus aucune référence |
| **Correctif** | la pochette est supprimée **d'abord** ; l'échec éventuel du fichier audio ne peut plus la laisser orpheline (`backend/src/app.js:701-705`, avec son commentaire) |
| **Test** | « DELETE piste dont le fichier audio a disparu : la pochette ne doit pas rester orpheline » (`securite-bonus.test.js:422`) |

C'est un bon exemple de ce qu'un test écrit par l'auteur ne voit pas : le scénario
« l'audio a déjà disparu » n'était l'objet d'aucun test.

### Défaut 5 — Après une suppression faite ailleurs, l'actualisation affichait « bibliothèque vide » alors que `total = 5`

| | |
|---|---|
| **Symptôme** | on est en page 2 ; dans un autre onglet on supprime des pistes ; on actualise : la page 2 n'existe plus, le serveur renvoie `items: []` et `total: 5` ; l'interface affichait « Votre bibliothèque est vide » — faux |
| **Correctif** | `load()` (`frontend-starter/src/app/components/tracks-page/tracks-page.ts:368-395`) détecte « page vide alors que des pistes existent » (`isBeyondLastPage`, `:398-405`) et **bascule sur la dernière page valide**, avec **un seul** rechargement |
| **Garde contre les boucles** | le rechargement de repli est lancé avec `allowPageFallback = false` (`:388`) : aucune boucle n'est possible, même si le serveur renvoyait encore un résultat hors bornes |
| **Tests** | « ne prétend pas que la bibliothèque est vide quand la page demandée est hors bornes » (`tracks-page.review.spec.ts`) ; et, dans `tracks-page.spec.ts`, le bloc « page devenue hors bornes » : « bascule sur la dernière page valide et recharge une fois », « ne boucle jamais… », « n'applique pas de repli quand la bibliothèque est réellement vide » |

Le troisième test compte : sans lui, une correction trop zélée aurait pu rediriger
une bibliothèque réellement vide vers une « dernière page » inexistante.

### Défaut 6 — Un fichier sans point dans le nom donnait « Image non acceptée (e) »

| | |
|---|---|
| **Symptôme** | `name.slice(name.lastIndexOf('.'))` : sans point, `lastIndexOf` vaut `-1` et `slice(-1)` renvoie **le dernier caractère du nom** (« pochette » → « e ») |
| **Correctif** | `fileExtension()` renvoie `''` quand il n'y a pas de point (`src/app/components/tracks-page/file-extension.ts:6-9`) ; le message dit alors « type inconnu » |
| **Tests** | « nomme « type inconnu » un fichier sans type MIME ni extension » (`cover-file.review.spec.ts`) ; et « annonce « type inconnu » plutôt que le dernier caractère du nom » pour l'audio (`tracks-page.spec.ts`, bloc « fichier audio sans extension ») |

---

## 3. Corrections complémentaires, hors de la liste de l'agent C

Ajoutées par l'orchestrateur et les agents propriétaires pendant la même passe :

| Correction | Où |
|---|---|
| **Focus après suppression** : la card (et son bouton focalisé) disparaît ; le focus est déplacé sur le titre de la liste au lieu d'être perdu sur `<body>` | titre `#library-heading` avec `tabindex="-1"` (`tracks-page.html:159`), `this.libraryHeading()?.nativeElement.focus()` (`tracks-page.ts:654`) ; test « déplace le focus sur le titre de la liste quand la card disparaît » |
| **Nom de profil et d'inscription ≥ 2 caractères après trim** (règle du backend : `minlength: 2` avec `trim`, `backend/src/models/User.js:10`) | validateur `trimmedMinLength` dans `src/app/shared/validators/trimmed-min-length.validator.ts:7-12`, utilisé par `register-page.ts:28` et `profile-page.ts:28` ; messages « Le nom doit contenir au moins 2 caractères » |
| **Validateur factorisé** plutôt que dupliqué | même fichier |
| **Commentaire du lien d'évitement corrigé** : il invoquait `<base href="/">`, or **aucune balise `<base>` n'existe** dans le projet. Le commentaire donne maintenant la vraie raison (ne pas ajouter `#contenu` à l'URL et à l'historique, ne pas faire réagir le routeur à un saut d'ancre) | `src/app/components/app/app.ts:26-30` |

Le dernier point est une **erreur d'explication dans le code** relevée par la
documentation (voir [`ui-ux-authentification.md`](./ui-ux-authentification.md) §4)
et confirmée par vérification dans le code : la raison invoquée n'était pas
démontrable dans l'état du dépôt.

---

## 4. Ce qui a été examiné et **non trouvé** (à ne pas oublier)

Une relecture honnête dit aussi où elle n'a **rien** trouvé. Ces points ont été
examinés ; aucun défaut n'a été relevé :

| Examiné | Constat |
|---|---|
| **Propriété d'une piste** | le filtre par propriétaire est **inséparable de toute requête** : aucune route ne cherche une piste sans `ownerId` |
| **SSRF — redirections** | chaque saut de redirection est **revalidé** (liste blanche puis hôte), la boucle est bornée à 3 sauts, le délai est **partagé** par tous les sauts (`securite-bonus.test.js:271`, `:284`) |
| **Plafond de 2 Mo** | appliqué **en flux** pendant le téléchargement, sans tout charger en mémoire ; un `Content-Length` annoncé supérieur est refusé avant toute lecture (`:334`, `:345`) |
| **Types de contenu** | l'en-tête `X-Content-Type-Options: nosniff` est posé sur la route de lecture de pochette (`backend/src/app.js:745`) |
| **`ObjectURL`** | révoquées sur **tous** les chemins identifiés (aperçu, affichage, audio, destruction) — voir [`pochettes.md`](./pochettes.md) §2 et §3 |
| **Secrets dans les journaux** | aucun JWT ni en-tête `Authorization` dans les journaux du serveur (`securite-bonus.test.js:444`) |
| **Identifiants invalides** | un `:id` qui n'est pas un `ObjectId` donne `404`, jamais `500` (`:213`) |
| **Injection dans le filtre** | `q` en tableau → `400` ; `q[$ne]`, `ownerId=` ou `match[ownerId]=` en requête ne modifient jamais le filtre (`:252`) |
| **Données non fiables dans l'interface** | titre, artiste, album (tags ID3 ou iTunes) rendus comme texte ; aucun `javascript:` dans les `<img src>` ; pas de référent envoyé aux serveurs d'images tiers |

Précision sur Express 5 (parseur de requête « simple ») : `q[]=a` et `q[$ne]=x` ne
forment **pas** un tableau ni un objet, mais une clé distincte, ignorée : la réponse
est `200` **sans filtre** et **sans injection possible**. Le vrai vecteur de tableau
est `q=a&q=b`, qui donne `400`. Ces cas ont été rejoués contre le serveur réel
(`q=a&q=b` → `400`).

---

## 5. Un incident de méthode, sans enjoliver

Pendant la passe, un test écrit par l'agent C **échouait** après le correctif du
défaut 5. L'analyse a montré que **le test était incomplet, pas le code** : il
attendait un état final **sans** le rechargement unique que le repli sur la dernière
page déclenche volontairement. Le code se comportait comme voulu ; le test ne
décrivait pas ce comportement. Il a été corrigé par l'orchestrateur.

Ce que l'incident enseigne :

- un test rouge n'est pas, en soi, la preuve d'un défaut du code : il faut lire
  **pourquoi** il est rouge ;
- l'inverse est vrai aussi : avant d'« adapter le code pour contenter le test », il
  faut se demander si c'est le test qui est faux ;
- c'est un cas réel de ce risque que le rapport nomme depuis le début : un agent
  raisonne sur ce qu'il a lu à un instant donné.

---

## 6. Limites connues, **non corrigées**

À lister sans minimiser. Aucune n'est cachée dans le reste de la documentation.

| # | Limite | Gravité réelle | Pourquoi non corrigée |
|---|---|---|---|
| 1 | **Secret JWT par défaut codé en dur** : `process.env.JWT_SECRET \|\| "tp1-development-secret"` (`backend/src/app.js:31`) | **élevée en production**, sans effet pédagogique | hérité du package initial (identique à `HEAD`), hors du périmètre des bonus. En production, il faut **refuser de démarrer** sans variable d'environnement |
| 2 | **`authInterceptor` ajoute le Bearer à toute URL** (`src/app/shared/interceptors/auth.interceptor.ts:6-16`), y compris une URL externe | **latente** : aucun appel externe aujourd'hui (les miniatures iTunes sont chargées par des `<img>`, pas par `HttpClient`) | corriger demanderait de limiter l'intercepteur aux URL `/api` ; non fait pour ne pas modifier le comportement déjà testé |
| 3 | **Course entre deux `PUT` de pochette simultanés** : un fichier orphelin est possible (`replaceCover`, `backend/src/app.js:185-195`) | faible : deux modifications simultanées de la même pochette | demanderait un verrou ou une opération atomique côté base |
| 4 | **Deux `GET /api/users/me` après un F5 sur `/profile`** (coque + page profil) | nulle fonctionnellement | voir [`ui-ux-authentification.md`](./ui-ux-authentification.md) §8 |
| 5 | **`hasPrevious` / `hasNext` : code mort conservé** (`tracks-page.ts:135-136`) | nulle | plus lus par aucun template ni test depuis le `MatPaginator` ; non supprimés |
| 6 | **Focus piégé des dialogues non vérifié par un test** : les tests couvrent Échap et la fermeture, pas la navigation au clavier | moyenne (accessibilité) | à vérifier à la main |
| 7 | **Rendu navigateur non vérifié par un humain** : thème sombre, mouvement réduit, contrastes, lecteur d'écran, et toutes les captures Network | — | seul un humain peut le faire |
| 8 | **JWT expiré non testé** : seuls un jeton mal formé et un jeton signé avec un autre secret le sont | moyenne | jamais exercé en test ni en réel |
| 9 | **Comparaison brute du nom dans « Enregistrer »** (`profile-page.ts:37-39`) : « Alice␣ » ≠ « Alice » active le bouton | cosmétique | le backend rogne ; effet nul |

Ce qui est **dit** : ce document ne prétend pas que le code est sûr ; il dit que six
défauts réels ont été trouvés **parce qu'un second agent a relu**, que neuf limites
restent, et que la propreté d'une suite de tests verte ne les révèle pas.
