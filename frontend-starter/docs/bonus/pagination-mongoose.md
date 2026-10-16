# Bonus TP2 — Pagination Mongoose avec `mongoose-aggregate-paginate-v2`

Option « AVANCÉ — Pagination Mongoose » de `SUJET_ETUDIANT_TP2.md` : faire
paginer le **backend** avec le plugin `aggregate-paginate-v2`. Le sujet prévient
que « le plugin renvoie au client des données beaucoup plus complètes : il
faudra donc également mettre à jour `API_CONTRACT.md` et le frontend ».

Pour ce bonus uniquement, le gel du backend a été levé (voir
`RAPPORT_IA_MODELE.md`, section « Bonus et refonte UI/UX »). Le reste du
backend n'a pas changé de contrat pour la pagination.

Chemins backend relatifs à la racine du dépôt, chemins frontend à
`frontend-starter/`. Chaque affirmation sur le code porte son `fichier:ligne`,
relevé sur l'état du dépôt au moment de la rédaction.

---

## 1. La dépendance ajoutée

| | |
|---|---|
| Nom | `mongoose-aggregate-paginate-v2` |
| Déclaration | `backend/package.json:16` (`"^1.1.5"`) |
| Version installée | 1.1.5 (`node_modules/mongoose-aggregate-paginate-v2/package.json`) |
| Licence | MIT (même fichier, champ `license`) |
| Maintenance | la version 1.1.5 est datée du 2026-08-03 dans le `CHANGELOG.md` du paquet installé (correctif des étapes qui ajoutent des champs comme `$lookup`, optimisation du comptage ; la version précédente, 1.1.4, date de février 2025) |
| Raison | c'est le plugin demandé par le sujet ; il fournit `Track.aggregatePaginate()` et les métadonnées de pagination |

Règle du cours (« ajouter une dépendance = la signaler ») : le plugin est
branché sur le schéma par `schema.plugin(aggregatePaginate)`
(`backend/src/models/Track.js:39`, import ligne 2).

> Recoupement : le registre npm (`registry.npmjs.org`, consulté pendant la
> rédaction) indique pour ce paquet la dernière version `1.1.5`, publiée le
> 2026-08-03, sous licence MIT. Cela corrobore le `CHANGELOG.md` livré avec le
> paquet. Ce sont des mentions de date : elles disent que le paquet est
> **maintenu récemment**, pas qu'il le restera.

---

## 2. `find` + `skip/limit` contre `aggregate`

### Avant (version d'origine du dépôt, commit initial)

`backend/src/app.js` (version `HEAD`, lignes 286-292 et 315) :

```js
const [items, total] = await Promise.all([
  Track.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
       .select("-storedName").lean(),
  Track.countDocuments(filter),
]);
// …
pages: Math.max(1, Math.ceil(total / limit)),
```

Deux requêtes MongoDB lancées en parallèle (`Promise.all`) : une pour la
tranche, une pour le total. Le calcul de `pages` était fait à la main.

### Après

`backend/src/app.js:566-588` : un **pipeline d'agrégation** (`Track.aggregate`)
passé à `Track.aggregatePaginate(aggregate, { page, limit, sort })`, puis
recopie des métadonnées calculées par le plugin.

### Pourquoi passer à `aggregate` — et ce que ça ne change pas

| | `find` + `skip/limit` | `aggregate` + plugin |
|---|---|---|
| Nombre d'allers-retours | 2 (liste + `countDocuments`) | 1 (un seul `$facet`, voir §3) |
| Calcul de `pages`, `hasNextPage`… | à la main | fournis par le plugin |
| Cast automatique des types par Mongoose | **oui** | **non** (voir §5) |
| Champs `select: false` du schéma | respectés | **non respectés** (voir §6) |
| Composition (`$lookup`, `$group`…) | difficile | naturelle : on ajoute des étapes |

Soyons honnêtes : **pour une liste filtrée par un seul critère, `find` +
`skip/limit` suffisait**, et il était plus sûr (cast et `select: false`
automatiques). L'intérêt du passage à `aggregate` est pédagogique (le sujet le
demande) et prospectif (ajouter plus tard un `$lookup` vers les utilisateurs ou
des statistiques sans réécrire la pagination). Le prix est visible dans ce
document : deux pièges (§5 et §6) qui n'existaient pas avant.

