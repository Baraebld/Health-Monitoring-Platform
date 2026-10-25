import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import io, { Socket } from 'socket.io-client';
import axios from 'axios';
import toast from 'react-hot-toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const API_BASE_URL = 'http://localhost:3000/api';
const SOCKET_URL = 'http://localhost:3000';

interface AlertItem {
  _id: string;
  eventId?: string;
  patientId: string;
  deviceId?: string;
  gatewayId?: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metrics?: {
    heartRate?: number;
    spo2?: number;
    bloodPressure?: {
      systolic?: number;
      diastolic?: number;
    };
  };
  detectionMethod?: string;
  deliveryStatus?: string;
  detectedOffline?: boolean;
  eventTimestamp?: string;
  syncedAt?: string;
  isAcknowledged: boolean;
  createdAt: string;
}

interface EdgeGatewayInfo {
  gatewayId: string;
  lastSync: string;
  isOnline: boolean;
  silenceSeconds: number;
}

interface PatientOverview {
  patientId: string;
  deviceId: string;
  lastUpdate: string;
  vitals: {
    heartRate: number;
    spo2: number;
    systolic: number;
    diastolic: number;
  };
  hasCriticalAlert: boolean;
  criticalAlertCount: number;
  status: 'critical' | 'warning' | 'stable';
}

interface SummaryStats {
  activePatients: number;
  criticalAlerts: number;
  warningAlerts: number;
  totalUnacknowledged: number;
  totalAlerts: number;
}

interface ChartDataPoint {
  name: string;
  heartRate: number;
  spo2: number;
}

