import React from 'react';

// On type les props du composant
interface MetricCardProps {
  title: string;
  value: string | number | undefined | null;
  unit: string;
  icon: React.ReactNode; // Pour ajouter une icône
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, unit, icon }) => (
  <div className="bg-gray-800 p-6 rounded-lg shadow-lg flex items-center space-x-4">
    <div className="p-3 bg-gray-700 rounded-full">
      {icon}
    </div>
    <div>
      <h3 className="text-sm font-medium text-gray-400">{title}</h3>
      <p className="text-3xl font-bold text-white">
        {value ?? '...'}
        {value && <span className="text-xl text-gray-300 ml-1">{unit}</span>}
      </p>
    </div>
  </div>
);

export default MetricCard;