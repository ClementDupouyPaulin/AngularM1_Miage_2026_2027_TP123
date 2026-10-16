# TP3 — Restitution orale : les 6 questions

Le sujet indique : « chaque membre doit pouvoir expliquer » ces six points, et
prévient qu'« une fonctionnalité non expliquée […] ne permet pas de valider la
mission ».

Ce document donne une réponse courte (ce qu'il faut dire) puis les éléments de
preuve dans le code (ce qu'il faut pouvoir montrer si on vous le demande).
**Lisez-le comme un support de révision, pas comme un texte à réciter** : un
examinateur repère immédiatement une réponse apprise par cœur, et la consigne du
sujet est de savoir *expliquer*, ce qui suppose de pouvoir répondre à une
question de suivi.

Chemins frontend relatifs à `frontend-starter/`, chemins backend à la racine du
dépôt.

> **Numéros de ligne** : re-vérifiés sur le **code figé** (`tracks-page.ts` 1039
> lignes, `backend/src/app.js` 885 lignes). Tout changement ultérieur les décalera ;
> le **nom de la méthode ou de l'élément**, cité à côté, fait foi
> (`grep -n "nom" src/app/components/tracks-page/tracks-page.ts`).
> La confirmation de suppression est désormais un dialogue Material, voir
> [`suppression-de-piste.md`](./suppression-de-piste.md).

---

## 1. Pourquoi la suppression passe-t-elle par un service ?

**Réponse courte** : parce que le service est la **seule frontière HTTP** de
l'application. L'URL, la méthode et le typage de la réponse restent en un point
unique, testable en isolation ; le composant ne s'occupe que de l'intention de
l'utilisateur et de l'état de l'interface.

**Les preuves** :

- `TrackService.remove()` (`src/app/shared/services/track.service.ts:61-63`) est
  le seul endroit qui connaît l'URL `DELETE /api/tracks/:id`.
- Aucun composant n'injecte `HttpClient`. Seuls `auth.service.ts:13` et
  `track.service.ts:14` le font. Vérifiable :
  `grep -rn "inject(HttpClient)" frontend-starter/src/app`.
- Le commentaire de tête du service le dit explicitement
  (`track.service.ts:8-11`) : « Aucun composant n'injecte `HttpClient` : toute la
  frontière HTTP est ici. »

**Les quatre bénéfices concrets** :

| Bénéfice | Illustration dans ce projet |
|---|---|
| **Un seul point à changer** | si la route devenait `/api/v2/tracks/:id`, une ligne suffit — `track.service.ts:62` |
| **Testable en isolation** | `track.service.spec.ts:280` vérifie la méthode et l'URL sans monter aucun composant |
| **Réutilisable** | `remove()` est déjà appelée par le composant, mais pourrait l'être par une autre page sans dupliquer l'URL |
| **Traversée par les intercepteurs** | tout passe par `HttpClient`, donc par `authInterceptor` qui ajoute le JWT — un `fetch()` écrit à la main dans le composant ne l'aurait pas |

**Ce que fait le composant, et qui n'est pas du ressort du service** : demander
la confirmation (`remove()` dans `tracks-page.ts`), gérer la garde anti-double-clic
(`:591`), afficher le SnackBar (`:649`, `:666`), recharger la liste (`:661`).
C'est de l'**intention utilisateur** et de l'**état d'interface** : rien de tout
cela ne concerne HTTP.

**Question de suivi probable** — *« et si on mettait la confirmation (le dialogue) dans
le service ? »* Ce serait une erreur de couche : le service serait alors
inutilisable sans interaction utilisateur (impossible d'appeler `remove()` depuis
un traitement par lot), et surtout intestable sans simuler une boîte de dialogue.
Un service ne doit rien savoir de l'interface.

---

## 2. Comment le backend protège-t-il la suppression ?

**Réponse courte** : par **deux niveaux successifs**, tous les deux côté serveur.
D'abord le middleware `auth` qui vérifie cryptographiquement la signature et
l'expiration du JWT ; ensuite le filtre `ownerId` dans la requête MongoDB, qui
empêche de supprimer la piste d'autrui **même avec un JWT parfaitement valide**.

**Niveau 1 — *qui êtes-vous ?*** `backend/src/app.js:303-324`

- Exige un en-tête commençant par `Bearer ` (`:309-312`), sinon
  `401 { message: "Authentification requise" }`.
- `jwt.verify(raw.slice(7), SECRET)` (`:317`) valide la **signature** et
  l'**expiration** (2 h, `:298`). C'est cryptographique : sans `SECRET` — qui ne
  quitte jamais le backend — on ne peut pas fabriquer ni modifier un token. Échec
  → `401 { message: "Jeton invalide ou expiré" }` (`:322`).
- L'identité vérifiée est placée dans `req.auth` ; `req.auth.sub` contient
  l'`_id` MongoDB de l'utilisateur.

**Niveau 2 — *cette piste est-elle à vous ?*** `backend/src/app.js:691-694`

```js
const track = await Track.findOneAndDelete({
  _id: req.params.id,
  ownerId: req.auth.sub,
}).select("+storedName +coverStoredName");
```

Le filtre porte sur **deux** critères. Si la piste appartient à un autre
utilisateur, la requête ne trouve rien et le serveur répond
`404 { message: "Piste inconnue" }` (`:696-699`).

**Le point décisif, à dire absolument** : `ownerId` est comparé à
`req.auth.sub`, une valeur issue **du token signé** — pas de l'URL, pas du corps
de la requête. Il n'existe donc **aucun champ que le client puisse falsifier**
pour se faire passer pour un autre propriétaire.

**Pourquoi un `404` et non un `403`** : répondre `403 Forbidden` sur la piste
d'un autre **confirmerait son existence**. Un attaquant pourrait énumérer les
identifiants valides. En répondant uniformément `404`, le serveur ne dit rien de
plus que « pas de piste avec cet identifiant *pour vous* ». Détail complet dans
[`suppression-de-piste.md` §4](./suppression-de-piste.md#4-le-cas-404--pourquoi-le-message-reste-prudent).

**Et le frontend ?** `authGuard` (`src/app/shared/guards/auth.guard.ts:6-11`), le
bouton désactivé (`tracks-page.html:292`) et la confirmation sont du **confort**,
pas de la sécurité. Tous contournables : écrire n'importe quelle chaîne dans
`localStorage.gpc_token` (le guard ne vérifie que la *présence* d'un token),
retirer l'attribut `disabled` dans l'inspecteur, ou tout simplement ne pas
utiliser l'application :

```bash
curl -X DELETE http://localhost:3000/api/tracks/<id> -H "Authorization: Bearer <token>"
```

Aucune ligne de code Angular n'est exécutée sur ce chemin.

**La formule à retenir** : le frontend décide ce que l'utilisateur **voit** et ce
qu'il peut faire **commodément** ; le backend décide ce qui **arrive réellement
aux données**. Si l'on retirait toutes les protections frontend, la sécurité
serait intacte.

**Preuves réellement mesurées** : `DELETE` avec JWT valide sur une piste possédée
→ `204` ; `DELETE` sur une piste déjà supprimée → `404 {"message":"Piste
inconnue"}` ; `GET /api/tracks/:id/audio` sans JWT → `401`.

---

## 3. Comment Angular calcule-t-il le pourcentage d'upload ?

**Réponse courte** : il ne le calcule pas — il fournit les **matériaux**, et
c'est le composant qui calcule. Angular émet des événements
`HttpEventType.UploadProgress` portant `loaded` et `total` (des octets) ; le
composant en fait `Math.round((loaded / total) * 100)`.

**La chaîne complète, en trois maillons** :

**1. Demander les événements** — `src/app/shared/services/track.service.ts:43-46`

```ts
return this.http.post<Track>('/api/tracks', body, {
  observe: 'events',      // observer le cycle de vie, pas seulement le corps
  reportProgress: true,   // et inclure les étapes intermédiaires
});
```

Les deux options sont nécessaires. Sans elles, `HttpClient` renvoie un
`Observable<Track>` qui n'émet qu'une fois, à la fin. Avec elles, le type devient
`Observable<HttpEvent<Track>>`.

**2. Calculer** — `src/app/components/tracks-page/tracks-page.ts:543-553`

```ts
if (event.type === HttpEventType.UploadProgress) {
  if (event.total) {
    this.uploadProgress.set(Math.min(100, Math.round((event.loaded / event.total) * 100)));
  } else {
    this.uploadProgress.set(null);   // total inconnu → état indéterminé
  }
  return;
}
```

Deux précautions à savoir justifier : `event.total` est **optionnel** dans le
type Angular (la taille n'est pas toujours annoncée) — d'où le `else` qui laisse
`null`, c'est-à-dire une barre indéterminée plutôt qu'un faux `0 %` ; et le
`Math.min(100, ...)` est une ceinture de sécurité contre un arrondi à 101.

**3. Afficher** — `src/app/components/tracks-page/tracks-page.html:118-139`, une
`<progress>` avec `[value]` si la progression est mesurée (`:121-130`), sans
attribut `value` sinon (`:132-135`), ce que le navigateur rend comme une animation
indéterminée.

**La question de suivi qui tombe presque toujours** — *« la barre est à 100 %,
c'est réussi ? »* **Non.** `loaded / total` compte les **octets sortis du
navigateur**, rien d'autre. Après le dernier octet, le travail du serveur
*commence* : Multer valide le type MIME (`backend/src/app.js:358-371`) et la
taille (`:357`), écrit sur le disque, puis MongoDB enregistre (`:632-642`).
Chacune de ces étapes peut échouer **après** 100 %.

D'où la ligne `tracks-page.ts:558` :

```ts
// Seul HttpEventType.Response prouve que le serveur a accepté la piste
if (event.type !== HttpEventType.Response) return;
```

**L'exemple concret à donner** : renommer un `.txt` en `.mp3` et l'envoyer. La
barre atteint 100 %, puis le serveur répond
`400 {"message":"Format audio non accepté"}` — résultat réellement mesuré. C'est
pour cela que le libellé affiché est « N % **des octets transmis** » et non « N %
terminé » (`tracks-page.html:130`), et qu'un test verrouille ce comportement
(`tracks-page.spec.ts:275`).

**Question de suivi possible** — *« pourquoi pas `withFetch()` ? »* Parce que
l'API `fetch` du navigateur n'expose pas la progression de l'**envoi**. Le
commentaire de `src/main.ts:12-13` le documente. Détail dans
[`progression-upload.md` §3](./progression-upload.md#pourquoi-withfetch-est-proscrit-ici).

---

## 4. Pourquoi les tests HTTP n'ont-ils pas besoin de MongoDB ?

**Réponse courte** : parce qu'ils ne font **aucune** requête réseau.
`provideHttpClientTesting()` remplace le backend HTTP d'Angular par une file
d'attente en mémoire ; le test inspecte la requête émise et décide lui-même de la
réponse. Aucun serveur, aucune base.

**Le mécanisme** — deux providers, systématiquement ensemble
(`auth.service.spec.ts:30`) :

```ts
providers: [provideHttpClient(), provideHttpClientTesting()],
```

Puis le test pilote les deux bouts de l'échange :

```ts
const request = httpMock.expectOne('/api/tracks?page=2&limit=3');  // ce que le code a demandé
expect(request.request.method).toBe('GET');
request.flush(fauxPage);                                            // ce que le serveur répond
```

**Ce que cela apporte** : rien à lancer ; aucune donnée de test à créer ni à
nettoyer ; un `404`, un `500` ou un « serveur injoignable » s'obtiennent en une
ligne ; des millisecondes au lieu de secondes ; et surtout **un test rouge vient
du code**, pas du réseau ou de la base.

**L'exemple le plus parlant** : les événements `UploadProgress`. Contre un vrai
serveur en local, le transfert est trop rapide et le nombre d'événements n'est
pas prévisible — le test serait *intermittent*. Avec `HttpTestingController`, le
test émet exactement les événements qu'il veut, y compris un `UploadProgress`
**sans** `total` (`tracks-page.spec.ts:260`), qu'un vrai serveur ne produirait
pratiquement jamais — et c'est justement le cas limite que le code doit gérer.

**La limite, à dire spontanément — c'est ce qui distingue une bonne réponse** :
ces tests vérifient que le **frontend respecte le contrat**
(`API_CONTRACT.md`). Ils ne vérifient pas que le backend le respecte aussi,
puisque la réponse simulée est celle qu'on a écrite. Si le backend renvoyait
`totalPages` au lieu de `pages`, **tous ces tests resteraient verts** et
l'application serait cassée.

C'est pour couvrir ce trou que deux autres niveaux existent : les tests
d'intégration backend (`backend/test/api.test.js`, 2 tests verts) et les
vérifications `curl` contre l'API réelle — dont
`GET /api/tracks?page=2&limit=3`, qui a effectivement renvoyé `page=2, limit=3`.

---

## 5. Que vérifie un test d'intercepteur ou de guard ?

**Réponse courte** : leur **décision**, et non un rendu à l'écran. Ce sont des
briques invisibles : aucun écran ne les montre. Un test de guard vérifie sa
valeur de retour ; un test d'intercepteur vérifie la requête telle qu'elle
ressort transformée, ou l'effet de bord déclenché.

### Un test de guard — `auth.guard.spec.ts`, 3 tests

`authGuard` est une fonction `CanActivateFn` : elle renvoie `true` ou un
`UrlTree` de redirection. On teste donc **la valeur de retour**, en exécutant la
fonction dans un contexte d'injection — pas une navigation complète.

| Test | Ligne | Entrée | Attendu |
|---|---|---|---|
| Redirige sans token | 37 | `token()` à `null` | un `UrlTree` vers `/login` |
| Laisse passer avec token | 45 | `token()` renseigné | `true` |
| Refuse un token **vide** | 51 | `token()` à `''` | un `UrlTree` |

**Le troisième est le plus intéressant** : c'est un cas limite. `''` est *falsy*,
donc `auth.token() ? true : redirect` (`auth.guard.ts:10`) redirige bien. Mais si
quelqu'un réécrivait la condition en `auth.token() !== null`, une chaîne vide
passerait et l'utilisateur atteindrait une page protégée sans session. Le test
verrouille l'**intention** (« une session existe »), pas l'écriture actuelle.

### Un test d'intercepteur — `auth.interceptor.spec.ts`, 4 tests

Un intercepteur ne s'appelle pas utilement à la main : il faut le faire traverser
par une vraie requête `HttpClient`. Le test l'enregistre dans le `TestBed`, émet
une requête, et inspecte ce que `HttpTestingController` a reçu — la requête
**après transformation** :

```ts
expect(request.request.headers.get('Authorization')).toBe('Bearer …');
```

Les quatre cas : en-tête ajouté quand un token existe (`:38`) ; **aucun** en-tête
sans token (`:50` — surtout pas un `Bearer null`) ; le token est **relu à chaque
requête** (`:63`, pour qu'une connexion en cours de session soit prise en
compte) ; ni la méthode, ni l'URL, ni le corps ne sont modifiés (`:78`).

### Le cas à effet de bord — `auth-error.interceptor.spec.ts`, 7 tests

Celui-ci ne transforme pas la requête : il **déclenche une action**
(déconnexion + navigation). Le test injecte donc des doubles d'`AuthService` et
de `Router`, et vérifie qu'ils ont été appelés — ou non :

| Cas | Ligne | Attendu |
|---|---|---|
| `401` sur route protégée | 34 | déconnexion + redirection |
| `404` | 48 | **aucune** réaction |
| Réponse réussie | 60 | **aucune** réaction |
| `401` sur `POST /api/auth/login` | 77 | **ni** logout **ni** redirection |
| `401` sur `POST /api/auth/register` | 94 | idem |
| `401` sur `GET /api/users/me` | 110 | déconnexion |
| `401` sur route protégée avec query string | 127 | déconnexion (cas limite du `startsWith`) |

**L'argument qui porte** : les quatre derniers sont nés d'un **bug réel** — un
mot de passe refusé provoquait une fin de session, la redirection recréant le
composant de login et effaçant son message d'erreur. Un test écrit après un bug
est le seul qui garantisse que ce bug ne reviendra pas. Historique complet dans
[`../mission1/probleme-3-gestion-401.md`](../mission1/probleme-3-gestion-401.md).

**Question de suivi probable** — *« comment savez-vous que vos tests ne sont pas
vides ? »* Par **vérification par mutation** : on casse volontairement la ligne
de code que le test protège, on vérifie que ce test — et lui seul — passe au
rouge, puis on restaure. Si le test reste vert après qu'on a cassé le code, il
est inutile. Voir
[`tests-automatises.md` §6](./tests-automatises.md#6-comment-on-sait-quun-test-nest-pas-vide--la-vérification-par-mutation).

---

## 6. Quelle différence existe-t-il entre un test unitaire et un test d'intégration ?

**Réponse courte** : le **périmètre**. Un test unitaire isole une seule unité et
remplace ses dépendances par des doubles ; un test d'intégration fait
réellement collaborer plusieurs briques. Le premier dit *où* est le problème, le
second dit *qu'il y en a un*.

| | **Unitaire** | **Intégration** |
|---|---|---|
| Périmètre | une classe, une fonction | plusieurs briques ensemble |
| Dépendances | doubles (*mocks*, *stubs*) | réelles (serveur, base) |
| Vitesse | millisecondes | secondes à minutes |
| En cas d'échec | on sait **où** | on sait **qu'il y a** un problème |
| Fragilité | faible | forte (réseau, données, ordre) |
| Nombre souhaitable | beaucoup | quelques-uns, sur les chemins critiques |

**Dans ce projet, concrètement** :

- **Unitaires** : toute la suite frontend (15 fichiers, 188 tests). Les services et
  intercepteurs sont isolés derrière `HttpTestingController` ; les composants
  sont montés avec `TestBed` mais la couche HTTP est remplacée, et pour
  `tracks-page.spec.ts` le `MatSnackBar` l'est aussi par un double
  (`tracks-page.spec.ts:97` : `snackBar = { open: vi.fn() }`).
- **Intégration** : `backend/test/api.test.js`, qui démarre une vraie
  application Express. C'est l'extension facultative proposée par le sujet.

**Pourquoi remplacer `MatSnackBar` par un double ?** Deux raisons, et il faut les
deux : cela évite de monter un *overlay* et des animations Material sous jsdom
(fragile et lent), et surtout cela permet d'**asserter le message affiché**, qui
est un livrable explicite de la Mission 5. Un double n'est pas seulement une
béquille : c'est souvent un point d'observation.

**Le troisième niveau, absent ici** : le test **end-to-end** (Playwright,
Cypress), qui pilote un vrai navigateur contre l'application complète. C'est le
seul qui pourrait vérifier qu'un fichier audio se joue réellement ou qu'une barre
de progression bouge. C'est précisément pourquoi ces points-là restent des
vérifications manuelles, à faire dans le navigateur.

**La façon de conclure qui montre qu'on a compris** : ce n'est pas un choix
« l'un ou l'autre ». Les deux sont complémentaires, et c'est visible dans ce
projet — les 15 fichiers de tests unitaires ne détecteraient pas un changement de
format de réponse du backend (§4), d'où les tests d'intégration backend et les
vérifications `curl` contre l'API réelle.

---

## Auto-évaluation

**[À COMPLÉTER PAR LE BINÔME]** — c'est la partie que personne ne peut écrire à
votre place, et le sujet en fait un critère (« chaque membre doit pouvoir
expliquer »).

Méthode suggérée, à faire à deux et à chronométrer :

1. L'un pose les six questions dans un ordre aléatoire, l'autre répond **sans
   notes et sans écran**.
2. Pour chaque réponse, le questionneur enchaîne avec **une** question de suivi
   (celles signalées « question de suivi probable » ci-dessus sont les plus
   fréquentes).
3. Inverser les rôles.
4. Remplir le tableau ci-dessous honnêtement : c'est un outil de révision, pas
   une note.

| Question | Membre 1 | Membre 2 | À revoir |
|---|---|---|---|
| 1. Pourquoi la suppression passe par un service | | | |
| 2. Comment le backend protège la suppression | | | |
| 3. Comment Angular calcule le pourcentage | | | |
| 4. Pourquoi les tests HTTP n'ont pas besoin de MongoDB | | | |
| 5. Ce que vérifie un test d'intercepteur ou de guard | | | |
| 6. Test unitaire vs test d'intégration | | | |

Deux exercices qui valent mieux qu'une relecture, parce qu'ils se font dans le
code et pas dans ce document :

- **Ouvrir un fichier de test au hasard et expliquer chaque ligne.** C'est la
  vérification la plus probable à l'oral sur la Mission 7.
- **Faire une vérification par mutation** (`tests-automatises.md` §6) : casser
  une ligne, constater le test rouge, restaurer. Dix minutes, et la question 5
  devient évidente.