---

## 3. Le `$facet` interne du plugin

Par défaut le plugin travaille avec l'option `useFacet: true`
(`node_modules/mongoose-aggregate-paginate-v2/lib/mongoose-aggregate-paginate.js:34`).
Il construit alors **un seul pipeline** dont l'étape `$facet` lance deux
sous-pipelines en parallèle sur les mêmes documents :

- `docs` : les étapes de l'appelant, puis `$skip` et `$limit` (lignes 150-153) ;
- `count` : `[{ $count: "count" }]` (ligne 154).

Le plugin remonte aussi **avant** le `$facet` les étapes `$match` de l'appelant
(lignes 134-148 : seul `$match` est déplacé ; d'après le commentaire du plugin, les
étapes qui ajoutent ou modifient des champs restent dans la branche `docs`), pour que le comptage ne porte que sur les
documents filtrés.

Schéma du pipeline réellement envoyé pour notre route (reconstitué à partir du
code du plugin et de l'assertion du test `backend/test/tracks.test.js:415-419`,
qui lit `pipeline.find($facet).$facet.docs` ; ce n'est **pas** la sortie d'un
`explain()` sur MongoDB) :

```js
[
  { $match: { ownerId: ObjectId("…"), title: { $regex: "…", $options: "i" } } },
  { $facet: {
      docs:  [ { $project: { storedName: 0, coverStoredName: 0 } },
               { $sort: { createdAt: -1 } },
               { $skip: (page - 1) * limit },
               { $limit: limit } ],
      count: [ { $count: "count" } ],
  } },
]
```

À partir de `count` et de `limit`, le plugin déduit `pages`
(`Math.ceil(count / limit) || 1`, ligne 215) puis `hasPrevPage`, `prevPage`,
`hasNextPage`, `nextPage` (lignes 240-252).

**Ce qu'il faut savoir expliquer** : un `$facet` évite d'exécuter deux requêtes
séparées, mais il ne rend pas l'opération « gratuite » : MongoDB doit tout de
même évaluer le `$match` et, pour la branche `docs`, parcourir les documents
jusqu'à l'offset demandé. Sur une bibliothèque personnelle de quelques centaines
de pistes, c'est sans conséquence ; c'est un point à reconsidérer pour des
volumes très supérieurs.

---

## 4. Ce qui change dans la réponse

Construction de la réponse : `backend/src/app.js:578-588`.

| Clé | Origine | Statut |
|---|---|---|
| `items` | `result.docs.map(toPublicTrack)` | **historique, conservée** |
| `page` | `result.page` | **historique, conservée** |
| `limit` | `result.limit` | **historique, conservée** |
| `total` | `result.totalDocs` | **historique, conservée** |
| `pages` | `result.totalPages` | **historique, conservée** |
| `hasPrevPage` | `result.hasPrevPage` | **ajoutée** |
| `hasNextPage` | `result.hasNextPage` | **ajoutée** |
| `prevPage` | `result.prevPage` (`number \| null`) | **ajoutée** |
| `nextPage` | `result.nextPage` (`number \| null`) | **ajoutée** |

### Rétro-compatibilité

Les cinq clés historiques gardent leur nom et leur sens ; les quatre nouvelles
sont **purement additionnelles**. Un client écrit contre l'ancien contrat
continue donc de fonctionner sans modification : il ignore simplement les clés
qu'il ne connaît pas. C'est la règle à retenir pour faire évoluer une API sans
casser ses clients : *ajouter, ne jamais renommer ni retirer*.

Le plugin renomme ses propres clés (`docs`, `totalDocs`, `totalPages`) : c'est
précisément pour **ne pas laisser fuiter** ces noms vers le client que la
réponse est reconstruite à la main plutôt que renvoyée telle quelle
(`res.json(result)` aurait exposé aussi `pagingCounter` et aurait changé les
noms de clés).

Le comportement aux bornes est resté celui d'avant :

