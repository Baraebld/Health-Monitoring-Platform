import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios, { AxiosError } from 'axios';
import toast from 'react-hot-toast';

const API_URL = 'http://localhost:3000/api';

function LoginPage() {
  const [email, setEmail] = useState<string>('patient1@demo.com');
  const [password, setPassword] = useState<string>('password123');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const loadingToast = toast.loading('Connexion...');
    
    try {
      const response = await axios.post<{ token: string }>(`${API_URL}/auth/login`, {
        email,
        password,
      });

      localStorage.setItem('token', response.data.token);
      toast.success('Connecté !', { id: loadingToast });
      if (email.includes('doctor')) {
        navigate('/doctor');
      } else {
        navigate('/');
      }

    } catch (error) {
      console.error('Erreur de login', error);
      let errorMessage = 'Erreur de connexion';
      if (axios.isAxiosError(error)) {
        const serverError = error as AxiosError<{ message: string }>;
        if (serverError.response?.data?.message) {
          errorMessage = serverError.response.data.message;
        }
      }
      toast.error(errorMessage, { id: loadingToast });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 shadow-xl rounded-lg p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center text-white mb-6">
          Health Platform
        </h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition duration-200"
          >
            Se connecter
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-400 mb-2 font-medium">Comptes de démonstration (PFE) :</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setEmail('patient1@demo.com'); setPassword('password123'); }}
              className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs py-2 px-2 rounded text-center transition font-medium"
            >
              👤 Patient Démo
            </button>
            <button
              type="button"
              onClick={() => { setEmail('doctor@demo.com'); setPassword('password123'); }}
              className="bg-blue-900/50 hover:bg-blue-800/80 text-blue-200 border border-blue-600/50 text-xs py-2 px-2 rounded text-center transition font-medium"
            >
              🩺 Médecin Démo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;