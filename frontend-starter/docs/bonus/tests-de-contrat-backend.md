# Bonus TP3 — Extension backend facultative : tests de contrat et de sécurité

Extension proposée à la fin de la Mission 7 de `SUJET_ETUDIANT_TP3.md` : à partir
de `backend/test/api.test.js`, ajouter des tests de contrat ou de sécurité sans
modifier les routes. Les tests sont dans **`backend/test/tracks.test.js`**
(nouveau fichier ; `api.test.js` n'a pas été modifié).

Chemins relatifs à la racine du dépôt.

> **Résultat mesuré par l'orchestrateur (définitif)** : `cd backend && npm test` →
> **52 tests, 52 verts** = 2 existants (`api.test.js`) + 31 (`tracks.test.js`) + 19
> (`securite-bonus.test.js`, ajoutés par la relecture indépendante). Ce document n'a
> lancé aucune commande : le décompte est un comptage statique
> (`grep -c "^test("` : 2 + 31 + 19), qui concorde avec la mesure. Les 19 tests de
> `securite-bonus.test.js` sont décrits dans
> [`relecture-independante.md`](./relecture-independante.md) ; ce document-ci traite
> surtout de `tracks.test.js`.

---

## 1. Les six cas du sujet, et où ils sont couverts

| Cas demandé par le sujet | Test | Ligne |
|---|---|---|
| Une réponse `401` sans JWT | « 401 sans JWT sur la liste des pistes » | `backend/test/tracks.test.js:248` |
| Une réponse `401` avec un JWT invalide | « 401 avec un JWT invalide ou signé par un autre secret » (deux jetons : mal formé, et signé avec un autre secret) | `:254` |
| Un upload sans fichier | « upload sans fichier audio = 400 » (message `Fichier audio requis`, rien enregistré) | `:280` |
| Un type MIME refusé | « upload d'un type MIME refusé = 400 sans fichier résiduel » (`text/plain`, disque vide ensuite) | `:287` |
| Une pagination avec `page` et `limit` | « pagination page + limit avec les champs ajoutés et ownerId casté » | `:376` |
| L'accès interdit à la piste d'un autre utilisateur | « piste d'autrui : lecture audio et suppression = 404 » | `:463` |

## 2. Les cas ajoutés par les bonus

| Thème | Tests (lignes de `tracks.test.js`) |
|---|---|
| 401 sur les **cinq** nouvelles routes de pochette | `:262` |
| Tags ID3 : extraction artiste/album/image, repli sur le titre ID3, tags illisibles sans échec | `:294`, `:313`, `:319` |
| Pochette à l'upload : prioritaire sur l'ID3, `Content-Type` menteur refusé, trop lourde refusée | `:331`, `:345`, `:356` |
| Nettoyage après échec de MongoDB (audio et pochette supprimés du disque) | `:367` |
| Filtre `q` : sous-chaîne, casse, regex échappée ; plus de 100 caractères | `:431`, `:453` |
| Isolation entre utilisateurs sur **toutes** les routes de pochette ; identifiant invalide | `:477`, `:496` |
| `GET`/`PUT`/`DELETE` de pochette (absente, remplacement, `Content-Type` menteur, trop lourde, sans fichier) | `:503`, `:510`, `:526`, `:535`, `:544`, `:554` |
| Suppression d'une piste : efface aussi le fichier de pochette | `:564` |
| Recherche iTunes : requête construite côté serveur, résultats hors liste blanche écartés ; service en échec → `502` | `:573`, `:614` |
| Pochette Web, anti-SSRF : image téléchargée ; URL refusées sans appel réseau ; redirection refusée ; contenu non image ou trop lourd | `:624`, `:642`, `:666`, `:679` |

### Les 19 tests de `securite-bonus.test.js`

Fichier ajouté par la relecture indépendante (`backend/test/securite-bonus.test.js`).
Il réutilise le même dispositif (MongoDB et réseau simulés) pour des cas limites et
des défenses :

| Thème | Tests (lignes de `securite-bonus.test.js`) |
|---|---|
| `:id` non valide → `404`, jamais `500` | `:213` |
| `page` / `limit` aberrants, jamais de `$skip`/`$limit` invalide | `:225` |
| `q` en tableau → `400` ; `q[$ne]`, `ownerId=` sans effet sur le filtre | `:252` |
| SSRF : redirections revalidées, boucle bornée à 3, délai partagé, variantes d'URL piégées, hôte en majuscules, plafond de 2 Mo en flux, `Content-Length` annoncé, réponse distante en erreur | `:271`, `:284`, `:298`, `:323`, `:334`, `:345`, `:355` |
| Upload : pochette sans audio ; pochette écrite avant un audio refusé ; champ inattendu ou audio en double ; nom malveillant ; extension démesurée ; image ID3 > 2 Mo ignorée | `:367`, `:373`, `:382`, `:397`, `:406`, `:412` |
| `DELETE` d'une piste dont l'audio a disparu : pas de pochette orpheline | `:422` |
| Erreur interne : `500` JSON sans pile d'appels | `:432` |
| Aucun JWT dans les journaux | `:444` |

Les tests qui touchent à la pagination, au filtre et à l'isolation sont expliqués
dans [`pagination-mongoose.md`](./pagination-mongoose.md) et
[`filtre-par-titre.md`](./filtre-par-titre.md).

---

## 3. Pourquoi ces tests n'ont pas besoin de MongoDB

Même exigence que pour le frontend (« ils ne doivent pas dépendre d'une base en
fonctionnement »), mais une mise en œuvre différente : ici on garde **tout le
reste réel** et on ne remplace que deux frontières.

| Réel | Remplacé |
|---|---|
| l'application Express complète, démarrée sur un port libre (`createApp().listen(0)`, `tracks.test.js:155`) | MongoDB |
| de vrais appels HTTP (`realFetch`, `:184`), avec en-têtes, multipart, JWT | le réseau sortant (iTunes, `mzstatic.com`) |
| Multer, le middleware `auth`, la validation des octets magiques | |
| la bibliothèque `music-metadata` : elle lit de **vrais octets** ID3 construits à la main (`mp3WithId3()`, `:42-67`) | |
| les fichiers écrits sur le disque, dans un **dossier temporaire** (`process.chdir(workDir)`, `:12-13`), jamais dans `backend/data` | |

### Le remplacement de MongoDB

`tracks.test.js:70-137`. Les méthodes du modèle `Track` sont remplacées par des
versions qui lisent et écrivent une `Map` en mémoire :

- `Track.findOne`, `Track.findOneAndDelete`, `Track.create`,
  `Track.prototype.save` (`:97-114`) ;
- `mongoose.Aggregate.prototype.exec` (`:118-137`) : exécute sur la `Map` le
  **pipeline réellement produit** par le plugin de pagination, en lisant son
  `$match` et les `$skip`/`$limit` de la branche `docs` du `$facet`.

`mongoose.set("bufferCommands", false)` (`:18`) fait échouer **immédiatement** une
requête qu'on aurait oublié de simuler, au lieu de la laisser attendre un
délai : un oubli devient visible.

Avant chaque test, la `Map`, les journaux de pipelines, les appels sortants et le
disque temporaire sont remis à zéro (`test.beforeEach`, `:166-177`) : les tests
sont indépendants de leur ordre.

### Le remplacement du réseau

`globalThis.fetch` est remplacé (`:141-150`) : chaque appel sortant du serveur est
**enregistré** dans `remoteCalls` puis répondu par une fonction fournie par le
test (`remote`). Par défaut, `remote` lève une erreur « Aucun appel réseau
sortant attendu » (`:143-146`) : un test qui ne s'attend pas à un appel réseau
échoue si le serveur en fait un.

Ce dispositif sert deux types de vérifications :

1. **Ce que le serveur envoie.** Test `:573` : l'URL appelée est
   `https://itunes.apple.com/search`, avec `term` = « Daft Punk One More Time ».
   Test `:624` : le téléchargement se fait avec `redirect: "manual"` et un
   `AbortSignal` (`:635-636`).
2. **Ce que le serveur refuse de faire.** Tests `:642`, `:262`, `:477` :
   `assert.equal(remoteCalls.length, 0)` — pour une URL hors liste blanche, une
   route sans JWT ou une piste d'autrui, **aucun appel sortant ne part**. C'est la
   preuve qu'on refuse *avant* d'agir, ce qu'un test qui ne regarderait que le
   code `400` ne montrerait pas.

### Classification

Ce ne sont ni des tests unitaires purs (l'application, le routage, Multer et le
JWT sont réels) ni des tests d'intégration complets (la base et le réseau sont
simulés) : des tests d'**intégration partielle**. Voir la distinction unitaire /
intégration dans [`../tp3/restitution-orale.md`](../tp3/restitution-orale.md)
(question 6).

