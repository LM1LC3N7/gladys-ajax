# Ajax Systems (SIA DC-09)

Cette intégration amène une alarme **Ajax Systems** (Hub, Hub Plus, Hub 2,
Hub 2 Plus, Hub 2 (4G), Hub Hybrid…) dans Gladys **en local** : Gladys joue
le rôle de **centre de télésurveillance** de votre centrale. La centrale
envoie ses événements directement à Gladys en **SIA DC-09**, le protocole des
centres de télésurveillance, sur votre réseau : pas de cloud Ajax, pas de
compte, pas de clé d'API. Vous obtenez l'état d'armement, les alarmes en
cours, les défauts, la supervision de la centrale, le dernier événement et
des déclencheurs de scène. Non officiel, sans lien avec Ajax Systems.

> **Version de développement (0.1).** Construite d'après les récepteurs SIA
> DC-09 utilisés avec de vraies centrales Ajax (la bibliothèque Home
> Assistant pysiaalarm et le plugin Homebridge homebridge-ajax-sia) et la
> table des codes SIA d'Ajax, et testée avec un simulateur de transmetteur SIA
> (messages en clair et chiffrés), pas encore avec une vraie centrale. Vos
> retours sont les bienvenus sur le dépôt GitHub.

**SIA ne fait que remonter des informations.** La centrale parle, Gladys
écoute : armer ou désarmer l'alarme depuis Gladys n'est pas possible avec ce
protocole. Pilotez-la avec l'application Ajax, les télécommandes ou les
claviers ; Gladys suit ce qui se passe.

## Quelle intégration pour quelle alarme ?

| Votre alarme                                                                                       | Intégration Gladys                                    |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Ajax Systems                                                                                       | **celle-ci**                                          |
| Une autre centrale capable de transmettre à une télésurveillance en SIA DC-09 (SIA-DCS ou ADM-CID) | celle-ci peut fonctionner (voir « Autres centrales ») |
| Somfy Protexial / Protexiom, Somfy Protect, Verisure, Diagral, SimpliSafe, Ring…                   | leurs propres intégrations du store Gladys            |

Le cœur de Gladys n'a pas d'intégration Ajax ni SIA DC-09.

## Prérequis

- Une centrale Ajax en **OS Malevich 2.7 ou plus récent** (transmission SIA
  DC-09 directe, sans Ajax Translator).
- Un compte **administrateur** de l'espace dans l'application Ajax (ou un
  compte PRO avec les droits de configuration du système).
