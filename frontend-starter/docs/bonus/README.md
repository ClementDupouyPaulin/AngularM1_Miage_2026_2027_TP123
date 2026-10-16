# Bonus et refonte UI/UX — index

Documentation des fonctionnalités **facultatives** des sujets TP2 et TP3, et de la
refonte d'interface de la coque, de la connexion, de l'inscription et du profil.

Le gel du backend a été levé **pour ces bonus uniquement** (le sujet TP2 prévoit
lui-même de modifier `API_CONTRACT.md` et le frontend pour la pagination
Mongoose). Voir `RAPPORT_IA_MODELE.md`, section « Bonus et refonte UI/UX ».

## Par où commencer

| Vous cherchez… | Document |
|---|---|
| **Un tableau de ce qui est fait, prouvé, et où** | [`matrice-facultatives.md`](./matrice-facultatives.md) |
| Pourquoi `aggregate`, le `$facet`, les nouvelles clés de la réponse, le piège du cast `ObjectId` | [`pagination-mongoose.md`](./pagination-mongoose.md) |
| Le filtre par titre (côté serveur, anti-rebond, échappement des regex) | [`filtre-par-titre.md`](./filtre-par-titre.md) |
| Le `MatPaginator` et ses libellés français | [`materiel-paginator.md`](./materiel-paginator.md) |
| Les tests de contrat du backend, et leurs limites | [`tests-de-contrat-backend.md`](./tests-de-contrat-backend.md) |
| Les vérifications exécutées contre le vrai serveur | [`preuves-integration-reelle.md`](./preuves-integration-reelle.md) |
| ID3, services Web de pochettes, droits d'usage, SSRF, **décision ouverte sur la copie locale** | [`etude-id3-et-services-web.md`](./etude-id3-et-services-web.md) |
| **L'interface des pochettes** : upload + aperçu, affichage, recherche Web, retrait | [`pochettes.md`](./pochettes.md) |
| **Ce que la relecture a trouvé** (6 défauts), ce qu'elle n'a pas trouvé, les limites | [`relecture-independante.md`](./relecture-independante.md) |
| Les choix UI/UX : thème sombre, mouvement réduit, accessibilité des formulaires | [`ui-ux-authentification.md`](./ui-ux-authentification.md) |

## Ce qui reste à faire par le binôme

La documentation est complète pour le périmètre des bonus ; ce qui reste ne peut pas
être écrit par un assistant : captures Network dans le navigateur, vérification
visuelle (clair/sombre, mouvement réduit), vérification au clavier (dont le focus
des dialogues), décision sur les conditions d'Apple, déclaration de ce que chacun
sait expliquer, identité du modèle utilisé. La liste complète figure dans
`RAPPORT_IA_MODELE.md`, section « Bonus et refonte UI/UX ».

## Trois règles valables pour tous ces documents

1. **Réel, simulé, non vérifié : toujours distingués.** Une affirmation est
   étiquetée selon qu'elle a été *observée* contre le vrai serveur, *vérifiée par
   un test* qui simule MongoDB ou le réseau, ou *non vérifiée dans cette
   session*. Le dernier cas est écrit explicitement.
2. **Les preuves en ligne de commande ne sont pas des captures Network.** Les
   captures du navigateur restent à produire par le binôme
   (**[À COMPLÉTER PAR LE BINÔME]**, avec la procédure exacte dans chaque
   document).
3. **Numéros de ligne : vérifiés sur le code figé, pas garantis pour la suite.** Les
   renvois `fichier:ligne` ont été re-contrôlés une fois le code gelé
   (`backend/src/app.js` 885 lignes, `tracks-page.ts` 1039 lignes). Tout changement
   ultérieur les décale ; **le nom de la fonction ou de l'élément, cité à côté,
   fait foi** (`grep -n "nom" backend/src/app.js`).
