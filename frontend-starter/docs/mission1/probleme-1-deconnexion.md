# Problème 1 — Aucune déconnexion accessible depuis l'interface

## Constat

`AuthService.logout()` existe et fait le nécessaire (efface le token du
`localStorage`, remet `token` et `currentUser` à `null`), mais rien dans
l'interface ne l'appelle. Le header (`app.html`) affiche uniquement
"Backing tracks", "Profil" et "Connexion" — jamais de bouton de déconnexion.

## Fichiers concernés

- `src/app/components/app/app.ts`
- `src/app/components/app/app.html`
- `src/app/shared/services/auth.service.ts` (méthode `logout()`, déjà correcte)

## Pourquoi c'est un problème

Un utilisateur connecté n'a aucun moyen, depuis l'UI, de clore sa session sur
la machine (poste partagé, fin de démo...). Le token reste indéfiniment dans
`localStorage` tant que le navigateur n'est pas vidé manuellement.

## Solution implémentée

- `AppComponent` injecte `AuthService` (`readonly auth = inject(AuthService)`).
- Dans `app.html`, un bouton `data-testid="logout-button"` n'apparaît que si
  `auth.token()` est non nul (`@if` / `@else`), et déclenche `logout()` sur le
  composant, qui appelle `auth.logout()` puis navigue vers `/login`.

## Critères d'acceptation (traduits en tests)

1. Quand `auth.token()` est `null`, aucun élément `[data-testid="logout-button"]`
   n'est présent dans le DOM.
2. Quand `auth.token()` a une valeur, l'élément `[data-testid="logout-button"]`
   est présent.
3. Un clic sur ce bouton appelle `AuthService.logout()`.
4. Après le clic, l'application navigue vers `/login`.

## Statut

✅ Implémenté et vérifié — `src/app/components/app/app.spec.ts` : 4/4 tests
verts.
