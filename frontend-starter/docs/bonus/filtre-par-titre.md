# Bonus TP2 — Filtre par titre (côté serveur)

Option facultative « filtre par titre » de `SUJET_ETUDIANT_TP2.md`. Le filtre est
envoyé au serveur dans le paramètre de requête `q` ; c'est MongoDB qui trie le
bon grain de l'ivraie.

Chemins backend relatifs à la racine du dépôt, chemins frontend à
`frontend-starter/`. Les numéros de ligne de `tracks-page.ts` et
`tracks-page.html` ont été re-vérifiés sur le **code figé** : **en cas de décalage
futur, fiez-vous au nom de la méthode ou de l'élément**, toujours cité à côté.

---

## 1. Pourquoi le filtre est côté serveur

Tentation : garder en mémoire les pistes déjà reçues et les filtrer avec
`Array.filter()` dans Angular. Ce serait une erreur, pour deux raisons.

**1. Il n'y a jamais toutes les pistes dans le navigateur.** Le composant ne
détient que **une page** (5, 10 ou 20 pistes, `tracks-page.ts:81`). Filtrer
localement ne chercherait que parmi elles : « blues » ne trouverait pas un titre
situé en page 3, et `total` / le nombre de pages resteraient ceux de la
bibliothèque entière, donc faux.

