const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email obligatoire'],
    unique: true,
    match: [/.+\@.+\..+/, 'Email invalide']
  },
  password: {
    type: String,
    required: [true, 'Mot de passe obligatoire'],
    minlength: 6,
    select: false // Ne pas renvoyer le mot de passe par défaut
  },
  role: {
    type: String,
    enum: ['patient', 'doctor', 'admin'],
    default: 'patient'
  },
  profile: {
    firstName: String,
    lastName: String
  },
  // ... (tu ajouteras 'medicalInfo', 'patients' etc. plus tard)
}, { timestamps: true });

// Hachage du mot de passe AVANT de sauvegarder
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Méthode pour comparer le mot de passe
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);