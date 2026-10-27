# Bonus TP2 — `MatPaginator` (Angular Material)

Option « AVANCÉ — Angular Material » de `SUJET_ETUDIANT_TP2.md` : utiliser le
composant Paginator d'Angular Material à la place des boutons « Précédent » /
« Suivant » faits main.

Chemins relatifs à `frontend-starter/`. Les numéros de ligne de
`tracks-page.ts`, `tracks-page.html` et `tracks-page.spec.ts` ont été re-vérifiés
sur le **code figé** : **en cas de décalage futur, fiez-vous au nom de la méthode
ou de l'élément**, toujours cité à côté.

---

## 1. Ce qui est branché, et où

| Élément | Emplacement |
|---|---|
| Paquets | `@angular/material` et `@angular/cdk` (`package.json:11` et `:16`, versions `^22.2.0`) |
| Thème Material préconstruit | `angular.json:21` (`azure-blue.css`), chargé avant `src/styles.css` (`:22`) |
| Import du composant | `imports: [… MatPaginator …]` (`src/app/components/tracks-page/tracks-page.ts:95`) |
| Libellés français | `providers: [{ provide: MatPaginatorIntl, useFactory: createFrenchPaginatorIntl }]` (`tracks-page.ts:98`) |
| Fabrique des libellés | `src/app/components/tracks-page/french-paginator-intl.ts:7-21` |
| Balise | `<mat-paginator …>` (`src/app/components/tracks-page/tracks-page.html:385-395`) |
| Gestionnaire d'événement | `onPage(event: PageEvent)` (`tracks-page.ts:451-460`) |
| Tailles proposées | `PAGE_SIZE_OPTIONS = [5, 10, 20]` (`tracks-page.ts:81`) |

---

## 2. Les liaisons du template

`tracks-page.html:384-396` :

| Attribut | Valeur | Pourquoi |
|---|---|---|
| `[length]` | `total()` | le **total renvoyé par le serveur** (`total` de `Page<Track>`), pas le nombre d'éléments reçus : le paginator ne voit jamais toute la bibliothèque |
| `[pageIndex]` | `page() - 1` | **conversion de base** : `MatPaginator` compte les pages à partir de 0, l'API à partir de 1 |
| `[pageSize]` | `limit()` | la taille de page courante |
| `[pageSizeOptions]` | `[5, 10, 20]` | voir §4 |
| `[showFirstLastButtons]` | `true` | boutons « Première » et « Dernière » page |
| `[disabled]` | `loading()` | pas de nouveau clic pendant qu'une requête est en vol |
| `(page)` | `onPage($event)` | **un seul** point d'entrée pour tous les changements |
| `aria-label` | « Pagination de la bibliothèque » | nom accessible de la région |

Le tout est enveloppé dans `@if (total() > 0)` (`tracks-page.html:384`) : sans piste, il n'y a
rien à paginer, et l'état vide s'affiche à la place.

Le paginator **ne détient aucun état de pagination** : il est piloté par les
signaux du composant (`page`, `limit`, `total`) et ne fait que **notifier**. La
source de vérité reste le serveur, dont la réponse alimente ces signaux
(`applyPage`).

---

## 3. Une requête serveur par changement

`onPage` (`tracks-page.ts:451-460`) :

```ts
onPage(event: PageEvent): void {
  if (event.pageSize !== this.limit()) {      // la taille a changé
    if (this.loading()) return;
    this.limit.set(event.pageSize);
    this.page.set(1);                          // retour en page 1
    this.load();                               // une requête
    return;
  }
  this.go(event.pageIndex + 1);                // sinon : changement de page
}
```

et `go()` (`tracks-page.ts:432-437`) borne la cible entre 1 et `pages()`, ignore la page
courante, **ignore tout pendant un chargement**, puis appelle `load()`.

`load()` fait `GET /api/tracks?page=…&limit=…[&q=…]`. C'est exactement ce que la
mission 2 impose : **chaque changement de page est une nouvelle requête HTTP**, et
il est interdit de récupérer toutes les pistes pour les découper localement.

Vérifié par le test « n'émet qu'une requête par changement, jamais de découpage
local » (`tracks-page.spec.ts:800`) : trois appels enchaînés à `onPage`, un seul
`GET /api/tracks?page=2&limit=5` en attente (les deux autres sont ignorés car un
chargement est en cours).

### Pourquoi un changement de taille ramène en page 1