**2. La seule façon de rendre un filtre local « correct » est interdite.** Pour
qu'il porte sur toute la bibliothèque il faudrait d'abord télécharger *toutes* les
pistes. Le sujet de la mission 2 l'écrit noir sur blanc : « Il est interdit de
récupérer toutes les pistes puis de les découper localement dans Angular. »
*(Cette phrase est énoncée à propos de la pagination ; un filtre local reviendrait
au même antipattern, d'où la même règle appliquée ici.)*

Le filtre côté serveur résout les deux problèmes à la fois : MongoDB ne renvoie
que les pistes qui correspondent, et le `total` renvoyé est celui **des résultats
filtrés**, ce qui permet au paginator de rester juste. Contrat
(`API_CONTRACT.md`, ligne 14 et ligne 26) : `GET /tracks?page=1&limit=5&q=blues`.

---

## 2. Côté backend

Route : `backend/src/app.js:538-593`.

| Étape | Code | Rôle |
|---|---|---|
| Lecture | `req.query.q ?? ""` (`:542`) | `q` est optionnel |
| Garde de type | `typeof rawQuery !== "string"` → `400` (`:544-547`) | une valeur répétée (`?q=a&q=b`) donnerait un tableau |
| Rognage | `rawQuery.trim()` (`:548`) | espaces ignorés |
| Longueur | `search.length > MAX_QUERY_LENGTH` → `400` (`:549-554`), constante `MAX_QUERY_LENGTH = 100` (`:55`) | borne la taille de ce qu'on met dans l'expression régulière |
| Échappement | `escapeRegex(search)` (`:563`), défini en `:198` | `q` est un **texte**, pas une regex |
| Requête | `$regex` + `$options: "i"` sur `title` (`:563`) | sous-chaîne, casse ignorée |
| Isolation | `ownerId` casté, toujours présent (`:562`) | le filtre ne sort jamais du périmètre de l'utilisateur |

### L'échappement des métacaractères (injection et ReDoS)

`backend/src/app.js:197-198` :

```js
/** Échappe les métacaractères pour qu'une recherche reste une simple sous-chaîne. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
```

Chaque caractère spécial d'une expression régulière est précédé d'un `\`. Sans
cela, ce que l'utilisateur tape serait **interprété** par MongoDB comme une
expression régulière, avec deux conséquences :

- **Comportement faux.** Chercher `a.c` trouverait aussi « abc » (le `.` signifie
  « n'importe quel caractère »). Chercher `.*` renverrait **toutes** les pistes.
  Une `(` seule est une expression invalide : la requête échouerait.
- **ReDoS** (*Regular expression Denial of Service*). Certaines expressions,
  comme `(a+)+$`, provoquent un temps d'évaluation qui explose sur certaines
  entrées (« backtracking catastrophique »). Si l'utilisateur contrôle
  l'expression, il peut faire travailler MongoDB très longtemps avec une requête
  minuscule. Échapper rend le motif **littéral** : `(a+)+$` devient simplement
  une chaîne à chercher.

La limite de 100 caractères est une seconde barrière : même un motif accepté ne
peut pas être arbitrairement long. Une réponse `400` est renvoyée au-delà
(`app.js:549-554`).

> Ce qu'on affirme et ce qu'on n'affirme pas : le code échappe bien les
> métacaractères et les tests le vérifient. On n'a **pas** mesuré ici le temps
> d'exécution d'une expression `(a+)+$` non échappée sur MongoDB ; le risque
> ReDoS est une propriété connue des moteurs à retour arrière, pas une
> observation faite dans ce projet.

**La garde de type** : `typeof rawQuery !== "string"` → `400` (`backend/src/app.js`,
début de la route `GET /api/tracks`). Elle n'était exercée par aucun test dans le
premier jet ; elle l'est depuis la relecture indépendante (`securite-bonus.test.js:252`,
`q=a&q=b` → `400`) et en réel (`q=a&q=b` → `400`).

**Précision sur Express 5** : avec son parseur de requête « simple », `q[]=a` et
`q[$ne]=x` ne forment **ni tableau ni objet** ; ce sont des clés distinctes, ignorées
(réponse `200` sans filtre, sans injection possible). Seul `q=a&q=b` produit un
tableau. Le test `:252` vérifie aussi que `q[$ne]`, `q[$regex]`, `ownerId=` et
`match[ownerId]=` ne modifient jamais le `$match` envoyé à MongoDB.

---

## 3. Côté frontend

### 3.1 Le service

`TrackService.list(page, limit, q?)` (`src/app/shared/services/track.service.ts:22-27`)
n'ajoute le paramètre `q` **que s'il reste non vide une fois rogné** (`:24-25`) :
un champ vide n'est pas transformé en `?q=` (test `track.service.spec.ts:143`,
trois cas : `undefined`, `''`, `'   '`).

### 3.2 Le flux complet, de la frappe à l'écran

`src/app/components/tracks-page/tracks-page.ts:305-339` (constructeur) :

```text
frappe → search.valueChanges
       → debounceTime(300)                         ← anti-rebond
       → map(trim)
       → filter(différent du filtre appliqué ET ≤ 100 car.)
       → tap : query.set(...) ; page.set(1)        ← retour en page 1
       → switchMap : service.list(1, limit, query) ← annule la requête périmée
       → applyPage(...)  /  applyLoadError(...)
```

| Mécanisme | Où | Pourquoi |
|---|---|---|
| **Anti-rebond 300 ms** | `SEARCH_DEBOUNCE_MS = 300` (`tracks-page.ts:75`), `debounceTime` (`:309`) | sans lui, taper « blues » enverrait 5 requêtes (`b`, `bl`, `blu`…). Avec lui, une requête par **pause** de frappe. Test `tracks-page.spec.ts:495` : rien avant 300 ms d'inactivité |
| **`switchMap`** | `:320` | si l'utilisateur tape « bl » puis « blues », la requête « bl » encore en vol est **annulée** (l'abonnement HTTP est désabonné). Test `tracks-page.spec.ts:529` : `stale.cancelled` est vrai, `fresh.cancelled` est faux |
| **Retour en page 1** | `this.page.set(1)` (`:318`) et `list(1, …)` (`:322`) | un nouveau filtre change l'ensemble des résultats : rester en page 4 d'une liste qui n'a plus que 2 pages afficherait du vide. Test `:514` |
| **Pas de requête inutile** | `query !== this.query()` (`:314`) | si le filtre rogné n'a pas changé (ajout d'un espace), rien n'est envoyé. Test `:548` |
| **Limite alignée sur le serveur** | `SEARCH_MAX_LENGTH = 100` (`:78`), validateur `maxLength` (`:150`), attribut `maxlength` (`tracks-page.html:179`), `query.length <= SEARCH_MAX_LENGTH` (`:314`) | l'utilisateur ne peut même pas saisir plus que ce que le backend accepte ; le backend reste l'autorité (`400`) |
| **`q` conservé** | `list(requestedPage, this.limit(), this.query())` (`load()`, `:375`) | paginer ou recharger garde le filtre. Test `:558` |
| **Bouton « Effacer »** | `clearSearch()` (`:463-467`), `searchNow` | vide le champ, applique **immédiatement** (sans attendre 300 ms), et rend le focus au champ. Test `:572` : une seule requête |

### 3.3 `switchMap` ne suffit pas : la séquence de chargement

Le filtre et la pagination déclenchent des chargements par deux chemins
différents : `switchMap` pour le filtre, `load()` pour les changements de page,
de taille et le rechargement. `switchMap` n'annule que les requêtes **du filtre**.
Pour qu'une réponse périmée d'un autre chemin n'écrase pas l'affichage, chaque
chargement prend un numéro (`beginLoad()`, `tracks-page.ts:407-411`) et seule la
réponse du dernier numéro écrit dans les signaux (`applyPage`, `:413-421` ;
`applyLoadError`, `:423-429`). C'est le garde-fou de course décrit dans
[`../tp3/tests-automatises.md`](../tp3/tests-automatises.md) (§ 2 *bis*), étendu
ici au filtre.

### 3.4 Trois états vides distincts

Un résultat vide n'a pas la même signification selon qu'un filtre est actif, que la bibliothèque est réellement vide, ou que la page demandée a disparu :

| Situation | Message | Action proposée | Template |
|---|---|---|---|
| Un filtre est actif, aucun résultat | « Aucune piste ne correspond à “…” » + « Vérifiez l'orthographe ou essayez un mot plus court. » | bouton « Effacer le filtre » | `tracks-page.html:339-352` |
| Aucun filtre, aucune piste | « Votre bibliothèque est vide. » + « Importez votre premier morceau… » | aucune (le formulaire d'import est au-dessus) | `tracks-page.html:353-362` |
| Des pistes existent mais **la page demandée est vide** (supprimées depuis un autre onglet) | « Cette page ne contient plus de piste. » + « Des morceaux ont peut-être été supprimés depuis un autre onglet. » | bouton « Revenir à la première page » (`backToFirstPage()`, `tracks-page.ts:441-444`) | `tracks-page.html:363-371` |

Confondre les deux serait trompeur : dire « votre bibliothèque est vide » à
quelqu'un qui a 40 pistes mais a tapé une faute de frappe est faux, et ne lui
donne aucune piste de sortie. Test `tracks-page.spec.ts:608` (distinction) et
`:622` (bibliothèque vide).

> **Écart avec le sujet TP2, à connaître** : le sujet demande « l'état vide avec
> `@empty` ». Le template n'utilise plus `@empty` : `@for` est enveloppé dans un
> `@if (tracks().length > 0)` et les trois états vides sont des branches `@else if` / `@else`
> (`tracks-page.html:222`, `:229`, `:337`), précisément parce qu'il en faut
> **plusieurs** différents, ce que `@empty` seul ne sait pas distinguer.

### 3.5 Annonce pour les lecteurs d'écran (`aria-live`)

`tracks-page.html:198-203` : une région `role="status" aria-live="polite"` affiche
« Chargement de la page N… » pendant le chargement, puis
`resultsAnnouncement()` (`tracks-page.ts:159-173`) :

- avec filtre : « 3 pistes trouvées pour « blues ». », « 1 piste trouvée… »,
  « Aucune piste trouvée pour « zzz ». » ;
- sans filtre : « N pistes dans votre bibliothèque. ».

Pourquoi : un utilisateur voyant ne manque pas la liste qui se met à jour ; un
utilisateur de lecteur d'écran, si. Une région `aria-live="polite"` annonce le
changement **sans interrompre** ce qu'il est en train de lire. L'annonce est
vide pendant le chargement et en cas d'erreur (`:160`) pour ne pas annoncer un
résultat périmé. Le singulier et le cas zéro sont accordés (test
`tracks-page.spec.ts:652`). Le champ est dans une région `role="search"`
étiquetée (`tracks-page.html:165`), avec un `<label>` associé (`:166`) et une
aide liée par `aria-describedby` (`:182`, `:195`) ; test `:594`.

---

## 4. Vérifications

### Tests automatisés

| Où | Test | Ligne |
|---|---|---|
| Backend | « filtre q : sous-chaîne du titre, insensible à la casse, regex échappée » — `blues`, `  a.c  ` (le `.` reste littéral), `.*` → rien, `(a+)+$` → rien, `   ` → tout ; et `$regex` envoyé = `a\\.c` avec `$options: "i"` | `backend/test/tracks.test.js:431` |
| Backend | « filtre q de plus de 100 caractères = 400 » (101 → 400, 100 → 200) | `backend/test/tracks.test.js:453` |
| Frontend | service : `q` rogné transmis, absent si vide | `track.service.spec.ts:129`, `:143` |
| Frontend | composant : anti-rebond, page 1, annulation, doublons, conservation, « Effacer », région `search` | `tracks-page.spec.ts:488-605` |
| Frontend | états vides et annonces | `tracks-page.spec.ts:607-696` |

**Vérification par mutation faite par l'agent backend** : sans l'échappement
(`escapeRegex` retiré), le test du filtre échoue ; échappement remis, il repasse.

### Preuves en ligne de commande (vrai serveur + MongoDB Atlas)

`q=BLUES` → **3** résultats (casse ignorée) ; `q=zzz` → **0** ; `q=.*` traité
littéralement → **0** ; `q=(` → **200** sans plantage ; 101 caractères → **400** ;
filtre + pagination → **3** résultats sur **2** pages. Détail et limites dans
[`preuves-integration-reelle.md`](./preuves-integration-reelle.md).

### À faire par le binôme

**[À COMPLÉTER PAR LE BINÔME]** — captures Network du filtre, dans le navigateur :

1. Sur `/tracks`, DevTools → **Network** → filtre **XHR/Fetch**, liste vidée.
2. Taper lentement « blues » dans « Filtrer par titre ». Relever que **le nombre
   de requêtes `GET /api/tracks?...&q=...` est inférieur au nombre de touches**
   (anti-rebond), et que la dernière porte `q=blues`.
3. Taper « bl » puis, **avant 300 ms**, « ues » : une seule requête part.
   Pour voir une annulation, activer le bridage « Slow 4G » : une requête plus
   ancienne apparaît en **(cancelled)**.
4. Relever que la requête porte `page=1` même si vous étiez en page 2 avant de
   filtrer.
5. Saisir `.*` : relever que la réponse n'est **pas** « toutes les pistes »
   (`total` à 0 si aucun titre ne contient littéralement `.*`).
6. Noter l'annonce affichée sous le champ (« N pistes trouvées pour… »).