---

## 4. Les limites honnêtes de cette approche

À dire spontanément à l'oral : un test qui remplace MongoDB ne prouve pas ce que
fait MongoDB.

1. **La simulation de la base est notre propre compréhension de MongoDB.** Elle
   est écrite par nous. Quand le test dit « un `ownerId` resté chaîne ne
   correspond à aucun `ObjectId` » (`:116-117`, `:127`), c'est une **hypothèse
   encodée**, pas une observation. Si elle était fausse, le test resterait vert.
2. **Le moteur d'expression régulière n'est pas celui de MongoDB.** La
   simulation du filtre utilise le `RegExp` de JavaScript (`:125`) ; MongoDB
   évalue `$regex` avec son propre moteur (PCRE). Les deux comportements peuvent
   différer sur des cas limites (Unicode, certaines constructions). Les tests
   vérifient donc surtout que **l'expression envoyée est correctement échappée**
   (`:449-450`), pas le résultat d'exécution réel.
3. **L'exécution réelle du `$facet`, les index et les performances** ne sont pas
   testés. Seule la *forme* du pipeline l'est.
4. **Le réseau est entièrement simulé.** Les tests ne contactent jamais iTunes
   ni `mzstatic.com`. La limite de **trois redirections** et le **partage du
   délai** entre les sauts sont, depuis la relecture, couverts par un test simulé
   (`securite-bonus.test.js:284`) ; en revanche le **délai réel de 5 secondes** n'a
   jamais été atteint, ni en test ni en réel : on vérifie seulement qu'un même
   `AbortSignal` est passé à chaque saut.
