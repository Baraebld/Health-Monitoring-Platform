# 🍓 Manuel de Déploiement Raspberry Pi & Intégration Matérielle Modem GSM/LTE
## Passerelle Edge Autonome pour la Plateforme de Télésurveillance Médicale IoMT

---

## 1. Vue d'Ensemble & Objectifs

La passerelle **Edge Gateway** implémente une surveillance clinique en bordure de réseau (*Edge Computing*), capable de :
1. **Traiter et valider** les constantes physiologiques émises par les capteurs médicaux sans dépendre du Cloud.
2. **Détecter les anomalies critiques** (tachycardie, bradycardie, hypoxie, hypertension, hypotension) et la perte de signal capteur.
3. **Initier immédiatement un SMS d'alerte direct** au médecin de garde via un modem cellulaire GSM/LTE (commandes Hayes AT), sans aucune connexion Internet ni passage par le backend central.
4. **Persister localement** dans une base ACID SQLite (mode WAL) l'ensemble des mesures, alertes et traces d'audit d'envoi SMS.
5. **Se synchroniser de manière idempotente** avec le backend central dès le rétablissement de la connectivité réseau.

---

## 2. Spécifications & Prérequis Matériels

### Matériel Recommandé :
| Composant | Modèle conseillé | Rôle |
| :--- | :--- | :--- |
| **Micro-ordinateur monocarte (SBC)** | **Raspberry Pi 4B** (2 Go ou 4 Go) ou **Raspberry Pi 5** (compatible RPi 3B+) | Unité de calcul Edge hébergeant le service autonome |
| **Alimentation** | USB-C Officielle 5V / 3A (RPi 4) ou 5V / 5A (RPi 5) | Évite les chutes de tension (*under-voltage*) lors des pointes d'émission radio du modem |
| **Stockage** | Carte MicroSD Classe A2 32 Go ou SSD NVMe / USB | Stockage du système d'exploitation et de la base SQLite locale |
| **Modem Cellulaire GSM/4G** | **Quectel EC25-E (USB / mini-PCIe)** ou **Huawei E3372-325** ou **SIMCom SIM7600E** | Émission autonome des SMS par commandes AT série |
| **Carte SIM** | Micro/Nano SIM M2M ou forfait voix/SMS standard | Fournit l'accès au réseau cellulaire de l'opérateur (sans code PIN ou déverrouillé) |
| **Antenne Cellulaire** | Antenne SMA ou adhésive multibande 4G/LTE (gain $\ge 3\text{ dBi}$) | Assure une réception optimale du signal dans les environnements fermés |

---

## 3. Préparation du Système d'Exploitation (Raspberry Pi OS)

1. Flasher **Raspberry Pi OS Lite (64-bit)** (Debian Bookworm) sur la carte MicroSD via *Raspberry Pi Imager*.
2. Activer SSH et configurer le réseau local.
3. Se connecter en SSH au Raspberry Pi et mettre à jour le système :
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
4. Installer Node.js 22 LTS (qui intègre nativement `node:sqlite`) :
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs git
   node -v  # Doit afficher v22.x ou supérieur
   ```

---

## 4. Raccordement & Configuration du Modem Cellulaire

### 4.1. Branchement Physique
- Insérez la carte SIM dans le modem (veillez à désactiver au préalable la demande de code PIN de la SIM à l'aide d'un smartphone, ou configurez le script pour saisir `AT+CPIN="0000"`).
- Branchez le modem sur l'un des ports **USB 3.0 (bleus)** du Raspberry Pi.

### 4.2. Identification du Port Série
1. Vérifiez que le modem est reconnu sur le bus USB :
   ```bash
   lsusb
   ```
   *(Vous devez voir par exemple `Quectel Wireless Solutions Co., Ltd.` ou `Huawei Technologies Co., Ltd.`)*

2. Identifiez le port série de communication :
   ```bash
   dmesg | grep tty
   ```
   Généralement, le modem expose `/dev/ttyUSB0` (port principal de commande AT) et `/dev/ttyUSB2` (port de données).

3. Autorisez l'utilisateur système à accéder aux ports séries :
   ```bash
   sudo usermod -a -G dialout $USER
   # Déconnectez-vous puis reconnectez-vous pour appliquer les droits
   ```

### 4.3. Test Manuel des Commandes AT avec `minicom`
Installez un émulateur de terminal série :
```bash
sudo apt install -y minicom
minicom -D /dev/ttyUSB0 -b 115200
```
Dans `minicom`, testez successivement :
- `AT` ➔ Doit répondre `OK` (Le modem répond).
- `AT+CPIN?` ➔ Doit répondre `+CPIN: READY` (La carte SIM est active et déverrouillée).
- `AT+CSQ` ➔ Renvoie la qualité du signal (ex: `+CSQ: 24,99` où 24/31 est un bon signal).
- `AT+CREG?` ➔ Vérifie l'enregistrement réseau (`+CREG: 0,1` = enregistré sur le réseau local).
- Quittez minicom avec `Ctrl+A` puis `X`.

---

## 5. Déploiement du Service `edge-gateway` sur Raspberry Pi

### 5.1. Cloner ou Copier le Dossier `edge-gateway`
```bash
cd /opt
sudo git clone https://github.com/Baraebld/Health-Monitoring-Platform.git
cd Health-Monitoring-Platform/edge-gateway
npm install
```

### 5.2. Fichier de Configuration `.env`
Créez le fichier de configuration de production :
```bash
nano .env
```
Renseignez les variables matérielles :
```ini
# Identité de la passerelle
EDGE_GATEWAY_ID=rpi_hopital_chambre_204
EDGE_PORT=3001

