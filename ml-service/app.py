from flask import Flask, request, jsonify
import joblib
import numpy as np
import os
import traceback # NOUVEAU: Pour afficher l'erreur complète

app = Flask(__name__)

# ... (Chargement du modèle - inchangé) ...
MODEL_PATH = 'models/isolation_forest_v1.pkl'
model = None
os.makedirs('models', exist_ok=True) 
try:
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print(f"Modèle Isolation Forest chargé depuis {MODEL_PATH}")
    else:
        print(f"ATTENTION: Fichier modèle {MODEL_PATH} non trouvé.")
except Exception as e:
    print(f"Erreur lors du chargement du modèle: {e}")
    model = None
# -------------------------------------------

# ... (check_rules - inchangé) ...
def check_rules(vitals):
    # ... (code inchangé) ...
    rules_triggered = []
    if 'heartRate' in vitals:
        if vitals['heartRate'] < 40: rules_triggered.append('critical_bradycardia')
        if vitals['heartRate'] > 150: rules_triggered.append('critical_tachycardia')
    if 'spo2' in vitals:
        if vitals['spo2'] < 90: rules_triggered.append('hypoxia')
    if 'bloodPressure' in vitals and 'systolic' in vitals['bloodPressure']:
        if vitals['bloodPressure']['systolic'] < 90: rules_triggered.append('hypotension')
        if vitals['bloodPressure']['systolic'] > 180: rules_triggered.append('hypertension')
    return rules_triggered

def check_isolation_forest(vitals):
    if model is None:
        print("[Isolation Forest] Pas de modèle chargé, impossible de prédire.") # Log ajouté
        return False

    try:
        # --- AJOUT DE LOGS ---
        print(f"[Isolation Forest] Données vitales reçues: {vitals}")

        # 1. Préparer les données
        hr = vitals.get('heartRate', 80) 
        spo2 = vitals.get('spo2', 98)
        # Gestion plus sûre de la pression artérielle
        bp = vitals.get('bloodPressure', {}) 
        systolic = bp.get('systolic', 120) if bp is not None else 120 # Vérifie si bp n'est pas None

        features_list = [hr, spo2, systolic]
        print(f"[Isolation Forest] Features extraites: {features_list}") # Log ajouté

        features_np = np.array([features_list]) # Crée un array 2D [[f1, f2, f3]]
        print(f"[Isolation Forest] Features Numpy (shape {features_np.shape}): {features_np}") # Log ajouté
        # ---------------------

        # 2. Faire la prédiction
        print("[Isolation Forest] Lancement de model.predict()...") # Log ajouté
        prediction = model.predict(features_np)
        print(f"[Isolation Forest] Prédiction reçue: {prediction}") # Log ajouté

        # 3. Renvoyer True si c'est une anomalie (-1)
        return prediction[0] == -1

    except Exception as e:
        # --- MEILLEUR LOG D'ERREUR ---
        print(f"!!! Erreur lors de la prédiction Isolation Forest: {e}")
        print(traceback.format_exc()) # Affiche la trace complète de l'erreur
        # ---------------------------
        return False

@app.route('/predict', methods=['POST'])
def predict_anomaly():
    print("\n--- Requête reçue sur /predict ---") # Log ajouté
    try:
        data = request.json
        print(f"Corps de la requête: {data}") # Log ajouté
        if 'vitals' not in data or data['vitals'] is None: # Vérification ajoutée
            print("Erreur: 'vitals' manquant ou null dans la requête.") # Log ajouté
            return jsonify({'error': 'Missing or null "vitals" in request body'}), 400

        vitals = data['vitals']

        # --- Logique combinée (inchangée mais on va voir les logs avant) ---
        print("[Predict] Vérification des règles...") # Log ajouté
        rules_triggered = check_rules(vitals)
        is_anomaly_rules = len(rules_triggered) > 0
        print(f"[Predict] Résultat règles: {is_anomaly_rules}, {rules_triggered}") # Log ajouté

        print("[Predict] Vérification Isolation Forest...") # Log ajouté
        is_anomaly_if = check_isolation_forest(vitals)
        print(f"[Predict] Résultat Isolation Forest: {is_anomaly_if}") # Log ajouté

        is_anomaly = is_anomaly_rules or is_anomaly_if
        all_reasons = rules_triggered
        if is_anomaly_if and 'isolation_forest_anomaly' not in all_reasons: # Évite doublon si règle + IF
             if not is_anomaly_rules: # Ajoute seulement si aucune règle n'a été déclenchée
                all_reasons.append('isolation_forest_anomaly')

        result = { 'is_anomaly': bool(is_anomaly), 'rules_triggered': all_reasons }
        print(f"[Predict] Résultat final: {result}") # Log ajouté
        # ----------------------------------------------------

        return jsonify(result), 200

    except Exception as e:
         # --- MEILLEUR LOG D'ERREUR ---
        print(f"!!! Erreur inattendue dans /predict: {e}")
        print(traceback.format_exc()) # Affiche la trace complète de l'erreur
         # ---------------------------
        return jsonify({'error': str(e)}), 500

# ... (health_check et if __name__ == '__main__' inchangés) ...
@app.route('/', methods=['GET'])
def health_check():
    status = "OK" if model is not None else "WARNING: Model not loaded"
    return f"ML Service is running. Model Status: {status}", 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)