# Refonte UI/UX — coque, connexion, inscription et profil

Ce document décrit les choix d'interface et d'accessibilité faits sur la **coque**
de l'application (en-tête, navigation, zone de contenu) et sur les pages
**connexion**, **inscription** et **profil**. La page des pistes (bibliothèque) a
son propre périmètre et n'est pas traitée ici.

Aucune de ces évolutions ne change le contrat HTTP ni la logique d'authentification
décrite dans [`../mission1/`](../mission1/README.md) : le flux de connexion, le
Signal `token` et l'intercepteur sont inchangés. Seuls l'interface et le
chargement du profil dans la coque ont évolué.

Chemins relatifs à `frontend-starter/`.

---

## 1. Les jetons de design (`src/styles.css`)

Plutôt que d'écrire des couleurs et des espacements en dur dans chaque composant,
`src/styles.css` déclare des **variables CSS** (des *design tokens*) sur `:root`
(`src/styles.css:6-45`). Les composants ne les redéfinissent jamais : ils les
consomment avec `var(--…)`. Le commentaire d'en-tête le dit (`:1-5`) : « jamais de
couleur en dur ».

| Famille | Exemples | Lignes |
|---|---|---|
| Couleurs de fond et de texte | `--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--border` | `:12-17` |
| Marque | `--brand`, `--brand-strong`, `--on-brand`, `--brand-deep` | `:18-21` |
| États | `--danger`, `--danger-bg`, `--success`, `--success-bg`, `--info-bg` | `:22-26` |
| Focus | `--focus` | `:27` |
| Espacements | `--space-1` (0,25 rem) à `--space-6` (2 rem) | `:30-35` |
| Rayons et ombres | `--radius-sm/md/lg`, `--shadow-sm/md` | `:36-40` |
| Typographie | `--font-sans` | `:9` |

**Pourquoi c'est utile** : changer la couleur de marque ou l'espacement de base se
fait en **un seul endroit**, et surtout le **thème sombre** (§2) n'a qu'à
redéfinir ces variables pour que tous les composants suivent, sans toucher à leur
CSS.

Des classes utilitaires partagées complètent les jetons : `.card` (`:103`),
`.alert` + `.alert-error` / `.alert-success` / `.alert-info` (`:132-135`),
`.btn-secondary` / `.btn-danger` (`:126-129`), `.field-error` (`:114`), `.hint`
(`:115`), `.skeleton` (`:140`).

### Les messages ne reposent pas sur la couleur seule

Un utilisateur daltonien ne distingue pas toujours un rouge d'un vert. Les alertes
associent donc la couleur à un **texte** et à une **bordure gauche épaisse**
(`.alert`, `border-left: 4px solid currentColor`, `:132`). Le lien de navigation
actif cumule fond, graisse et **soulignement épais** (`src/app/components/app/app.css:23-27`,
commentaire : « pas seulement la couleur »). Un champ invalide reçoit en plus
`aria-invalid` (§6).

> Les **ratios de contraste** des couleurs choisies n'ont pas été mesurés dans
> cette session : aucune affirmation de conformité à un niveau WCAG n'est faite
> ici.

---

## 2. Thème sombre

`src/styles.css:47-68` : un bloc `@media (prefers-color-scheme: dark)` redéfinit
les jetons de couleur (`--bg`, `--surface`, `--text`, `--brand`, `--danger`, etc.).
`:root` déclare aussi `color-scheme: light dark` (`:7`), ce qui demande au
navigateur d'adapter ses propres contrôles (barres de défilement, champs natifs).

**Choix à connaître** : le thème **suit le système d'exploitation** de
l'utilisateur ; il n'y a **pas de bouton** pour basculer manuellement. C'est la
solution la plus simple et la plus respectueuse du réglage de l'utilisateur, au
prix de ne pas permettre « sombre dans l'application, clair dans le système ».

Les couleurs du thème sombre sont des valeurs distinctes, pas une simple inversion
(par exemple `--brand` passe de `#1d755e` à `#4fc3a1` : un vert foncé sur fond
sombre serait illisible).