- une collection vide donne `pages: 1` (plugin ligne 215 ; l'ancien code faisait
  `Math.max(1, …)`) ;
- une page hors bornes renvoie `200` avec `items: []` (test
  `backend/test/tracks.test.js:426-428`, page 9).

> **Particularité lue dans le code du plugin, non observée sur le serveur** :
> pour une page hors bornes (par exemple `page=99` alors qu'il n'y a que 2
> pages), le plugin calcule `prevPage = page - 1` sans le plafonner
> (lignes 240-244) : `hasPrevPage` y vaudrait `true` et `prevPage` vaudrait 98.
> Les preuves réelles de ce lot ne relèvent que `items: []` pour cette page. Le
> frontend n'est pas concerné (voir ci-dessous), mais un client qui se fierait à
> `prevPage` sur une page hors bornes se tromperait.

### Et le frontend ?

- `src/app/shared/models/page.model.ts:8-11` déclare les quatre nouvelles clés.
- **Aucun composant ne les lit** (recherche faite dans `src/` hors tests : seules
  les lignes de ce modèle les citent). La page « bibliothèque » s'appuie sur
  `total`, `page` et `limit` pour alimenter le `MatPaginator`
  (`tracks-page.html:385-395`) et sur `pages` pour borner `go()`
  (`tracks-page.ts:433`). Le contrat est donc enrichi, mais le frontend n'en
  dépend pas : c'est volontaire, et c'est ce qui prouve la rétro-compatibilité.

---

### Entrées aberrantes : `page` et `limit` sont bornées

La relecture indépendante a montré que `page=1e20` produisait un `$skip` invalide
(erreur interne). `page` est désormais **arrondie** (`Math.floor`) puis **plafonnée**
à `MAX_PAGE = 100000` (`backend/src/app.js:57`, `:540`) ; `limit` est arrondie et
bornée à 1-20 (`:541`). Voir [`relecture-independante.md`](./relecture-independante.md),
défaut 2. `page=1e20` et `page=Infinity` donnent `200` contre le serveur réel.

## 5. Le piège : le cast `ObjectId` dans un aggregate

### Le comportement qu'on ne voit pas

Avec `find`, Mongoose lit le schéma (`ownerId` est un `ObjectId`,
`backend/src/models/Track.js:14-19`) et **convertit** la chaîne du filtre en
`ObjectId`. Dans un `aggregate`, le pipeline est transmis à MongoDB **tel quel** :
aucune conversion. Or `req.auth.sub` — l'identifiant lu dans le JWT — est une
**chaîne** (`backend/src/app.js:297`, `sub: user.id`).

MongoDB compare strictement les types : la chaîne `"6650…"` n'est pas égale à
l'`ObjectId("6650…")`. Un `$match: { ownerId: req.auth.sub }` ne trouverait donc
**aucun document**.

### Le correctif

`backend/src/app.js:560-562` :

```js
// Dans un aggregate, Mongoose ne convertit pas les types : sans ObjectId
// explicite, la chaîne du JWT ne correspondrait à aucune piste.
const match = { ownerId: new mongoose.Types.ObjectId(req.auth.sub) };
```

### Pourquoi c'est un piège sournois

- **Aucune erreur, aucun message.** La requête réussit, la réponse est un `200`
  avec `items: []` et `total: 0`. L'utilisateur croit que sa bibliothèque est
  vide.
- **Le défaut échoue « fermé »** : on ne voit *rien* au lieu de voir *trop*. C'est
  la bonne direction pour un défaut de sécurité, mais cela rend le bug
  silencieux.
- **La tentation dangereuse** est la réparation « rapide » : constatant que la
  liste est vide, retirer le filtre `ownerId` « pour voir si ça marche ». Cela
  ferait apparaître les pistes de **tous** les utilisateurs. Le filtre
  par propriétaire est ce qui garantit l'isolation entre comptes ; il ne doit
  jamais être supprimé, seulement **casté**.
  *(Il s'agit d'un risque de maintenance raisonné à partir du code, pas d'un
  incident survenu dans ce projet.)*

### Comment c'est verrouillé

