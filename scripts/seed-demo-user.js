// Script pour initialiser un utilisateur démo dans MongoDB
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/healthdb';

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['patient', 'doctor', 'admin'], default: 'patient' },
  profile: { firstName: String, lastName: String }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

async function seed() {
  console.log('Connexion à MongoDB sur', MONGO_URI);
  await mongoose.connect(MONGO_URI);

  const demoEmail = 'patient1@demo.com';
  const existing = await User.findOne({ email: demoEmail });

  if (existing) {
    console.log(`L'utilisateur démo ${demoEmail} existe déjà dans MongoDB.`);
  } else {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    const newUser = new User({
      email: demoEmail,
      password: hashedPassword,
      role: 'patient',
      profile: {
        firstName: 'Jean',
        lastName: 'Dupont'
      }
    });

    await newUser.save();
    console.log(`Utilisateur démo créé avec succès :`);
    console.log(`- Email: ${demoEmail}`);
    console.log(`- Mot de passe: password123`);
    console.log(`- Rôle: patient`);
  }

  // Création du compte Médecin Démo
  const doctorEmail = 'doctor@demo.com';
  const existingDoc = await User.findOne({ email: doctorEmail });

  if (existingDoc) {
    console.log(`Le médecin démo ${doctorEmail} existe déjà dans MongoDB.`);
  } else {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    const newDoctor = new User({
      email: doctorEmail,
      password: hashedPassword,
      role: 'doctor',
      profile: {
        firstName: 'Dr. Sarah',
        lastName: 'Benali'
      }
    });

    await newDoctor.save();
    console.log(`Compte Médecin démo créé avec succès :`);
    console.log(`- Email: ${doctorEmail}`);
    console.log(`- Mot de passe: password123`);
    console.log(`- Rôle: doctor`);
  }

  await mongoose.disconnect();
  console.log('Déconnecté de MongoDB. Terminé !');
}

seed().catch(err => {
  console.error('Erreur lors du seeding :', err.message);
  process.exit(1);
});
