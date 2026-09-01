# Conception — Amitié et confidentialité du profil

> **Document de conception du modèle de données.** Complète `spec_amitie_confidentialite.md` (produit) avec les décisions structurelles prises en session le 2026-09-01.
>
> Déclaratif : il décrit **ce que le modèle doit garantir**, pas le SQL — celui-ci sera écrit dans les tickets après inspection du dépôt.

---

## 1. Le changement de modèle

**Avant** : l'accès à un profil était restreint — il fallait avoir joué ensemble. La page était fermée ou ouverte, et son contenu toujours identique.

**Après** : la page est **ouverte à tout utilisateur connecté**. Ce qu'elle contient dépend du réglage du propriétaire et de la relation d'amitié.

|              | Profil **public** | Profil **privé** |
| ------------ | ----------------- | ---------------- |
| **Ami**      | Tout              | Tout             |
| **Non-ami**  | Tout              | Le pseudo seul   |
| **Soi-même** | Tout              | Tout             |

C'est le modèle des réseaux sociaux grand public : n'importe qui peut ouvrir une page, le contenu est ce qui est protégé.

⚠️ **Conséquence assumée** : la règle « avoir joué ensemble » **est supprimée** dans ce chantier. Elle protégeait deux fois la même chose — maintenir une restriction d'accès en plus d'une restriction de contenu, c'est deux règles à tenir cohérentes pour une seule protection.

**Note** : cette suppression rend obsolète l'extension de cette règle aux matchs communs, livrée juste avant. Le travail n'est pas perdu — il a débloqué l'affichage des pseudos à jour dans l'intervalle, et son harnais de tests reste réutilisable — mais sa raison d'être disparaît.

---

## 2. La relation d'amitié