# Base de données SQLite locale persistante
EDGE_DB_PATH=/opt/Health-Monitoring-Platform/edge-gateway/data/edge_storage.db

# Configuration du Modem Matériel Réel
SMS_TRANSPORT=modem
MODEM_SERIAL_PORT=/dev/ttyUSB0
MODEM_BAUD_RATE=115200

# Téléphone d'urgence du médecin référent (Format international E.164)
DOCTOR_PHONE_NUMBER=+33612345678

# Politique de résilience SMS
SMS_MAX_RETRIES=3
SMS_BACKOFF_MS=2000
SMS_DEBOUNCE_MS=300000

# Backend Cloud central (pour synchronisation en ligne)
CENTRAL_BACKEND_URL=http://votre-serveur-cloud:3000
EDGE_SYNC_API_KEY=edge_secret_token_pfe_2026
SYNC_INTERVAL_MS=15000
```

### 5.3. Configuration en Service Système `systemd` (Démarrage Automatique)
Pour que la passerelle redémarre automatiquement après une coupure de courant :
```bash
sudo nano /etc/systemd/system/edge-gateway.service
```
Collez le contenu suivant :
```ini
[Unit]
Description=IoMT Autonomous Edge Gateway Service
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/Health-Monitoring-Platform/edge-gateway
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=edge-gateway

[Install]
WantedBy=multi-user.target
```

Activez et démarrez le service :
```bash
sudo systemctl daemon-reload
sudo systemctl enable edge-gateway
sudo systemctl start edge-gateway
sudo systemctl status edge-gateway
```

Visualisez les logs en temps réel :
```bash
journalctl -u edge-gateway -f
```

---

## 6. Exécution des Tests Automatisés & Démonstration

### Lancer la suite de 9 tests automatisés :
```bash
npm test
```
*Vérifie la détection autonome, l'absence d'appels Cloud, la persistance SQLite, la déduplication anti-spam, le backoff et l'idempotence.*

### Lancer la démonstration du scénario hors-ligne complet :
```bash
npm run demo
```

---

## 7. Matrice de Gestion des Pannes (*Failure Handling*)

| Type de Panne | Comportement de la Passerelle Edge | Statut Persisté | Action de Récupération |
| :--- | :--- | :--- | :--- |
| **Coupure Internet / WiFi** | Détection 100% opérationnelle. Notification SMS déclenchée immédiatement. | `is_synced: 0` | Les événements sont accumulés dans SQLite et synchronisés dès le retour du réseau. |
| **Crash ou arrêt du Backend Cloud** | La passerelle continue d'ingérer, d'évaluer et de notifier par SMS sans interruption. | `backendOnline: false` | Reconnexion automatique avec reprise idempotente via le `SyncAgent`. |
| **Perte de signal cellulaire (Pas d'antenne)** | Échec de l'émission SMS après 3 tentatives avec backoff exponentiel. | `delivery_status: 'failed'` | L'alerte est conservée localement avec la trace d'échec d'audit détaillée. |
| **Modem débranché / Erreur SIM** | Détection immédiate du port absent. Diagnostic consigné dans le journal SQLite. | `delivery_status: 'failed'` | Reconnexion du modem détectée au prochain cycle. |
| **Anomalies physiologiques répétées** | Maintien de la surveillance mais blocage des SMS redondants (Anti-Spam 5 minutes). | `delivery_status: 'debounced'` | Évite la saturation et la fatigue d'alerte du médecin de garde. |
| **Déconnexion d'un capteur médical** | Détection après silence $> 20$ secondes. Alerte émise avec sévérité `warning`. | `detection_method: 'sensor_health_monitor'` | Traité de manière distincte d'une urgence médicale cardiaque. |
| **Coupure de courant (Power Loss)** | SQLite en mode WAL garantit l'intégrité des écritures. | Reprise automatique | `systemd` relance la passerelle dès le retour de l'alimentation. |
