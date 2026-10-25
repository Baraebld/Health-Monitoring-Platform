import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import io, { Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import MetricCard from '../components/MetricCard'; // Importe la nouvelle carte

const SOCKET_URL = 'http://localhost:3000';

// --- Définition de nos types ---
interface Vitals {
  heartRate: number;
  spo2: number;
  bloodPressure: {
    systolic: number;
    diastolic: number;
  };
}

interface SocketData {
  patientId: string;
  deviceId: string;
  timestamp: string;
  vitals: Vitals;
}

interface ChartDataPoint {
  name: string;
  heartRate: number;
  spo2: number;
}
// --------------------------------

function DashboardPage() {
  const navigate = useNavigate();
  
  const [vitals, setVitals] = useState<ChartDataPoint[]>([]);
  const [currentVitals, setCurrentVitals] = useState<Vitals | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      // auth: { token: localStorage.getItem('token') } 
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      toast.success('Connecté au serveur temps réel !', { duration: 2000 });
    });

    newSocket.on('disconnect', () => {
      toast.error('Déconnecté du serveur temps réel.');
    });

    newSocket.on('vital_update', (data: SocketData) => {
      console.log('Donnée reçue:', data);
      
      const newDataPoint: ChartDataPoint = {
        name: new Date(data.timestamp).toLocaleTimeString(),
        heartRate: data.vitals.heartRate,
        spo2: data.vitals.spo2,
      };

      setCurrentVitals(data.vitals);
      setVitals((prevVitals) => {
        const updatedVitals = [...prevVitals, newDataPoint];
        if (updatedVitals.length > 20) {
          return updatedVitals.slice(updatedVitals.length - 20);
        }
        return updatedVitals;
      });
    });

    newSocket.on('new_alert', (alertData: any) => {
      console.log('ALERTE REÇUE:', alertData);
      // Affiche un "toast" d'erreur qui reste à l'écran (duration: 6000ms)
      toast.error(
        `ALERTE: ${alertData.message} (Patient: ${alertData.patientId})`,
        {
          duration: 6000,
          style: {
            background: '#ef4444', // Rouge
            color: '#ffffff',
          },
          iconTheme: {
            primary: '#ffffff',
            secondary: '#ef4444',
          },
        }
      );
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    socket?.disconnect();
    navigate('/login');
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Tableau de Bord Patient</h1>
          <p className="text-xs text-gray-400 mt-0.5">Télémétrie physiologique personnelle en temps réel</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/doctor"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition duration-200 flex items-center gap-1.5 shadow"
          >
            <span>🩺</span>
            <span>Console Médecin</span>
          </Link>
          <button 
            onClick={handleLogout} 
            className="bg-red-600/80 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg text-sm transition duration-200"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {/* Grille de Métriques */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <MetricCard 
          title="Rythme Cardiaque" 
          value={currentVitals?.heartRate} 
          unit="bpm"
          icon={<HeartIcon />}
        />
        <MetricCard 
          title="Saturation (SpO2)" 
          value={currentVitals?.spo2} 
          unit="%" 
          icon={<ActivityIcon />}
        />
        <MetricCard 
          title="Pression Artérielle" 
          value={currentVitals ? `${currentVitals.bloodPressure.systolic} / ${currentVitals.bloodPressure.diastolic}` : '...'} 
          unit="mmHg" 
          icon={<PressureIcon />}
        />
      </div>

      {/* Graphique */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg h-[400px]">
        <h2 className="text-xl font-semibold text-white mb-4">Évolution en temps réel</h2>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={vitals} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
            <XAxis dataKey="name" stroke="#a0aec0" />
            <YAxis yAxisId="left" stroke="#8884d8" />
            <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
            <Tooltip 
              contentStyle={{ backgroundColor: '#2d3748', border: 'none', borderRadius: '8px' }}
              labelStyle={{ color: '#e2e8f0' }} 
            />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="heartRate" stroke="#8884d8" name="Rythme Cardiaque" dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="spo2" stroke="#82ca9d" name="SpO2" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- Icônes SVG simples (à mettre en bas du fichier ou dans leur propre fichier) ---
const HeartIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.5l1.318-1.182a4.5 4.5 0 116.364 6.364L12 19.5l-7.682-7.682a4.5 4.5 0 010-6.364z" />
  </svg>
);
const ActivityIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
const PressureIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.105 0 2 .895 2 2s-.895 2-2 2-2-.895-2-2 .895-2 2 2zm0 8c-1.105 0-2 .895-2 2s.895 2 2 2 2-.895 2-2-.895-2-2-2z" />
  </svg>
);

export default DashboardPage;