---

## 3. Mouvement réduit (`prefers-reduced-motion`)

`src/styles.css:154-156` :

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; … transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```

Les personnes sensibles au mouvement (troubles vestibulaires, épilepsie) peuvent
demander au système de réduire les animations. Cette règle **neutralise
globalement** les animations : les indicateurs de chargement (`.spinner`, déclaré
dans les CSS de connexion et de profil), le squelette animé (`.skeleton`, `:140`) et
le défilement doux (`html { scroll-behavior: smooth }`, `:71`) cessent de bouger.
Le texte accompagnant l'indicateur (« Connexion en cours… ») reste affiché : l'état
est donc toujours compréhensible sans animation.

`!important` est ici justifié : il faut l'emporter sur les déclarations plus
spécifiques de chaque composant.

---

## 4. Le lien d'évitement et la zone de contenu

### À quoi sert un lien d'évitement

Un utilisateur qui navigue **au clavier** doit passer par tous les liens de
l'en-tête avant d'atteindre le contenu, à chaque page. Un *lien d'évitement*
(« Aller au contenu principal ») est le **premier élément focalisable** de la page :
il reste invisible jusqu'à ce qu'il reçoive le focus, puis permet de sauter
l'en-tête.

| Élément | Où |
|---|---|
| Le lien, premier enfant de la page | `src/app/components/app/app.html:1-3` |
| Invisible puis visible au focus | `src/styles.css:82-87` (`top: -4rem`, puis `top: var(--space-2)` sur `:focus`) |
| La cible : `<main id="contenu" tabindex="-1">` | `app.html:42` |
| Le gestionnaire du clic | `AppComponent.skipToContent()` (`src/app/components/app/app.ts:31-34`) |

`tabindex="-1"` rend `<main>` **focalisable par programme** sans l'ajouter à l'ordre
de tabulation. Le contour de focus est retiré sur cette cible
(`app.css:41`, `main:focus { outline: none }`) : `<main>` n'est pas un contrôle, on
ne le « manipule » pas, et un cadre autour de toute la page serait parasite.

### Pourquoi `preventDefault()`

`skipToContent` (`src/app/components/app/app.ts:31-34`) :

```ts
skipToContent(event: Event, main: HTMLElement): void {
  event.preventDefault();
  main.focus();
}
```

Le commentaire du code (`app.ts:26-30`) donne la raison : déplacer le focus sans
laisser le navigateur suivre le `href`, pour **ne pas ajouter `#contenu` à l'URL**
(donc à l'historique) et **ne pas faire réagir le routeur à un simple saut
d'ancre**. Le lien reste un vrai `<a href="#contenu">` : sans JavaScript, ou pour un
outil d'accessibilité qui l'analyse, il garde son sens.

> **Correction d'une explication fausse.** La première version de ce commentaire
> (et de ce document) invoquait `<base href="/">` : « avec `<base href="/">`,
> `#contenu` rechargerait la racine du site ». Or **aucune balise `<base>` n'existe**
> dans le projet : ni dans `src/index.html`, ni dans le `index.html` produit par le
> build. Sans `<base>`, Angular 22.1.4 retombe sur l'origine du document pour la
> base du routeur (`node_modules/@angular/common/fesm2022/_location-chunk.mjs:70`).
> La raison invoquée n'était donc **pas démontrable** dans l'état du dépôt. Elle a
> été relevée par la documentation, confirmée dans le code par l'orchestrateur, et le
> commentaire a été **corrigé** (voir [`relecture-independante.md`](./relecture-independante.md) §3).
> Le comportement n'a toujours pas été observé dans un navigateur par cet auteur.
>
> Le test `app.spec.ts` (« expose un lien d'évitement qui déplace le focus vers
> `<main id="contenu">` ») vérifie que le focus arrive bien sur `<main>` après un
> clic ; il **n'asserte pas** que l'action par défaut est annulée.

---

## 5. Navigation : `aria-current` et liens masqués sans session

### `aria-current="page"`

`routerLinkActive="active"` n'est qu'une **classe CSS** : un lecteur d'écran ne la
voit pas. `ariaCurrentWhenActive="page"` (`app.html:18`, `:21`, `:23`, `:24`) fait
poser par Angular l'attribut `aria-current="page"` sur le lien de la page
courante : le lecteur d'écran annonce « page courante », et le visuel (fond +
soulignement, `app.css:24-27`) fait de même pour les voyants. Test
`app.spec.ts:94` : après navigation vers `/profile`, **un seul** lien porte
`aria-current="page"` et c'est `/profile`.

