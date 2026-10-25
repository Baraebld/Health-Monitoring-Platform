const axios = require('axios');

// L'URL de notre API (grâce à Docker, on peut l'appeler par son nom)
const API_URL = process.env.API_URL || 'http://localhost:3000';

// Fonction pour générer des données aléatoires réalistes
// NOUVELLE VERSION (pour forcer une alerte)
function generateVitalSigns() {
  // Les données sont normales la plupart du temps...
  let heartRate = Math.floor(Math.random() * (100 - 60 + 1)) + 60;
  let spo2 = Math.floor(Math.random() * (100 - 95 + 1)) + 95;
  const systolic = Math.floor(Math.random() * (140 - 110 + 1)) + 110;
  const diastolic = Math.floor(Math.random() * (90 - 70 + 1)) + 70;

  // ...MAIS une fois sur cinq (environ), on envoie une anomalie !
  if (Math.random() < 0.2) { 
    console.log("!!!!!!!! FORCING ANOMALY !!!!!!!");
    heartRate = 160; // Déclenchera 'critical_tachycardia'
    spo2 = 88;       // Déclenchera 'hypoxia'
  }

  return { heartRate, spo2, bloodPressure: { systolic, diastolic } };
}

// Fonction pour envoyer les données à l'API
async function sendData() {
  const patientId = 'patient_001'; // Simule un patient
  const vitals = generateVitalSigns();
  
  try {
    const payload = {
      patientId: patientId,
      deviceId: 'smartwatch_123',
      timestamp: new Date().toISOString(),
      vitals: vitals
    };

    console.log(`[SIMULATOR] Envoi des données pour ${patientId}:`, vitals);
    
    // Envoi de la requête POST
    const response = await axios.post(`${API_URL}/api/vitals`, payload);
    console.log(`[SIMULATOR] Réponse de l'API: ${response.data.message}`);

  } catch (error) {
    console.error(`[SIMULATOR] Erreur d'envoi des données: ${error.message}`);
  }
}

// Démarrer le simulateur
console.log('[SIMULATOR] Simulateur démarré.');
console.log(`[SIMULATOR] Envoi des données vers ${API_URL}`);

// Envoie des données toutes les 5 secondes
setInterval(sendData, 5000);