- Gladys **5.1 ou plus récent**, installé sur une machine que la centrale
  peut joindre sur votre réseau (c'est la centrale qui se connecte à Gladys,
  pas l'inverse).
- Le **réglage « centre de télésurveillance » de la centrale doit être
  libre**. Si une société surveille votre alarme, ce réglage est le sien :
  demandez-lui avant d'y toucher.

## Fonctionnement

```
Centrale Ajax ──(SIA DC-09, TCP, AES en option)──▶ conteneur sia-receiver ──▶ intégration Gladys ──▶ appareils, scènes
 (Ethernet / Wi-Fi)                                  port affiché dans Gladys   (états déduits des événements)
```

L'intégration fait tourner deux conteneurs : l'intégration elle-même, et un
petit conteneur **`sia-receiver`** qui ouvre un port sur votre réseau (un
conteneur d'intégration ne le peut pas). La centrale envoie chaque événement
à ce port ; le récepteur le vérifie (CRC, compte, chiffrement, horloge) et
l'acquitte aussitôt, puis le passe à l'intégration. Si l'intégration
redémarre, le récepteur garde les 500 derniers messages et les lui remet à
son retour.

## Installation

1. Installez l'intégration depuis le store Gladys.
2. Dans son onglet **Configuration**, saisissez le ou les **numéros de
   compte** (voir plus bas) et, si vous l'utilisez, la **clé de
   chiffrement**, puis enregistrez. Le récepteur démarre et Gladys affiche,
   dans la section « Réglages à saisir dans l'application Ajax », l'**adresse
   et le port** à donner à la centrale (rechargez la page si le port
   s'affiche encore `{{port:sia}}`).
3. Dans l'application Ajax, réglez le centre de télésurveillance (section
   suivante).
4. Dans l'onglet **Découverte**, ajoutez l'appareil **Alarme Ajax 1234**.
5. Cliquez sur **Afficher l'état du récepteur** : il dit si la centrale
   transmet et montre le dernier message refusé, s'il y en a un.

## Réglages dans l'application Ajax

Ouvrez les **paramètres de l'espace** (roue dentée) → **Sociétés de
sécurité** → **Centre de télésurveillance** (les noms varient un peu selon les
versions de l'application ; ce n'est pas le formulaire « Inviter une société
de sécurité »). Puis :

| Réglage de l'application Ajax                                    | Valeur                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Protocole                                                        | **SIA DC-09 (SIA-DCS)**                                                                                                                    |
| Adresse IP principale                                            | l'**adresse réseau local** de la machine de Gladys (donnez-lui une adresse fixe ou une réservation DHCP)                                   |
| Port                                                             | le **port TCP** affiché dans la configuration Gladys (« Réglages à saisir dans l'application Ajax »)                                       |
| Numéro d'objet                                                   | **3 à 16 caractères hexadécimaux** au choix (chiffres et A à F), par exemple `1234` : le même numéro dans Gladys (« Numéro(s) de compte ») |
| Chiffrement                                                      | **activé**, conseillé : une clé de **16 caractères** (ou 32 caractères hexadécimaux) ; la même clé dans Gladys                             |
| Intervalle du test périodique                                    | **activé, toutes les minutes**, et le même intervalle dans Gladys : c'est ainsi que Gladys sait que la centrale est toujours là            |
| Connexion à la demande                                           | désactivée (la centrale garde sa connexion ouverte : le plus rapide)                                                                       |
| Canaux                                                           | gardez **Ethernet** et **Wi-Fi** ; un canal cellulaire ne peut pas joindre votre réseau privé : désactivez-le pour cette connexion         |
| Une adresse IP pour tous les canaux d'alarme (OS Malevich 2.16+) | activé, sauf si vous voulez des adresses différentes par canal                                                                             |

À propos de l'adresse : la section « Réglages à saisir dans l'application
Ajax » affiche le nom avec lequel votre navigateur joint Gladys
(`{{gladys_host}}`). La centrale a besoin de l'**adresse IP sur votre réseau
local** : si vous passez par Gladys Plus ou un reverse proxy, ce nom n'est
pas le bon ; utilisez l'IP locale de la machine.

## Configuration

| Champ                                | Description                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numéro(s) de compte (numéro d'objet) | le numéro d'objet réglé sur la centrale. Plusieurs centrales : séparez leurs numéros par des virgules (un appareil par centrale). Une centrale qui transmet avec un numéro absent de la liste est refusée, et les journaux le disent. |
| Clé de chiffrement                   | la clé réglée sur la centrale, commune à tous les comptes. Vide : pas de chiffrement. Avec une clé, les messages non chiffrés sont refusés.                                                                                           |
| Format de la clé                     | automatique : 32 caractères hexadécimaux sont lus en hexadécimal (clé « HEX » d'Ajax), 16 caractères comme du texte (clé « ASCII » d'Ajax). Choisissez « Texte » pour une clé texte de 32 caractères faite de chiffres hexadécimaux.  |
| Intervalle du test périodique        | l'intervalle réglé dans l'application Ajax, en minutes. La centrale est montrée **muette** après deux tests manqués (plus 30 s). 0 : pas de supervision.                                                                              |
| Décalage d'horloge toléré            | 60 s par défaut. Un message dont l'heure s'écarte plus de l'horloge de Gladys est refusé (protection contre les messages rejoués) ; la centrale règle alors son horloge et le renvoie. 0 : pas de contrôle.                           |
| Langue                               | français ou anglais, pour les noms des appareils ajoutés ensuite et le texte du dernier événement.                                                                                                                                    |

## Ce que vous obtenez

Un appareil par compte, **Alarme Ajax 1234**, toutes les fonctionnalités en
lecture seule :

| Fonctionnalité          | Valeurs                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Mode                    | `disarmed` (désarmée), `armed` (armée), `night` (mode nuit), `partial` (des groupes Ajax armés)                           |
| Alarme en cours         | 1 pendant une alarme (intrusion, incendie, chaleur, gaz, fuite d'eau, panique, urgence médicale, contrainte, code deviné) |
| Autoprotection          | 1 quand un appareil ou la centrale est ouvert (ou un détecteur masqué)                                                    |
| Pile ou batterie faible | 1 quand la pile d'un appareil est faible, ou la batterie de la centrale faible ou absente                                 |
| Alimentation secteur    | 0 quand la centrale (ou un prolongateur de portée, ou l'alimentation externe d'un appareil) a perdu le courant            |
| Liaison des détecteurs  | 0 quand un appareil a perdu la liaison avec la centrale, ou en cas de brouillage radio                                    |
| Centrale joignable      | 1 tant que la centrale envoie ses tests périodiques, 0 une fois muette                                                    |
| Groupes armés           | les numéros des groupes armés (`1, 3`), `tous` ou `aucun`                                                                 |
| Dernier événement       | par exemple « Intrusion, appareil 3, groupe 1 (BA) » ou « Armée, utilisateur 2 (CL) »                                     |

- Le **numéro d'appareil** est celui affiché en bas de la page d'un appareil
  dans l'application Ajax (« Appareil 3 ») ; 0 désigne la centrale elle-même.
  La centrale envoie ce numéro avec chaque événement, pas le nom de
  l'appareil.
- **Alarmes** : une intrusion détectée alors que l'alarme est armée reste
  « en cours » jusqu'au **désarmement** (une porte refermée n'y met pas fin).
  Incendie, chaleur, gaz et fuite d'eau prennent fin quand le détecteur
  signale le retour à la normale. Panique et urgence médicale prennent fin
  à l'annulation ou au désarmement suivant.
- **Contrainte** : un désarmement avec le code de contrainte Ajax est
  remonté comme un désarmement **et** une alarme de contrainte (silencieuse
  pour l'intrus, visible dans Gladys).
- **État déduit des événements** : SIA ne remonte que les changements. L'état
  est enregistré et conservé aux redémarrages, mais un changement survenu
  pendant que le récepteur ne tournait pas n'est vu qu'au prochain événement
  du même type. Le bouton **Effacer la mémoire des alarmes et défauts**
  remet à zéro les alarmes et défauts (pas le mode).
- **Les détecteurs ne transmettent que quand l'alarme est armée**, sauf s'ils
  sont réglés « toujours actifs » dans l'application Ajax ; en mode nuit,
  chaque détecteur suit son propre réglage.
- **Indisponible en SIA** : noms des appareils, photos (MotionCam),
  températures, niveaux de batterie, commande des sirènes et relais. Seuls des
  codes d'événement sont transmis.

## Scènes

Cinq déclencheurs, chacun avec un filtre **centrale** facultatif :

| Déclencheur                        | Quand                                                                                                                | Filtre              | Variables                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| **Alarme Ajax**                    | une nouvelle alarme (intrusion, incendie, chaleur, gaz, eau, panique, médicale, contrainte, code deviné, gel)        | type                | compte, type, code, numéro d'appareil (zone), groupe, utilisateur, mode, description |
| **Armement Ajax changé**           | le mode a changé (télécommande, clavier, application, programmation)                                                 | nouveau mode        | compte, mode, mode précédent, code, utilisateur, groupe, description                 |
| **Défaut Ajax**                    | un nouveau défaut (autoprotection, batterie, alimentation, liaison, autre) ou la centrale devenue muette (`offline`) | type                | compte, type, code, zone, description                                                |
| **Fin d'alarme ou de défaut Ajax** | une alarme ou un défaut a pris fin (code de rétablissement, désarmement, ou la centrale qui transmet à nouveau)      | type                | compte, type, code, zone, description                                                |
| **Tout événement Ajax**            | chaque événement (sauf les tests périodiques)                                                                        | code SIA (ex. `BA`) | compte, code, zone, utilisateur, groupe, texte, description                          |

Idées : envoyer une notification avec la description d'une alarme ; faire
suivre le mode d'alarme de la maison Gladys avec le déclencheur « Armement
Ajax changé » et l'action « Changer le mode d'alarme » ; allumer les lumières
quand l'alarme se déclenche ; prévenir quand la centrale est muette ou a
perdu le secteur.

Les messages gardés par le récepteur pendant un redémarrage de l'intégration
mettent à jour les états, mais ne lancent pas de scène s'ils ont plus de
5 minutes.

## Codes SIA compris

| Codes                                               | Signification                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `CL` `CA` `CF` `AF` `CQ` `CS`                       | armée (le numéro est l'utilisateur)                                            |
| `CG` `CB` / `OG` `OB`                               | groupe armé / désarmé (le groupe est `ri`)                                     |
| `NL` `NF` `NC` `NB` / `NP` `NO` `ND`                | mode nuit activé / désactivé (`ND` : sous contrainte)                          |
| `OP` `OA` `OQ` `OR` `OS`                            | désarmée                                                                       |
| `HA`                                                | désarmée avec le code de contrainte (Ajax)                                     |
| `BA` `BV`, `FA`, `KA`, `GA`, `WA`, `PA`, `MA`, `JA` | alarmes : intrusion, incendie, chaleur, gaz (CO), eau, panique, médicale, code |
| `BR` `BH`, `FH`, `KH`, `GH`, `WH`, `PH`, `MR`       | les rétablissements correspondants                                             |
| `TA` / `TR`                                         | autoprotection / rétablie                                                      |
| `XT` `YT` `YM` / `XR` `YR` `YA`                     | pile ou batterie faible ou absente / rétablie                                  |
| `AT` `YP` / `AR` `YQ`                               | coupure / retour de l'alimentation                                             |
| `XL` `PF` `XQ` `YC` / `XC` `PO` `XH` `YK`           | liaison perdue, brouillage / rétablis                                          |
| `RP`, messages `NULL`                               | test périodique (supervision seulement)                                        |

Tout autre code est quand même acquitté, affiché comme dernier événement et
envoyé au déclencheur « Tout événement Ajax », décrit avec la table des codes
SIA.

## Autres centrales

Toute centrale qui transmet à un centre de télésurveillance en **SIA DC-09**
au format **SIA-DCS** ou **ADM-CID** (Contact ID) peut fonctionner : TCP ou
UDP (le port UDP est aussi affiché dans la configuration), chiffrement
AES-128, -192 ou -256. La correspondance des armements et alarmes suit la
table Ajax : certains codes ont un sens un peu différent chez d'autres
marques (`HA` est une alarme hold-up dans la norme SIA, un désarmement sous
contrainte chez Ajax). Vos retours sont les bienvenus.

## Sécurité

Le port du récepteur est ouvert sur votre réseau local, comme celui de tout
récepteur de télésurveillance. Sans chiffrement, n'importe qui sur le réseau
pourrait envoyer un faux événement : **activez le chiffrement**, qui fait
aussi refuser les messages non chiffrés, et gardez le contrôle d'horloge (les
messages rejoués sont refusés). Le conteneur récepteur n'a aucun accès à
Gladys : il passe seulement les messages à l'intégration sur un réseau
privé. Sur ce lien interne, le secret partagé ne circule jamais : chaque côté
prouve qu'il le connaît (défi-réponse HMAC-SHA256 avec des valeurs aléatoires
neuves à chaque connexion), et chaque message porte ensuite une signature
HMAC et un numéro d'ordre. Un faux récepteur, ou un événement injecté, modifié
ou rejoué sur ce réseau privé, est refusé. Le contenu des messages n'y est pas
caché pour autant : la protection porte sur l'authenticité et l'intégrité. La clé est stockée comme secret dans Gladys et n'apparaît jamais dans
les journaux.

## Dépannage

- **« En attente du premier message de la centrale … »** : la centrale n'a
  pas encore joint Gladys. Vérifiez l'adresse IP et le port dans
  l'application Ajax, que le centre de télésurveillance est activé sur un
  canal qui joint votre réseau, et qu'aucun pare-feu ne bloque le port sur la
  machine de Gladys.
- **« Unknown account … »** (bouton d'état, journaux) : le numéro d'objet
  réglé sur la centrale n'est pas dans « Numéro(s) de compte ».
- **« Decryption failed (wrong key?) »**, **« no encryption key is
  configured »** ou **« Unencrypted message … refused »** : la clé ou
  l'activation du chiffrement diffère entre la centrale et Gladys.
- **« timestamp … off »** : l'horloge de la centrale ou de la machine de
  Gladys est fausse ; la centrale renvoie après avoir réglé son horloge.
  Mettez le décalage toléré à 0 pour ne plus contrôler.
- **« Aucun message de la centrale … dans l'intervalle du test
  périodique »** : le test périodique est désactivé ou réglé plus long dans
  l'application Ajax, ou la centrale a perdu son réseau.
- Les journaux de l'intégration (et ceux du conteneur `sia-receiver`)
  détaillent chaque message reçu et chaque refus ; la clé n'y figure jamais.

## Confidentialité

Tout reste sur votre réseau local : la centrale envoie ses événements à
Gladys seulement. Le numéro de compte et la clé restent dans Gladys (la clé
comme secret, jamais renvoyée au navigateur). Ajax et Ajax Systems sont des
marques d'Ajax Systems ; cette intégration est sans lien avec Ajax Systems.
