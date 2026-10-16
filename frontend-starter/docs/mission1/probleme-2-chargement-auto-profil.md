# Problème 2 — Le profil ne se charge pas automatiquement

## Constat

`currentUser` est un Signal **en mémoire**, alors que `token` est réhydraté
depuis `localStorage` au démarrage de l'app. Si l'utilisateur arrive sur
`/profile` avec un token valide (ex. après un rafraîchissement de page), rien
ne s'affiche tant qu'il n'a pas cliqué manuellement sur "Charger mon profil" :
`ProfilePageComponent` n'a pas de hook d'initialisation, `load()` n'est
déclenché que par `(click)` dans le template.

## Fichiers concernés

- `src/app/components/profile-page/profile-page.ts`
- `src/app/components/profile-page/profile-page.html`

## Pourquoi c'est un problème

Le sujet demande explicitement le "chargement de `/api/users/me` lorsque le
profil est demandé". Naviguer vers `/profile` doit suffire à déclencher le
chargement, sans étape manuelle supplémentaire — surtout que `authGuard` a
déjà laissé passer l'utilisateur car il a un token, donc l'appel API peut se
faire dès l'arrivée sur la page.

## Solution implémentée

- `ProfilePageComponent implements OnInit` et appelle `this.load()` dans
  `ngOnInit()`.
- Le bouton "Charger mon profil" a été conservé pour permettre un
  rechargement manuel explicite (ex. après une modification côté serveur).

## Critères d'acceptation (traduits en tests)

1. À l'initialisation du composant (`ngOnInit`, déclenché par
   `fixture.detectChanges()`), `AuthService.profile()` est appelé
   automatiquement, sans action de l'utilisateur.

## Statut

✅ Implémenté et vérifié — `src/app/components/profile-page/profile-page.spec.ts` :
1/1 test vert.