| #      | Décision                                            | Détail                                                                                                                                                                                             |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | **Une ligne par duo, ordre imposé**                 | Les deux identifiants sont rangés dans un ordre déterministe. Il devient **impossible** de créer deux fois la même relation dans les deux sens — la contrainte d'unicité s'en charge, pas le code. |
| **F2** | **Le demandeur est stocké à part**                  | L'ordre imposé fait perdre l'information « qui a demandé » ; elle est donc portée par un champ dédié. Nécessaire pour afficher les demandes reçues et envoyées séparément.                         |
| **F3** | **Deux états : en attente, acceptée**               | Pas d'état « refusée » : le refus supprime la ligne (A5). Une relation existante est soit une demande en cours, soit une amitié.                                                                   |
| **F4** | **Le refus et le retrait suppriment la ligne**      | Aucune trace. On peut redemander immédiatement.                                                                                                                                                    |
| **F5** | **Demandes croisées : la seconde vaut acceptation** | L'ordre imposé fait que la seconde demande retombe sur la ligne existante. Elle ne crée pas de doublon : elle **accepte**. C'est un effet naturel de F1, pas un cas particulier à coder.           |
| **F6** | **Auto-amitié impossible**                          | Une relation lie deux personnes distinctes.                                                                                                                                                        |
| **F7** | **La suppression d'un compte efface ses relations** | Comportement mécanique. Conséquence à connaître : la liste d'amis des autres se réduit sans explication.                                                                                           |
| **F8** | **L'annulation d'une demande envoyée est une action dédiée** | Réservée au demandeur, uniquement tant que la demande est en attente. Supprime la ligne (comme le refus) : aucune trace, redemander fonctionne. Distincte du retrait — les droits diffèrent (le retrait est ouvert aux deux parties d'une amitié acceptée, l'annulation au seul demandeur d'une demande en attente). |

**Actions** : demander, accepter, refuser, annuler, retirer. Chacune n'est permise qu'à la bonne personne — on n'accepte que ce qui nous est adressé, on n'annule que sa propre demande, on ne demande pas au nom d'un autre.

---

## 3. Le réglage de confidentialité

| #      | Décision                              | Détail                                                                         |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| **P1** | **Deux valeurs : public ou privé**    | Porté par le profil.                                                           |
| **P2** | **Public par défaut**                 | Un nouveau compte est visible. Le privé est un choix délibéré.                 |
| **P3** | **Réglable depuis la page de compte** | Avec les autres paramètres de l'utilisateur, pas sur la page de profil.        |
| **P4** | **Changement expliqué**               | Le basculement s'accompagne d'une explication de ce qu'il change concrètement. |

---

## 4. Ce que le modèle doit garantir

### 4.1 La relation

- Un duo ne peut avoir **qu'une seule relation**, quel que soit le sens dans lequel elle est créée. Garanti par la structure, pas par une vérification applicative.
- Chaque action n'est permise qu'à la personne concernée : accepter ou refuser une demande qui nous est adressée, annuler une demande qu'on a soi-même envoyée, retirer une amitié dont on fait partie.
- Une personne ne voit **que ses propres relations** — jamais celles des autres.

### 4.2 Le filtrage du contenu

⚠️ **C'est le point le plus important de ce document.**

Le filtrage se fait **en base**, jamais dans l'interface. Un profil privé consulté par un non-ami ne doit **rien renvoyer** au-delà du pseudo — pas renvoyer les données en laissant l'interface les masquer.

Sinon la confidentialité serait apparente : les données transiteraient par le réseau et resteraient lisibles dans les outils du navigateur.

La fonction de profil doit donc, pour chaque appel, déterminer le droit de l'appelant et **composer sa réponse en conséquence**.

### 4.3 La règle qui décide

Une seule règle, exprimée à un seul endroit : **le contenu complet est visible si le profil est public, si l'appelant est ami, ou si l'appelant est le propriétaire.**

Elle doit être réutilisable — la même question se posera pour d'autres écrans.

### 4.4 L'aperçu extérieur

Le propriétaire dispose d'un moyen de voir son profil **tel qu'un non-ami le verrait**. C'est une bascule d'affichage : rien ne change en base, on demande simplement la vue restreinte.

---

## 5. L'interface

- **Écran de gestion des amis** : liste des amis, demandes reçues, demandes envoyées, et **un champ de recherche intégré** pour ajouter quelqu'un. Accessible depuis la page de compte. La recherche est le seul point d'entrée d'une relation — sans elle, aucune première demande n'est possible.
- **Un compteur sur l'entrée « Amis »** de la page de compte signale les demandes en attente. Pas de mécanisme d'alerte dédié : un simple nombre à côté du libellé, que la future section notifications ne rendra pas obsolète.
- **Depuis un profil** : le statut d'amitié est visible et la demande peut partir de là.
- **Sur la page de compte** : le réglage de confidentialité, avec son explication.
- **Un profil privé vu par un non-ami** doit rester une page **lisible** : on comprend de qui il s'agit et pourquoi le contenu est masqué — pas une page vide.

---

## 6. Risques et points ouverts

**R4 — Insistance possible.** Sans blocage et avec un refus qui autorise à redemander, rien n'empêche de solliciter indéfiniment. Assumé, à re-trancher à l'ouverture publique.

**R5 — Exposition des tierces personnes** : le journal d'un profil public nomme ses partenaires, qui n'ont pas été consultés. Assumé (spec §4), à re-trancher à l'ouverture publique.

**O1 — La découverte des profils.** L'accès devient libre, mais il n'existe **aucun annuaire** : on arrive sur un profil par un tournoi, un match ou un lien direct. Ouvrir l'accès rend les profils _ouvrables_, pas _trouvables_. Une recherche d'utilisateurs sera peut-être souhaitable — hors périmètre.

**R3 (rappel)** — l'enrôlement sans consentement reste possible. L'amitié fournit le matériau pour le fermer, mais la restriction n'est pas dans ce chantier.

---

## 7. Découpage prévu

1. **Base — la relation d'amitié** : structure, contrainte d'unicité par duo, actions et leurs droits.
2. **Base — la confidentialité** : réglage sur le profil, règle de visibilité du contenu, filtrage dans la fonction de profil, **suppression de l'ancienne règle d'accès**.
3. **Interface — les amis** : écran de gestion, indicateur de demandes, statut et demande depuis un profil.
4. **Interface — la confidentialité** : réglage sur la page de compte avec son explication, aperçu extérieur.

**Dette documentaire à corriger** : `CLAUDE.md` affirme encore que les profils sont tous publics entre utilisateurs authentifiés. Faux depuis longtemps, et franchement trompeur après ce chantier.
