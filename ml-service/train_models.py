import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib
import os

# 1. Définir où sauvegarder le modèle
MODEL_DIR = 'models'
MODEL_PATH = os.path.join(MODEL_DIR, 'isolation_forest_v1.pkl')
os.makedirs(MODEL_DIR, exist_ok=True) # Crée le dossier si besoin

# 2. Générer des données d'entraînement SIMULÉES
#    Dans un vrai projet, tu chargerais des données réelles !
print("Génération de données simulées...")
n_samples = 1000
# Données normales (3 features: heartRate, spo2, systolic)
normal_hr = np.random.normal(75, 10, n_samples)
normal_spo2 = np.random.normal(98, 1, n_samples)
normal_sys = np.random.normal(120, 15, n_samples)

# Quelques anomalies simulées (ex: tachycardie ou hypoxie)
anomaly_hr = np.random.normal(160, 5, int(n_samples * 0.05)) # 5% anomalies HR
anomaly_spo2 = np.random.normal(98, 1, int(n_samples * 0.05))
anomaly_sys = np.random.normal(130, 10, int(n_samples * 0.05))

anomaly_hr2 = np.random.normal(75, 10, int(n_samples * 0.05)) # 5% anomalies SpO2
anomaly_spo2_2 = np.random.normal(88, 2, int(n_samples * 0.05))
anomaly_sys2 = np.random.normal(120, 15, int(n_samples * 0.05))

# Combiner les données
X_train_normal = np.column_stack((normal_hr, normal_spo2, normal_sys))
X_train_anomaly = np.column_stack((anomaly_hr, anomaly_spo2, anomaly_sys))
X_train_anomaly2 = np.column_stack((anomaly_hr2, anomaly_spo2_2, anomaly_sys2))

# On n'entraîne l'Isolation Forest que sur les données normales !
# (Certaines implémentations permettent un peu de bruit, mais c'est plus simple comme ça)
X_train = X_train_normal

print(f"Données générées: {X_train.shape[0]} échantillons normaux.")

# 3. Définir et Entraîner le modèle Isolation Forest
print("Entraînement du modèle Isolation Forest...")
# 'contamination' est une estimation du % d'anomalies dans les futures données (pas dans X_train ici)
# C'est un hyperparamètre important à régler.
model = IsolationForest(n_estimators=100, contamination=0.1, random_state=42) 
model.fit(X_train)
print("Entraînement terminé.")

# 4. Sauvegarder le modèle entraîné
print(f"Sauvegarde du modèle dans {MODEL_PATH}...")
joblib.dump(model, MODEL_PATH)
print("Modèle sauvegardé avec succès.")

# 5. Tester le chargement (juste pour vérifier)
try:
    loaded_model = joblib.load(MODEL_PATH)
    print("Test de chargement réussi.")
    # Test de prédiction simple
    test_normal = np.array([[70, 98, 120]])
    test_anomaly = np.array([[160, 98, 130]]) # Tachycardie
    pred_normal = loaded_model.predict(test_normal)
    pred_anomaly = loaded_model.predict(test_anomaly)
    print(f"Prédiction (normal): {pred_normal[0]} (Attendu: 1)")
    print(f"Prédiction (anomalie): {pred_anomaly[0]} (Attendu: -1)")
except Exception as e:
    print(f"Erreur lors du test de chargement/prédiction: {e}")