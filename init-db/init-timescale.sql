-- Initialisation de la base TimescaleDB pour Health Monitoring Platform
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

CREATE TABLE IF NOT EXISTS vital_signs (
    time TIMESTAMPTZ NOT NULL,
    patient_id VARCHAR(50) NOT NULL,
    device_id VARCHAR(50),
    heart_rate INTEGER,
    spo2 INTEGER,
    systolic INTEGER,
    diastolic INTEGER
);

-- Conversion de la table en hypertable TimescaleDB partitionnée par temps
SELECT create_hypertable('vital_signs', 'time', if_not_exists => TRUE);

-- Index pour optimiser les requêtes par patient et temps
CREATE INDEX IF NOT EXISTS idx_vital_signs_patient_time ON vital_signs (patient_id, time DESC);
