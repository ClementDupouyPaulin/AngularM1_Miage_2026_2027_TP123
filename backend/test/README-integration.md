# Test d'intégration MongoDB

`integration-mongo.test.js` exécute l'API réelle (Express + Mongoose) contre un **vrai `mongod` éphémère** démarré en mémoire par `mongodb-memory-server`. Les autres tests utilisent `fake-mongo.js`, une simulation : ce test vérifie que les requêtes, agrégations, index uniques et opérateurs (`$push`, `$pull`, `$unwind`, pagination...) se comportent aussi sur le vrai moteur.

Parcours couvert : inscription/connexion, création de clip, liste paginée, règle d'accès (404), invitation et acceptation d'ami, partage `shared`, retrait d'ami, annotations, suppression, statistiques, étiquettes, `discover`, activité.

## Lancer

```bash
npm run test:integration
```

Le premier lancement télécharge le binaire `mongod` (mis en cache ensuite). Aucune connexion à Atlas : la base est locale et détruite à la fin.

`npm test` ignore ce fichier (tests marqués « ignorés » avec un message) tant que `MONGO_INTEGRATION=1` n'est pas défini. Si le binaire ne peut pas être téléchargé, les tests sont aussi ignorés avec la cause affichée, sans échec.
