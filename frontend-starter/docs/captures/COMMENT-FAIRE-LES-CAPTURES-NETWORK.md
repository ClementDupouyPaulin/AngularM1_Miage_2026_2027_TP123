# Faire tes captures Network en 10 minutes

Les sujets TP1 à TP3 demandent des **captures de l'onglet Network** des DevTools. Elles doivent
venir de **ton** navigateur : c'est la preuve que *tu* as vu l'application fonctionner. Les
captures d'écran de l'interface générées automatiquement sont dans `film-pulse/` ; elles ne
remplacent pas celles-ci.

## Préparation (une fois)

1. Lance les deux serveurs :
   `cd backend && npm start` puis `cd frontend-starter && npm start`.
2. Ouvre http://localhost:4200 dans **Chrome** (ou Safari avec *Développement → Afficher
   l'inspecteur web*).
3. Ouvre les DevTools (`⌥⌘I`), onglet **Network** (Réseau), filtre **Fetch/XHR**.
4. Coche **Preserve log** pour ne pas perdre les requêtes au changement de page.

## Les captures à faire, et ce qu'on doit y voir

| # | Action dans l'appli | Requête à repérer | Ce que la capture doit montrer |
|---|---|---|---|
| 1 | Mauvais mot de passe à la connexion | `POST /api/auth/login` | statut **401** et le message d'erreur dans l'onglet *Response* |
| 2 | Bonne connexion | `POST /api/auth/login` | statut **200**, le jeton dans *Response* |
| 3 | Page Bandes-son | `GET /api/tracks?page=…&limit=…` | paramètres de **pagination** dans l'URL, en-tête `Authorization: Bearer …` dans *Headers* |
| 4 | Import d'une piste (fichier de `~/Downloads/audio-test/mp3/`) | `POST /api/tracks` | type **multipart/form-data**, statut **201**, barre de progression |
| 5 | Lecture d'une piste | `GET /api/tracks/:id/audio` | l'en-tête `Authorization` est présent (c'est ce que l'intercepteur ajoute ; une balise `<audio src>` ne le ferait pas) |
| 6 | Suppression d'une piste | `DELETE /api/tracks/:id` | statut **204**, puis la liste se rafraîchit |
| 7 | (Film Pulse) Import d'un extrait dans Studio | `POST /api/clips` | multipart avec `video`, `analysis`, `filmstrip` ; statut **201** |
| 8 | (Film Pulse) Ouvrir un extrait d'un autre compte non partagé | `GET /api/clips/:id` | statut **404** `Clip inconnu` (règle d'accès) |

Pour chaque capture : clique sur la requête, garde visibles **l'URL, la méthode, le statut**
et l'onglet utile (*Headers*, *Payload* ou *Response*).

## Où ranger les images

Dans ce dossier (`frontend-starter/docs/captures/`), avec des noms parlants :
`01-login-401.png`, `04-upload-piste-201.png`… Puis, dans `docs/README.md` et
`RAPPORT_IA_MODELE.md`, remplace chaque `[À COMPLÉTER PAR LE BINÔME]` par un lien vers l'image
et une phrase **de toi** : ce que tu y vois et pourquoi c'est correct.

## Si une requête n'apparaît pas

- Vérifie que les DevTools étaient ouverts **avant** l'action (sinon recharge la page).
- Vérifie le filtre : « Fetch/XHR », pas « Doc ».
- Pas de `/api/…` du tout : le serveur backend n'est pas lancé (`curl localhost:3000/api/health`
  doit répondre `{"status":"ok"}`).