const DoctorDashboardPage: React.FC = () => {
  const navigate = useNavigate();

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [patients, setPatients] = useState<PatientOverview[]>([]);
  const [stats, setStats] = useState<SummaryStats>({
    activePatients: 1,
    criticalAlerts: 0,
    warningAlerts: 0,
    totalUnacknowledged: 0,
    totalAlerts: 0,
  });
  const [selectedPatientId, setSelectedPatientId] = useState<string>('patient_001');
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [onlyUnack, setOnlyUnack] = useState<boolean>(false);
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [edgeGateways, setEdgeGateways] = useState<EdgeGatewayInfo[]>([]);

  // Charger les alertes initiales et stats
  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem('token');
      const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

      const [alertsRes, statsRes, patientsRes, edgeRes] = await Promise.all([
        axios.get<AlertItem[]>(`${API_BASE_URL}/alerts?limit=50`, authHeader),
        axios.get<SummaryStats>(`${API_BASE_URL}/alerts/summary`, authHeader),
        axios.get<PatientOverview[]>(`${API_BASE_URL}/alerts/patients`, authHeader),
        axios.get<{ gateways: EdgeGatewayInfo[] }>(`${API_BASE_URL}/edge/status`, authHeader).catch(() => ({ data: { gateways: [] } }))
      ]);

      setAlerts(alertsRes.data);
      setStats(statsRes.data);
      if (edgeRes?.data?.gateways) {
        setEdgeGateways(edgeRes.data.gateways);
      }
      if (patientsRes.data.length > 0) {
        setPatients(patientsRes.data);
      } else {
        // Fallback démo
        setPatients([
          {
            patientId: 'patient_001',
            deviceId: 'smartwatch_123',
            lastUpdate: new Date().toISOString(),
            vitals: { heartRate: 75, spo2: 98, systolic: 120, diastolic: 80 },
            hasCriticalAlert: false,
            criticalAlertCount: 0,
            status: 'stable',
          },
        ]);
      }
    } catch (err) {
      console.error('Erreur chargement données médecin:', err);
    }
  };

  useEffect(() => {
    fetchDashboardData();

    // Écoute temps réel via WebSockets
    const newSocket: Socket = io(SOCKET_URL);

    newSocket.on('connect', () => {
      setSocketConnected(true);
      toast.success('Supervision médicale connectée en direct', { id: 'doc-socket' });
    });

    newSocket.on('disconnect', () => {
      setSocketConnected(false);
    });

    // Données physiologiques en direct
    newSocket.on('vital_update', (data: any) => {
      if (data.patientId === selectedPatientId) {
        const point: ChartDataPoint = {
          name: new Date(data.timestamp).toLocaleTimeString(),
          heartRate: data.vitals?.heartRate || 0,
          spo2: data.vitals?.spo2 || 0,
        };

        setChartData((prev) => {
          const next = [...prev, point];
          return next.length > 25 ? next.slice(next.length - 25) : next;
        });

        // Mettre à jour l'état du patient dans la liste
        setPatients((prevList) =>
          prevList.map((p) =>
            p.patientId === data.patientId
              ? {
                  ...p,
                  lastUpdate: data.timestamp,
                  vitals: {
                    heartRate: data.vitals.heartRate,
                    spo2: data.vitals.spo2,
                    systolic: data.vitals.bloodPressure?.systolic || p.vitals.systolic,
                    diastolic: data.vitals.bloodPressure?.diastolic || p.vitals.diastolic,
                  },
                }
              : p
          )
        );
      }
    });

    // Nouvelle alerte en direct
    newSocket.on('new_alert', (newAlert: AlertItem) => {
      setAlerts((prev) => [newAlert, ...prev]);
      setStats((prev) => ({
        ...prev,
        totalAlerts: prev.totalAlerts + 1,
        totalUnacknowledged: prev.totalUnacknowledged + 1,
        criticalAlerts: newAlert.severity === 'critical' ? prev.criticalAlerts + 1 : prev.criticalAlerts,
        warningAlerts: newAlert.severity === 'warning' ? prev.warningAlerts + 1 : prev.warningAlerts,
      }));

      // Toast sonore et visuel médecin
      toast.error(
        `🚨 NOUVELLE ALERTE ${newAlert.severity.toUpperCase()} : ${newAlert.message} (${newAlert.patientId})`,
        { duration: 8000 }
      );
    });

    return () => {
      newSocket.disconnect();
    };
  }, [selectedPatientId]);

  // Acquitter une alerte
  const handleAcknowledge = async (alertId: string) => {
    try {
      const token = localStorage.getItem('token');
      const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      await axios.patch(`${API_BASE_URL}/alerts/${alertId}/ack`, {}, authHeader);
      setAlerts((prev) =>
        prev.map((a) => (a._id === alertId ? { ...a, isAcknowledged: true } : a))
      );
      setStats((prev) => ({
        ...prev,
        totalUnacknowledged: Math.max(0, prev.totalUnacknowledged - 1),
      }));
      toast.success('Alerte acquittée');
    } catch (err) {
      toast.error("Impossible d'acquitter l'alerte");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  // Filtrage des alertes
  const filteredAlerts = alerts.filter((a) => {
    if (filterSeverity !== 'all' && a.severity !== filterSeverity) return false;
    if (onlyUnack && a.isAcknowledged) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8">
      {/* Header Médical */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-gray-800 gap-4 mb-8">
        <div>
          <div className="flex items-center space-x-3">
            <span className="text-3xl">🩺</span>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Console Médicale <span className="text-blue-500 font-semibold text-xl">| Supervision IoMT</span>
            </h1>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Surveillance centralisée multi-patients, télémétrie en temps réel et triage des alertes cliniques
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Statut Passerelle Edge RPi */}
          <div className="flex items-center space-x-2 bg-gray-900 px-3 py-1.5 rounded-full border border-gray-800">
            <span
              className={`w-3 h-3 rounded-full ${
                edgeGateways.some(g => g.isOnline) ? 'bg-purple-500 animate-pulse' : 'bg-gray-600'
              }`}
            />
            <span className="text-xs text-gray-300 font-medium">
              {edgeGateways.length > 0 && edgeGateways.some(g => g.isOnline)
                ? `Edge RPi : Connectée (Sync ${new Date(edgeGateways[0].lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
                : 'Edge RPi : Autonome'}
            </span>
          </div>

          <div className="flex items-center space-x-2 bg-gray-900 px-3 py-1.5 rounded-full border border-gray-800">
            <span
              className={`w-3 h-3 rounded-full ${
                socketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
              }`}
            />
            <span className="text-xs text-gray-300 font-medium">
              {socketConnected ? 'Flux Temps Réel Actif' : 'Déconnecté'}
            </span>
          </div>

          <Link
            to="/"
            className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold py-2 px-4 rounded-lg border border-gray-700 transition"
          >
            Vue Patient
          </Link>

          <button
            onClick={handleLogout}
            className="bg-red-600/80 hover:bg-red-600 text-white text-sm font-semibold py-2 px-4 rounded-lg transition"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {/* KPI Cards Medecin */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <div className="bg-gray-900 border border-gray-800 p-5 rounded-xl flex items-center space-x-4">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl text-2xl">👥</div>
          <div>
            <div className="text-xs font-medium uppercase text-gray-400 tracking-wider">Patients Suivis</div>
            <div className="text-2xl font-bold text-white mt-1">{patients.length} actif(s)</div>
          </div>
        </div>

        <div className="bg-gray-900 border border-red-900/50 p-5 rounded-xl flex items-center space-x-4">
          <div className="p-3 bg-red-500/10 text-red-400 rounded-xl text-2xl">🚨</div>
          <div>
            <div className="text-xs font-medium uppercase text-red-400 tracking-wider">Alertes Critiques</div>
            <div className="text-2xl font-bold text-red-400 mt-1">{stats.criticalAlerts}</div>
          </div>
        </div>

        <div className="bg-gray-900 border border-amber-900/50 p-5 rounded-xl flex items-center space-x-4">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl text-2xl">⚠️</div>
          <div>
            <div className="text-xs font-medium uppercase text-amber-400 tracking-wider">Avertissements ML</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">{stats.warningAlerts}</div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 p-5 rounded-xl flex items-center space-x-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl text-2xl">📋</div>
          <div>
            <div className="text-xs font-medium uppercase text-gray-400 tracking-wider">Non Acquittées</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.totalUnacknowledged}</div>
          </div>
        </div>
      </div>

      {/* Section Principale : Tableau Patients & Graphique */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Liste des Patients */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 lg:col-span-1 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-white mb-4 flex items-center justify-between">
              <span>Patients en Télésurveillance</span>
              <span className="text-xs bg-gray-800 px-2.5 py-1 rounded-full text-gray-300">
                {patients.length} enregistrés
              </span>
            </h2>

            <div className="space-y-3">
              {patients.map((p) => {
                const isSelected = p.patientId === selectedPatientId;
                return (
                  <div
                    key={p.patientId}
                    onClick={() => setSelectedPatientId(p.patientId)}
                    className={`p-4 rounded-xl cursor-pointer border transition ${
                      isSelected
                        ? 'bg-blue-950/40 border-blue-500/60 ring-1 ring-blue-500/40'
                        : 'bg-gray-800/40 border-gray-800 hover:bg-gray-800/80'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-bold text-white text-base">{p.patientId}</div>
                        <div className="text-xs text-gray-400 font-mono">Dispositif: {p.deviceId}</div>
                      </div>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${
                          p.hasCriticalAlert
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {p.hasCriticalAlert ? 'Critique' : 'Stable'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-800 text-center">
                      <div>
                        <div className="text-xs text-gray-400">Pouls</div>
                        <div className="text-sm font-bold text-red-400">{p.vitals.heartRate} bpm</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400">SpO2</div>
                        <div className="text-sm font-bold text-emerald-400">{p.vitals.spo2}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400">Tension</div>
                        <div className="text-sm font-bold text-blue-400">
                          {p.vitals.systolic}/{p.vitals.diastolic}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 p-3 bg-gray-800/50 rounded-lg text-xs text-gray-400 border border-gray-800">
            ℹ️ Cliquez sur un patient pour afficher sa télémétrie en temps réel dans le graphique adjacent.
          </div>
        </div>

        {/* Télémétrie en Direct du Patient Sélectionné */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">
                Télémétrie en Direct : <span className="text-blue-400">{selectedPatientId}</span>
              </h2>
              <p className="text-xs text-gray-400">
                Flux continu des 25 derniers cycles physiologiques (Rythme Cardiaque & SpO2)
              </p>
            </div>
          </div>

          <div className="h-[320px] w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                En attente des premiers paquets de données du simulateur...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="hr" domain={[30, 200]} stroke="#f87171" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="spo2" domain={[70, 100]} orientation="right" stroke="#34d399" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }}
                    labelStyle={{ color: '#e5e7eb' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line
                    yAxisId="hr"
                    type="monotone"
                    dataKey="heartRate"
                    stroke="#f87171"
                    name="Rythme Cardiaque (bpm)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="spo2"
                    type="monotone"
                    dataKey="spo2"
                    stroke="#34d399"
                    name="SpO2 (%)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Section Journal & Triage des Alertes */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center pb-4 mb-4 border-b border-gray-800 gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Journal Clinique des Alertes & Triage</h2>
            <p className="text-xs text-gray-400">
              Historique des alertes avec anti-spam et acquittement par le soignant
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-xs text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Toutes sévérités</option>
              <option value="critical">Critiques seulement</option>
              <option value="warning">Avertissements ML</option>
            </select>

            <button
              onClick={() => setOnlyUnack(!onlyUnack)}
              className={`text-xs font-semibold px-3 py-2 rounded-lg border transition ${
                onlyUnack
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
              }`}
            >
              {onlyUnack ? '✓ Non acquittées seulement' : 'Toutes les alertes'}
            </button>

            <button
              onClick={fetchDashboardData}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold px-3 py-2 rounded-lg border border-gray-700 transition"
            >
              🔄 Actualiser
            </button>
          </div>
        </div>

        {/* Table des Alertes */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-800/60 text-gray-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-3">Horodatage</th>
                <th className="p-3">Origine & SMS</th>
                <th className="p-3">Patient</th>
                <th className="p-3">Sévérité</th>
                <th className="p-3">Type & Message</th>
                <th className="p-3">Constantes à l'instant T</th>
                <th className="p-3">Statut</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filteredAlerts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-gray-500">
                    Aucune alerte clinique ne correspond aux critères sélectionnés.
                  </td>
                </tr>
              ) : (
                filteredAlerts.map((alert) => (
                  <tr key={alert._id} className="hover:bg-gray-800/30 transition">
                    <td className="p-3 font-mono text-gray-400">
                      {new Date(alert.eventTimestamp || alert.createdAt).toLocaleTimeString()}
                      <div className="text-[10px] text-gray-500">
                        {new Date(alert.eventTimestamp || alert.createdAt).toLocaleDateString()}
                      </div>
                      {alert.syncedAt && (
                        <div className="text-[9px] text-blue-400/80 font-sans">
                          Sync: {new Date(alert.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </td>

                    <td className="p-3">
                      <div className="flex flex-col gap-1 items-start">
                        {alert.detectedOffline ? (
                          <span className="inline-block bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                            Edge RPi
                          </span>
                        ) : (
                          <span className="inline-block bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                            Cloud
                          </span>
                        )}

                        {alert.deliveryStatus === 'accepted_by_modem' && (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                            <span>📱</span> SMS Transmis
                          </span>
                        )}
                        {alert.deliveryStatus === 'accepted_by_mock_transport' && (
                          <span className="text-[10px] text-cyan-400 flex items-center gap-1 font-medium">
                            <span>🧪</span> SMS Mock
                          </span>
                        )}
                        {alert.deliveryStatus === 'failed' && (
                          <span className="text-[10px] text-red-400 flex items-center gap-1 font-medium">
                            <span>❌</span> SMS Échoué
                          </span>
                        )}
                        {alert.deliveryStatus === 'debounced' && (
                          <span className="text-[10px] text-amber-400 flex items-center gap-1 font-medium">
                            <span>⏳</span> Anti-Spam
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="p-3 font-bold text-white">
                      {alert.patientId}
                      <div className="text-[10px] text-gray-500 font-mono">{alert.deviceId || 'smartwatch'}</div>
                    </td>

                    <td className="p-3">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                          alert.severity === 'critical'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {alert.severity}
                      </span>
                    </td>

                    <td className="p-3">
                      <div className="font-semibold text-gray-200">{alert.message}</div>
                      <div className="text-[10px] text-gray-500 font-mono">Code: {alert.type}</div>
                    </td>

                    <td className="p-3 font-mono text-gray-300">
                      {alert.metrics ? (
                        <div>
                          <span>HR: <b className="text-red-400">{alert.metrics.heartRate ?? '-'}</b> bpm</span> |{' '}
                          <span>SpO2: <b className="text-emerald-400">{alert.metrics.spo2 ?? '-'}</b>%</span> |{' '}
                          <span>
                            TA: {alert.metrics.bloodPressure?.systolic ?? '-'}/
                            {alert.metrics.bloodPressure?.diastolic ?? '-'}
                          </span>
                        </div>
                      ) : (
                        'N/A'
                      )}
                    </td>

                    <td className="p-3">
                      {alert.isAcknowledged ? (
                        <span className="inline-flex items-center text-emerald-400 font-medium">
                          ✓ Traitée
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-amber-400 font-semibold animate-pulse">
                          ● En attente
                        </span>
                      )}
                    </td>

                    <td className="p-3 text-right">
                      {!alert.isAcknowledged && (
                        <button
                          onClick={() => handleAcknowledge(alert._id)}
                          className="bg-blue-600/80 hover:bg-blue-600 text-white font-semibold px-3 py-1.5 rounded-md text-xs transition"
                        >
                          Acquitter
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DoctorDashboardPage;