- **Test** `backend/test/tracks.test.js:376-429` : il lit le pipeline émis et
  vérifie que `$match.ownerId` est bien une instance de `ObjectId` égale à
  l'identifiant d'Alice (lignes 413-414). La simulation de MongoDB du
  test refuse volontairement un `ownerId` resté chaîne (commentaire de
  `tracks.test.js:116-117`, condition ligne 127) : sans le cast, la liste d'Alice
  serait vide et le test échouerait.
- **Preuve réelle** (voir [`preuves-integration-reelle.md`](./preuves-integration-reelle.md)) :
  contre MongoDB Atlas, 7 pistes envoyées sont bien retournées par la liste
  paginée, et un autre utilisateur voit 0 piste.

> Limite : le test fait confiance à *notre compréhension* du comportement de
> MongoDB, encodée dans sa simulation. C'est la preuve réelle contre Atlas qui
> confirme que ce comportement est bien celui du vrai serveur.

---

## 6. Second piège : `select: false` ne protège pas un aggregate

Le schéma marque `storedName` et `coverStoredName` en `select: false`
(`backend/src/models/Track.js:22` et `:28`) : ces noms de fichiers disque ne
doivent jamais sortir de l'API. Cette protection s'applique aux requêtes
`find`/`findOne`. Un `aggregate` renvoie des documents bruts : le champ
sortirait sans le correctif.

Le code applique donc **deux protections indépendantes** :

1. un `$project: { storedName: 0, coverStoredName: 0 }` explicite dans le
   pipeline (`backend/src/app.js:568`) ;
2. `toPublicTrack()` (`backend/src/models/Track.js:45-59`), qui ne recopie que des
   champs **listés** (liste blanche) au lieu de retirer des champs (liste noire).

C'est le principe « refuser par défaut » : un nouveau champ ajouté plus tard au
schéma ne sort pas de l'API tant qu'on ne l'a pas listé. Vérifié par le test
`tracks.test.js:376` (assertions `"storedName" in item === false`) et par la
preuve réelle (« aucune fuite de `storedName` »).

---

## 7. Mise à jour de `API_CONTRACT.md`

Le sujet l'exige. Modifications relevées dans le fichier :

- ligne 14 : la route devient `GET /tracks?page=1&limit=5&q=blues` (le filtre `q`
  est documenté dans [`filtre-par-titre.md`](./filtre-par-titre.md)) ;
- ligne 26 : `Page<Track>` liste maintenant les **neuf** clés, précise qu'elles
  sont « calculées par `mongoose-aggregate-paginate-v2` », que `page` vaut 1 par
  défaut, `limit` 5 (de 1 à 20), qu'une page hors bornes renvoie `items: []` et
  que le tri est `createdAt` décroissant.

Les routes de pochette ajoutées par le même lot de backend sont documentées dans
le contrat mais relèvent du lot de documentation consacré aux pochettes.

---

## 8. Vérifications

| Vérification | Nature | Résultat |
|---|---|---|
| Test « pagination page + limit avec les champs ajoutés et ownerId casté » (`backend/test/tracks.test.js:376`) | test automatisé, MongoDB simulé | vert (backend : 52/52) |
| Pagination `limit=5` sur 7 pistes : page 1 = 5 items, `total` 7, `pages` 2, `hasNextPage` vrai, `nextPage` 2, `prevPage` nul ; page 2 = 2 items, `hasPrevPage` vrai ; page 99 = items vides | ligne de commande, vrai serveur + MongoDB Atlas | OK (voir `preuves-integration-reelle.md`) |

**[À COMPLÉTER PAR LE BINÔME]** — capture Network de la pagination dans le
navigateur : avec au moins 6 pistes, ouvrir DevTools → onglet **Network**, filtre
**XHR/Fetch**, aller en page 2 avec le paginator, sélectionner la requête
`GET /api/tracks?page=2&limit=5`, onglet **Response**, et relever que la réponse
contient bien les **neuf** clés (`items`, `page`, `limit`, `total`, `pages`,
`hasPrevPage`, `hasNextPage`, `prevPage`, `nextPage`). Ne capturez pas la valeur
de l'en-tête `Authorization`.