La page « 3 » n'a pas la même signification selon la taille. Avec 5 pistes par
page, la page 3 contient les pistes 11 à 15 ; avec 20 par page, la page 3 serait
les pistes 41 à 60 — qui n'existent peut-être pas. Conserver le numéro afficherait
une page vide ou, pire, un contenu sans rapport avec ce que l'utilisateur
regardait. On repart donc du début (`tracks-page.ts:455`). Test
`tracks-page.spec.ts:787` : après `_changePageSize(10)`, la requête part avec
`page=1&limit=10`, `component.page()` vaut 1.

---

## 4. Pourquoi seulement 5, 10 et 20

Le backend plafonne `limit` à 20 (`backend/src/app.js:541`,
`Math.min(20, Math.max(1, Number(req.query.limit) || 5))`). Le composant, lui, ne
relit **pas** `response.limit` : `applyPage` met à jour `tracks`, `pages`, `total`
et `page`, mais pas `limit` (`tracks-page.ts`, méthode `applyPage`). Si on
proposait « 50 », le serveur répondrait 20 résultats pendant que l'interface
croirait en afficher 50 : la pagination serait fausse sans qu'aucune erreur
n'apparaisse. La liste est donc limitée à ce que le backend sert — c'est ce que dit
le commentaire de `PAGE_SIZE_OPTIONS` (« toutes servies par le backend »).

---

## 5. Libellés français : `MatPaginatorIntl`

Material fournit les textes du paginator (« Items per page », « Next page »…) en
anglais. Le service `MatPaginatorIntl` est le point d'extension prévu pour les
changer. `createFrenchPaginatorIntl()` (`french-paginator-intl.ts:7-21`) le
remplace :

| Propriété | Texte |
|---|---|
| `itemsPerPageLabel` | « Pistes par page : » |
| `firstPageLabel` / `previousPageLabel` / `nextPageLabel` / `lastPageLabel` | « Première page » / « Page précédente » / « Page suivante » / « Dernière page » |
| `getRangeLabel` | « 6 – 10 sur 11 » (ou « 0 sur 0 » si vide) |

Ces textes servent aussi d'`aria-label` aux boutons : les traduire, c'est aussi
rendre le composant **utilisable au lecteur d'écran en français**, pas seulement
plus joli.

**Portée volontairement locale** : le fournisseur est déclaré dans le `providers`
**du composant** (`tracks-page.ts:98`), pas dans `main.ts`. Il ne s'applique donc
qu'à cette page ; le reste de l'application garde les libellés par défaut (commentaire
de `french-paginator-intl.ts:3-6`). Un fournisseur global aurait été plus simple
si d'autres paginators devaient apparaître.

Test « affiche des libellés français » (`tracks-page.spec.ts:729`) : le libellé de
plage vaut `6 – 10 sur 11`, et les quatre boutons portent les `aria-label`
attendus.

---

## 6. Boutons désactivés aux bornes

La mission 2 demande « Précédent » et « Suivant » **désactivés aux bornes**. Le
paginator le fait seul à partir de `pageIndex`, `pageSize` et `length` (Précédent
et Première en page 1, Suivant et Dernière en dernière page). Test
`tracks-page.spec.ts:759` ; et le paginator entier est désactivé pendant un
chargement (test `:774`).

Les boutons faits main de la première version ont disparu du template.

> **Code devenu inutile, à connaître** : `hasPrevious` et `hasNext`
> (`tracks-page.ts:135-136`) étaient les conditions de ces boutons. Plus aucun
> template ni test ne les lit (recherche dans `tracks-page.html` et
> `tracks-page.spec.ts` : aucun résultat). Ce sont des restes de la première
> version, sans effet. Les documents `../tp2/` décrivent d'ailleurs l'ancienne
> interface.

---

## 7. Coût : le poids du bundle

| Mesure du build de production | Poids initial | Transféré (compressé) |
|---|---|---|
| Avant les bonus (fin du TP3) | 456,75 kB | 112,38 kB |
| Après les bonus (état final mesuré) | **737,04 kB** | **161,41 kB** |

Soit environ **+280 kB** bruts (737,04 − 456,75). Cette hausse regroupe le
paginator, le dialogue de confirmation de suppression, le thème Material et le
reste des bonus, pochettes comprises : **la part du seul paginator n'a pas été
mesurée**. À savoir
expliquer : importer un composant Material entraîne son thème et une partie du
CDK, donc le coût dépasse la taille du composant seul.

---

## 8. Vérifications

Tests `MatPaginator` dans `src/app/components/tracks-page/tracks-page.spec.ts`
(bloc `describe('MatPaginator')`, à partir de la ligne 698) : reflète `total`,
page et taille (`pageIndex = page - 1`) ; libellés français ; « Page suivante »
émet la requête de la page 2 ; « Dernière page » demande directement la page 3 ;
boutons désactivés aux bornes ; désactivé pendant un chargement ; changement de
taille → page 1 ; une seule requête par changement.