### Liens masqués sans token

`app.html:17-27` : `@if (auth.token())` affiche « Backing tracks » et « Profil » ;
sinon (`@else`) seulement « Connexion » et « Inscription ». Un visiteur
non connecté ne voit donc pas de lien qui le renverrait aussitôt vers `/login`
(`authGuard`). Test `app.spec.ts:109`. Rappel : masquer un lien est du **confort**,
pas de la sécurité ; la protection est dans `authGuard` et surtout côté serveur
(voir [`../mission0-cartographie.md` §6](../mission0-cartographie.md#6-routes-publiques-et-routes-protégées)).

### Le compte dans l'en-tête

`app.html:30-39` : quand une session existe, le **nom de l'utilisateur** (si le
profil est chargé) et le bouton « Déconnexion » apparaissent. Voir §8 pour le
chargement du profil.

### Cibles tactiles et petits écrans

Les liens, boutons et champs de formulaire ont une hauteur minimale de
`2.75rem` (44 px) : `app.css:18`, `:33` ; `login-page.css:11`, `:25`, `:34`. En
dessous de 720 px, l'en-tête passe sur deux lignes
(`app.css:43-52`) et le sous-titre de la marque est masqué.

---

## 6. Formulaires accessibles : connexion et inscription

### 6.1 Le bouton afficher / masquer le mot de passe

`src/app/components/login-page/login-page.html:33-63` (même structure dans
l'inscription, `register-page.html`) :

- le type du champ bascule : `[type]="showPassword() ? 'text' : 'password'"`
  (`login-page.html:35`) ;
- l'état est un Signal : `showPassword = signal(false)`
  (`login-page.ts:17`), basculé par `togglePassword()` (`:31-33`) ;
- le bouton porte `aria-pressed` (état), `aria-controls="login-password"` (champ
  commandé) et un **libellé fixe** `aria-label="Afficher le mot de passe"`
  (`login-page.html:50-52`).

**Pourquoi un libellé fixe** : c'est le motif ARIA du *bouton à bascule* : le nom
reste le même et c'est `aria-pressed` qui dit s'il est enfoncé. Changer le libellé
**et** `aria-pressed` ferait annoncer une phrase contradictoire (« Masquer le mot
de passe, activé »).

L'icône est décorative (`aria-hidden="true" focusable="false"`, `:55`). Le bouton
est `type="button"` pour ne pas soumettre le formulaire. Il mesure 44 px
(`login-page.css:16-20`).

Tests : `login-page.spec.ts:135` et `register-page.spec.ts:54` — le champ est masqué
par défaut puis révélé, avec `aria-pressed`.

> Afficher un mot de passe à l'écran est un choix d'utilisabilité (éviter les
> fautes de frappe), à faire par l'utilisateur lui-même. Les composants ne
> journalisent jamais le mot de passe : `login-page.ts` ne trace que « Connexion
> réussie » (`console.debug`), conformément à la consigne du sujet.

### 6.2 Les messages d'erreur reliés à leur champ (`aria-describedby`)

Un message rouge placé sous un champ n'est pas **relié** à ce champ pour un
lecteur d'écran. Le motif retenu :

```html
<input id="login-email" … [attr.aria-invalid]="invalid && touched"
       [attr.aria-describedby]="invalid && touched ? 'login-email-error' : null" />
<p class="field-error" id="login-email-error">…</p>
```

(`login-page.html:12-27`). Quand le champ est invalide **et** touché, il porte
`aria-invalid="true"` et référence le message par son `id`, que le lecteur
d'écran lit en même temps que le champ.

Le champ mot de passe référence **deux** éléments : l'aide permanente et l'erreur
quand elle existe (`login-page.html:40-44`) :
`'login-password-hint login-password-error'`, sinon seulement
`'login-password-hint'`. Dans l'inscription, l'aide (« 8 caractères minimum… »,
`register-page.html:90-92`) reste donc lue même quand l'erreur apparaît.

Tests : `login-page.spec.ts:150` (l'erreur de chaque champ est reliée à son
`input`), `register-page.spec.ts:70` (l'aide reste liée, l'erreur s'y ajoute) et
`:84` (nom et email).

### 6.3 État de chargement

Le bouton d'envoi est désactivé si le formulaire est invalide **ou** pendant
l'envoi (`login-page.html:75`, `[disabled]="form.invalid || submitting()"`),
affiche un indicateur (`.spinner`, `aria-hidden`) et change de libellé
(« Connexion en cours… »). Le formulaire porte `[attr.aria-busy]="submitting()"`
(`:9`). L'erreur du serveur, elle, est annoncée par un `role="alert"`
(`:6`). Test `login-page.spec.ts:168`.

---

## 7. Page profil

`src/app/components/profile-page/profile-page.html` et `.ts`.

### « Enregistrer » désactivé si le nom est inchangé

`profile-page.ts:37-39` :

```ts
readonly canSave = computed(
  () => this.nameValue() !== this.auth.currentUser()?.name && this.form.controls.name.valid,
);
```

et `[disabled]="!canSave() || saving()"` (`profile-page.html:54`). Un bouton actif
alors que rien n'a changé inviterait à envoyer un `PUT` inutile. Le `FormControl`
n'expose pas sa valeur sous forme de signal : `nameValue` la projette avec
`toSignal(valueChanges)` (`profile-page.ts:32-34`) pour que le `computed` se
recalcule à chaque frappe.

Tests : `profile-page.spec.ts:73` (désactivé tant que le nom n'a pas changé),
`:84` (désactivé si vide), `:102` (confirmation puis le bouton se désactive de
nouveau).

> **Une limite subsiste, un défaut a été corrigé** :
> 1. **Non corrigée** — la comparaison porte sur la valeur **brute** : « Alice␣ »
>    (avec une espace finale) est différent de « Alice », le bouton s'active, alors
>    que le backend rogne le nom (`backend/src/models/User.js:10`, `trim: true`) et
>    que le résultat sera identique. Effet nul, cosmétique.
> 2. **Corrigée** — le frontend n'exigeait que `Validators.required`, alors que le
>    schéma backend impose `minlength: 2` avec `trim` (`User.js:10`) : un nom d'un
>    caractère activait le bouton et c'était le **backend** qui refusait. Le
>    validateur `trimmedMinLength`
>    (`src/app/shared/validators/trimmed-min-length.validator.ts:7-12`) applique
>    maintenant la règle **sur la valeur rognée** dans le profil (`profile-page.ts:28`)
>    et dans l'inscription (`register-page.ts:28`), avec le message « Le nom doit
>    contenir au moins 2 caractères ». Tests : « refuse le nom « a » / « a␣ » /
>    « ␣␣␣ » » (`it.each`, `profile-page.spec.ts`) et `register-page.spec.ts`.

### Les autres éléments

- **Avatar à initiales** : `initials` (`profile-page.ts:41-44`) prend la première
  lettre des deux premiers mots du nom ; décoratif (`aria-hidden`,
  `profile-page.html:20`). Test `profile-page.spec.ts:90`.
- **Date lisible** : `memberSince` (`:46-52`) formate avec
  `Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' })`, dans un
  `<time datetime="…">` (`profile-page.html:25`) : lisible pour l'humain, exploitable
  par la machine. `timeZone: 'UTC'` évite qu'une date proche de minuit s'affiche
  la veille selon le fuseau du navigateur.
- **Squelette de chargement** : tant que le profil n'est pas là, des formes
  grisées remplacent le contenu (`profile-page.html:61-72`), avec
  `aria-busy="true"` et un texte « Chargement du profil… » réservé aux lecteurs
  d'écran (`.visually-hidden`, `role="status"`). Test `:96`.
- **Messages** : erreur en `role="alert"` (`:10`), confirmation en `role="status"`
  (`:13`) — l'erreur est assertive, la confirmation polie.

---

## 8. Le profil se charge dans la coque après un F5

### Le problème

Deux états ne sont pas persistés de la même façon
(`src/app/shared/services/auth.service.ts:15-16`) : le Signal `token` est
**réhydraté** depuis `localStorage` au démarrage, mais `currentUser` **repart à
`null`**. Après un rafraîchissement de la page, l'utilisateur est donc connecté
(le token existe) mais l'en-tête, qui affiche son nom (`app.html:32-34`), n'a rien
à montrer. C'est la même asymétrie que celle expliquée dans
[`../mission1/flux-connexion-et-signals.md`](../mission1/flux-connexion-et-signals.md),
vue cette fois depuis l'en-tête.

### La solution

`AppComponent` appelle `restoreProfileAfterReload()` à sa construction
(`app.ts:16-18`, méthode `:41-52`) :

```ts
if (!this.auth.token() || this.auth.currentUser()) { return; }   // rien à faire
this.auth.profile().pipe(takeUntilDestroyed()).subscribe({ error: … });
```

On ne charge **que si** un token existe **et** que le profil manque : déconnecté,
ou déjà connu, aucune requête. Un échec reste silencieux dans l'interface (le `401`
est déjà traité par l'intercepteur : déconnexion + redirection) ; il est
simplement journalisé. Tests `app.spec.ts:133`, `:138`, `:143` (les trois cas) et
`:148` (un `401` ou une panne réseau n'affichent pas d'erreur et ne plantent pas).

### Limite connue : deux requêtes après un F5 sur `/profile`

Après un F5 **directement sur `/profile`**, deux composants demandent chacun le
profil :

1. la coque, via `restoreProfileAfterReload()` → `AuthService.profile()`
   (`app.ts:47`) ;
2. la page profil, via `ngOnInit()` → `load()` → `AuthService.profile()`
   (`profile-page.ts:54-56` et `:63`).

On observe donc **deux `GET /api/users/me`** au lieu d'un. **Sans conséquence
fonctionnelle** : les deux réponses sont identiques et aboutissent au même Signal.
**Non corrigé**, volontairement : le coût est une requête de plus sur un point
d'entrée précis (F5 sur cette page), et le corriger demanderait de partager une
requête en cours entre la coque et la page (par exemple en mémorisant
l'`Observable` dans `AuthService`), ce qui ajoute de la complexité pour un gain
faible. À signaler plutôt qu'à masquer. Sur `/tracks` après un F5, une seule
requête part (celle de la coque).

---

## 9. Vérifications

| Sujet | Tests |
|---|---|
| Coque | `app.spec.ts` : lien d'évitement (`:80`), `aria-current` (`:94`), liens selon la session (`:109`), nom dans l'en-tête (`:118`), restauration du profil (`:132-157`) |
| Connexion | `login-page.spec.ts` : bouton, message du backend, redirection, `aria-pressed`, `aria-describedby`, indicateur de chargement |
| Inscription | `register-page.spec.ts` : validation, longueur du mot de passe, `aria-pressed`, aide liée, `aria-describedby` |
| Profil | `profile-page.spec.ts` : chargement auto, bouton désactivé, initiales, squelette, confirmation |

**Ce que ces tests ne peuvent pas vérifier** (jsdom ne rend ni les couleurs ni les
animations) : le thème sombre, `prefers-reduced-motion`, le visuel du lien
d'évitement au focus, les contrastes, et l'expérience réelle avec un lecteur
d'écran.