5. **Cas non couvert par un test** : un JWT **expiré** (seuls un jeton mal formé
   et un jeton signé avec un autre secret sont testés, `:254-260`). La garde sur un
   paramètre `q` répété, elle, est couverte depuis la relecture
   (`securite-bonus.test.js:252`).
6. **Un test vert prouve que le code respecte nos tests**, pas que le contrat
   `API_CONTRACT.md` correspond à ce que fait le vrai serveur.

C'est la raison d'être de [`preuves-integration-reelle.md`](./preuves-integration-reelle.md) :
les 56 vérifications exécutées contre le **vrai** serveur, MongoDB Atlas et le
vrai service iTunes comblent précisément les trous 1 à 4.

---

## 5. Vérification par mutation

On casse volontairement une défense, on vérifie que **le test attendu échoue**,
puis on restaure. Mutations effectuées par l'agent backend, communiquées à
l'agent de documentation (non rejouées ici) :

| Mutation | Test qui doit échouer | Résultat annoncé |
|---|---|---|
| Retirer l'échappement des métacaractères (`escapeRegex`) | test du filtre `q` (`:431`) | échoue |
| Retirer la liste blanche d'hôtes | les tests SSRF et la recherche iTunes (`:573`, `:642`) | échouent |
| Retirer `ownerId` de la recherche de piste | « pochette d'autrui = 404 sur toutes les routes » (`:477`) | échoue |

Un test qui n'a jamais été vu rouge n'a jamais été vérifié : ces trois mutations
sont ce qui permet de dire que les trois défenses les plus sensibles (injection
dans le filtre, SSRF, isolation entre comptes) sont **réellement surveillées**.

**[À COMPLÉTER PAR LE BINÔME]** — rejouer au moins une mutation vous-mêmes :

1. Dans `backend/src/app.js`, remplacer `escapeRegex(search)` (ligne 558) par
   `search`.
2. `cd backend && npm test` : relever **quel test** échoue et son message ; faire
   une capture du terminal rouge.
3. Restaurer, vérifier avec `git diff backend/src/app.js` qu'il ne reste que les
   modifications attendues, relancer `npm test` et capturer le retour au vert.
4. Joindre les deux captures au rapport.
