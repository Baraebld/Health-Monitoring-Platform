# Technical Report: Autonomous Edge-Enabled Remote Patient Monitoring Platform (IoMT)

**Document Reference:** `PFE-IoMT-TR-2026-V1`  
**Classification:** Engineering & Research Technical Report  
**Author:** Software Engineering Team / PFE Academic Project  
**Repository:** [https://github.com/Baraebld/Health-Monitoring-Platform](https://github.com/Baraebld/Health-Monitoring-Platform)  
**System Status:** Verified / Functional Multi-Container Implementation  

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Problem Statement and Objectives](#2-problem-statement-and-objectives)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Technology Stack](#4-technology-stack)
5. [Repository Structure](#5-repository-structure)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Backend Architecture & API Specifications](#7-backend-architecture--api-specifications)
8. [Database Design & Polyglot Persistence](#8-database-design--polyglot-persistence)
9. [Authentication, Authorization, and Data Protection](#9-authentication-authorization-and-data-protection)
10. [IoMT Measurement Pipeline](#10-iomt-measurement-pipeline)
11. [Edge Computing and Anomaly Detection](#11-edge-computing-and-anomaly-detection)
12. [Autonomous Alerting and Direct SMS Delivery](#12-autonomous-alerting-and-direct-sms-delivery)
13. [Offline Operation and Idempotent Synchronization](#13-offline-operation-and-idempotent-synchronization)
14. [Deployment Infrastructure & Raspberry Pi Setup](#14-deployment-infrastructure--raspberry-pi-setup)
15. [Testing, Verification, and Observed Results](#15-testing-verification-and-observed-results)
16. [Security, Reliability, and Failure Analysis](#16-security-reliability-and-failure-analysis)
17. [Known Limitations and Future Improvements](#17-known-limitations-and-future-improvements)
18. [Conclusion](#18-conclusion)
19. [References](#19-references)

---

## 1. Executive Summary

This report documents the architectural design, implementation, and verification of the **Health Monitoring Platform**, an end-to-end **Internet of Medical Things (IoMT)** remote patient monitoring system developed as a Master's Capstone (*Projet de Fin d'Études - PFE*).

### Problem Addressed
Conventional remote health architectures rely on continuous high-speed Internet connectivity to transmit physiological telemetry to centralized cloud servers. If the local broadband connection fails, the hospital gateway goes down, or cloud infrastructure encounters downtime, central inference halts, and vital notifications fail to reach caregivers—introducing life-threatening risks during acute physiological decompensation (e.g., severe tachycardia, acute hypoxia, sudden hypotension). Furthermore, high-frequency IoT streaming frequently overwhelms clinical staff through *alert fatigue*.

### Main Implemented Capabilities
- **Decoupled Event-Driven Microservices:** Orchestration across 9 microservices spanning ingestion, polyglot storage, inference, and real-time streaming.
- **Autonomous Edge Gateway (`edge-gateway`):** A lightweight service compatible with single-board computers (Raspberry Pi) capable of autonomous data validation, clinical heuristic evaluation, and immediate local decision-making during complete network outages.
- **Direct Cellular SMS Alerting:** Independent notification engine with a modular driver architecture supporting real GSM/LTE modems via Hayes 3GPP AT commands (`modemTransport`) and a deterministic test mock (`mockTransport`). Alerts are dispatched instantly without contacting the central cloud backend.
- **Local ACID Persistence & Idempotent Synchronization:** Embedded SQLite storage operating in Write-Ahead Logging (WAL) mode ensuring zero data loss across process crashes or power outages, paired with an idempotent sync agent reconciling telemetry and alert histories upon cloud reconnection.
- **Dual Clinical & Patient Interfaces:** React 19 single-page application featuring an interactive patient portal with real-time Recharts visualizations and a dedicated doctor triage supervision console with alert acknowledgment and edge connectivity indicators.
- **Hybrid Anomaly Detection:** Cloud-based machine learning (**Isolation Forest** via scikit-learn) combined with deterministic clinical thresholds and edge-based statistical deviation scoring ($Z$-Score).

### Engineering Contribution
The core engineering contribution is a **hybrid Edge/Cloud architecture delivering zero-cloud-dependency emergency alerting**. Unlike naive edge architectures that buffer alerts in local queues until network restoration, this system initiates external physical notifications over cellular channels locally while maintaining eventual consistency across the central data lake upon network recovery.

---

## 2. Problem Statement and Objectives

### Context of Remote Patient Monitoring (IoMT)
Continuous physiological monitoring of ambulatory or home-bound patients with chronic cardiovascular or respiratory conditions requires frequent sampling of key biometrics:
- **Heart Rate (HR)** measured in beats per minute (bpm).
- **Oxygen Saturation ($\text{SpO}_2$)** measured as a percentage.
- **Blood Pressure (BP)** measured as systolic and diastolic pressure in mmHg.

### Core Challenges
1. **Network Fragility & Latency:** In home healthcare, rural settings, or disaster scenarios, broadband connectivity cannot be guaranteed. Standard cloud-dependent pipelines fail silently when disconnected.
2. **Alert Fatigue:** Rapid consecutive anomalies (e.g., a reading every 5 seconds) can generate hundreds of repetitive alerts per hour, desensitizing medical responders.
3. **Sensor Fault Disambiguation:** Disconnected sensors or battery depletion must not be misconstrued as cardiac arrest; hardware status must be tracked distinctly from physiological collapse.
4. **Data Integrity & Scalability:** Telemetry produces dense time-series data demanding specialized storage engines, whereas user profiles and clinical alert histories require relational or document semantics.

### Project Objectives
- **O1:** Implement continuous real-time telemetry ingestion and multi-role dashboard presentation.
- **O2:** Deploy an autonomous edge runtime operating independently of cloud backend availability.
- **O3:** Implement direct cellular SMS dispatch with backoff retries and anti-spam deduplication.
- **O4:** Guarantee zero data loss across offline intervals using local persistent ACID storage.
- **O5:** Provide seamless eventual consistency via idempotent batch synchronization.
- **O6:** Enforce role-based access control (RBAC) preventing unauthorized cross-patient data exposure.

### Project Scope & Exclusions
- **In Scope:** Full-stack software architecture, containerized microservices, SQLite/PostgreSQL/MongoDB persistence, WebSocket streaming, simulated telemetry, Hayes AT modem protocol integration, unit/integration verification.
- **Out of Scope (Explicit Exclusions):** Regulatory medical device certification (FDA/CE Class II), real-world clinical trials, encrypted Bluetooth Low Energy (BLE) hardware driver stack (telemetry is ingested via standardized JSON payloads over HTTP/serial).

---

## 3. System Architecture Overview

The system implements a tiered architecture bridging IoT devices, an Edge Gateway, a Central Cloud Backend, and Responsive Web Frontends.

```mermaid
flowchart TD
    subgraph Tier1_IoT ["Tier 1: Device & Telemetry Layer"]
        DS["device-simulator<br/>(Node.js Telemetry Emitter)<br/>HR, SpO2, Systolic, Diastolic<br/>Every 5s (20% Anomaly Injection)"]
    end

    subgraph Tier2_Edge ["Tier 2: Autonomous Edge Gateway (Raspberry Pi)"]
        direction TB
        E_ING["HTTP Ingestion Endpoint (:3001)<br/>POST /api/vitals"]
        E_VAL["Validation & Freshness Engine<br/>Clock Skew & Stale Detection"]
        E_RULE["Deterministic Clinical Rules<br/>Threshold Evaluation"]
        E_HM["Sensor Health Monitor<br/>Heartbeat & Disconnection Tracking"]
        E_ML["Local Statistical Detector<br/>Sliding Window Z-Score (Z >= 3.0)"]
        E_DB[("Local SQLite 3 ACID Store<br/>WAL Mode (Restart Survival)<br/>measurements, alerts, audit")]
        E_NM["Notification Manager<br/>Anti-Spam (5 min) & Backoff (x2)"]
        E_MODEM["Modular SMS Transport<br/>Hayes AT Commands (3GPP TS 27.005)<br/>or Deterministic Mock Transport"]
        E_SYNC["Idempotent Cloud Sync Agent<br/>Automatic Connectivity Probing"]

        E_ING --> E_VAL
        E_VAL --> E_HM
        E_VAL --> E_RULE
        E_RULE --> E_ML
        E_VAL --> E_DB
        E_RULE --> E_DB
        E_RULE -- "Critical Anomaly" --> E_NM
        E_NM --> E_MODEM
        E_DB -. "Pending Records" .-> E_SYNC
    end

    subgraph Tier3_Cloud ["Tier 3: Central Cloud Backend"]
        direction TB
        AG["api-gateway (Express, :3000)<br/>REST Ingestion & Edge Sync (/api/edge/sync)<br/>JWT Auth & RBAC<br/>Swagger UI (:3000/api-docs)<br/>Socket.io WebSocket Server"]
        TS[("TimescaleDB (:5432)<br/>PostgreSQL 16 Hypertable<br/>Table: vital_signs")]
        MG[("MongoDB 7 (:27017)<br/>Collections: users, alerts")]
        RD[("Redis 7 (:6379)<br/>Pub/Sub Broker<br/>vitals-channel & alerts-channel")]
        AE["alert-engine (Worker)<br/>Redis Consumer & Anti-Spam"]
        ML["ml-service (Flask, :5000)<br/>scikit-learn Isolation Forest<br/>Clinical Rules Evaluator"]

        AG -- "1. Ingest Vitals" --> TS
        AG -- "2. Publish" --> RD
        RD -- "Consume" --> AE
        AE -- "POST /predict" --> ML
        AE -- "Persist Alert" --> MG
        AE -- "Publish Alert" --> RD
        RD -- "Forward" --> AG
    end

    subgraph Tier4_Presentation ["Tier 4: Presentation & Supervision"]
        FE_P["Patient Dashboard (:5173)<br/>Real-Time Metric Cards<br/>Recharts Dynamic Trend"]
        FE_D["Doctor Console (:5173/doctor)<br/>Multi-Patient Triage<br/>Edge Sync Badges & SMS Audit<br/>Alert Acknowledgment"]
    end

    %% Network Connections
    DS -- "Local HTTP" --> E_ING
    DS -- "Cloud Fallback HTTP" --> AG
    E_MODEM -. "Cellular Network (GSM/LTE)<br/>Direct SMS (Zero Cloud)" .-> CELL_PHONE["Doctor Mobile Handset"]
    E_SYNC -- "Broadband / WiFi (When UP)<br/>Idempotent Batch POST" --> AG
    AG -- "Socket.io WebSocket" --> FE_P
    AG -- "Socket.io WebSocket" --> FE_D
    FE_D -- "JWT REST API" --> AG
```

### Communication Protocols & Interaction Patterns
1. **IoT to Gateway:** Standardized JSON over HTTP/1.1 (`POST /api/vitals`).
2. **Edge Notification:** Serial UART / USB AT commands conforming to 3GPP TS 27.005 / 27.007 (`AT+CMGS`).
3. **Edge to Cloud:** Idempotent batch payloads over HTTP/1.1 (`POST /api/edge/sync`) authorized via `X-Gateway-Key`.
4. **Cloud Internal Ingestion:** Asynchronous non-blocking message passing over Redis Pub/Sub (`vitals-channel`, `alerts-channel`).
5. **Telemetry Persistence:** Time-series SQL streaming into TimescaleDB hypertables.
6. **Backend to Frontend:** Full-duplex WebSocket streaming via Socket.io with HTTP polling fallback.

---

## 4. Technology Stack

The following table itemizes all technologies, libraries, and runtimes verified in the codebase:

| Component / Layer | Technology | Verified Version | Purpose in System | Implementation Path |
| :--- | :--- | :--- | :--- | :--- |
| **Edge Runtime** | Node.js (Alpine) | v22 / v24 (Native) | Autonomous edge gateway, rule engine, and async IO | `edge-gateway/Dockerfile` |
| **Edge Storage** | `node:sqlite` | Built-in (Node 22+) | ACID embedded database with WAL mode for offline storage | `edge-gateway/storage/database.js` |
| **Backend API** | Node.js / Express | 4.19.2 | REST gateway, request validation, authentication, and routing | `api-gateway/package.json` |
| **API Documentation**| Swagger / OpenAPI | 6.2.8 (UI: 5.0.1) | Interactive OpenAPI 3.0 documentation served at `/api-docs` | `api-gateway/index.js` |
| **WebSocket Engine** | Socket.io | 4.8.1 | Real-time bi-directional streaming of vitals and alerts | `api-gateway/index.js` |
| **Message Broker** | Redis (Alpine) | 7.x | High-throughput in-memory Pub/Sub message distribution | `docker-compose.yml` |
| **Redis Client** | `ioredis` | 5.8.2 / 5.4.1 | Node.js Redis client for publish/subscribe handling | `api-gateway`, `alert-engine` |
| **Time-Series DB** | TimescaleDB | pg16-latest | Partitioned PostgreSQL hypertable for vital measurements | `init-db/init-timescale.sql` |
| **SQL Client** | `pg` (node-postgres)| 8.16.3 | Connection pooling and querying for TimescaleDB | `api-gateway/routes/vitals.js` |
| **Document Database**| MongoDB | 7.x | Schema-flexible storage for users and alert audit records | `docker-compose.yml` |
| **ODM Engine** | Mongoose | 8.19.2 / 8.10.1| MongoDB modeling, validation, and index management | `api-gateway`, `alert-engine` |
| **Security & Auth** | JSON Web Tokens | 9.0.2 | Stateless signed Bearer tokens for session and RBAC auth | `api-gateway/middleware/auth.js` |
| **Password Hashing** | `bcryptjs` | 3.0.2 | Salted one-way hashing (10 rounds) for user credentials | `api-gateway/models/User.js` |
| **Machine Learning** | Python / Flask | 3.0.3 | Microservice exposing ML inference endpoint `/predict` | `ml-service/app.py` |
| **ML Framework** | scikit-learn | 1.5.0 | Unsupervised multivariate **Isolation Forest** model | `ml-service/train_models.py` |
| **Numerical Processing**| NumPy / Pandas | 1.26.4 / 2.2.2 | Data array manipulation and feature extraction for inference | `ml-service/requirements.txt` |
| **Model Persistence**| Joblib | 1.4.2 | Serialization and loading of trained `.pkl` model artifacts | `ml-service/app.py` |
| **Frontend Core** | React / TypeScript | 19.1.1 / 5.9.3 | Component-based interactive UI with static typing | `frontend/package.json` |
| **Build Tooling** | Vite (rolldown-vite)| 7.1.14 | Hot-module replacement dev server and optimized bundler | `frontend/vite.config.ts` |
| **Styling Framework**| Tailwind CSS | 3.4.18 | Utility-first responsive dark-mode styling | `frontend/tailwind.config.js` |
| **Data Visualization**| Recharts | 3.3.0 | Real-time dual-axis time-series dynamic charting | `frontend/src/pages/DashboardPage.tsx` |
| **UI Notifications** | `react-hot-toast` | 2.6.0 | Toast notification popups for instant critical alert pushes | `frontend/src/pages/DashboardPage.tsx` |
| **Container Engine** | Docker / Compose | v29.1 / v5.0.1 | Multi-container orchestration and environment standardization | `docker-compose.yml` |

---

## 5. Repository Structure

The project is structured as a multi-tier monorepo:

```text
Health-Monitoring-Platform-main/
├── .env                              # Active environment configuration (git-ignored)
├── .env.example                      # Documented configuration template
├── .gitignore                        # Standardized ignore rules (preserves Dockerfiles)
├── docker-compose.yml                # Full orchestration across 9 services
├── README.md                         # Public repository presentation
├── EDGE_DEPLOYMENT_AND_HARDWARE_MANUAL.md # Raspberry Pi & serial modem setup guide
├── PROJECT_ANALYSIS_AND_RUN_MANUAL.md# Comprehensive operational manual
│
├── alert-engine/                     # Asynchronous Cloud Alert Worker
│   ├── index.js                      # Redis subscriber, anti-spam, MongoDB persistence
│   ├── package.json
│   └── Dockerfile                    # Node 20 Alpine container
│
├── api-gateway/                      # Central Ingestion & API Gateway
│   ├── index.js                      # Express app, Socket.io, Swagger setup, CORS
│   ├── middleware/
│   │   └── auth.js                   # JWT verification and user payload attachment
│   ├── models/
│   │   └── User.js                   # Mongoose schema, bcrypt pre-save hook
│   ├── routes/
│   │   ├── auth.js                   # POST /register, POST /login
│   │   ├── vitals.js                 # POST / (TimescaleDB insert, Redis publish)
│   │   ├── alerts.js                 # GET / (RBAC), GET /summary, GET /patients, PATCH /:id/ack
│   │   └── edge.js                   # POST /sync (idempotent), GET /status
│   ├── package.json
│   └── Dockerfile
│
├── device-simulator/                 # IoT Wearable Simulator
│   ├── index.js                      # Generates vitals every 5s (20% anomaly injection)
│   ├── package.json
│   └── Dockerfile
│
├── docs/                             # Engineering & Academic Documentation
│   ├── TECHNICAL_REPORT.md           # This comprehensive technical audit report
│   └── images/                       # High-resolution architectural and UI assets
│       ├── architecture_concept.png
│       ├── dashboard_patient_normal.png
│       ├── dashboard_patient_alert.png
│       └── terminal_logs_antispam.png
│
├── edge-gateway/                     # Autonomous Edge Service (Raspberry Pi compatible)
│   ├── config.js                     # Thresholds, timeouts, modem serial config
│   ├── index.js                      # Native HTTP server (:3001), pipeline coordinator
│   ├── engine/
│   │   ├── validator.js              # Freshness, schema, and boundary validation
│   │   ├── ruleEngine.js             # Transparent deterministic clinical heuristics
│   │   ├── healthMonitor.js          # Heartbeat tracking and sensor disconnection logic
│   │   └── localML.js                # Lightweight statistical multivariate Z-Score detector
│   ├── notification/
│   │   ├── notificationManager.js    # Immediate dispatch, anti-spam, exponential backoff
│   │   └── transports/
│   │       ├── baseTransport.js      # Abstract transport interface
│   │       ├── modemTransport.js     # Hayes AT serial cellular modem driver
│   │       └── mockTransport.js      # Deterministic test transport with failure injection
│   ├── storage/
│   │   └── database.js               # Embedded SQLite 3 manager (WAL mode)
│   ├── sync/
│   │   └── syncAgent.js              # Idempotent batch cloud synchronization agent
│   ├── test/
│   │   └── edge.test.js              # 9 automated verification tests (node:test)
│   ├── demo-offline.js               # Repeatable offline demonstration script
│   ├── package.json
│   └── Dockerfile                    # Node 22 Alpine container with persistent SQLite volume
│
├── frontend/                         # React Single-Page Application
│   ├── src/
│   │   ├── App.tsx                   # BrowserRouter, PrivateRoute, Toaster
│   │   ├── main.tsx                  # React DOM entry point
│   │   ├── index.css                 # Tailwind CSS utility imports
│   │   ├── components/
│   │   │   └── MetricCard.tsx        # Styled KPI card displaying value, unit, icon
│   │   └── pages/
│   │       ├── LoginPage.tsx         # Auth form with 1-click Demo credentials
│   │       ├── DashboardPage.tsx     # Patient portal (live Recharts & toasts)
│   │       └── DoctorDashboardPage.tsx # Supervision console (multi-patient triage, SMS audit)
│   ├── vite.config.ts                # Dev server host binding (:5173)
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile
│
├── init-db/
│   └── init-timescale.sql            # Hypertable initialization and spatial-temporal indexes
│
├── ml-service/                       # Python Machine Learning Inference Service
│   ├── app.py                        # Flask server (:5000), /predict, rules evaluation
│   ├── train_models.py               # Generates synthetic data, trains Isolation Forest
│   ├── requirements.txt
│   ├── models/
│   │   └── isolation_forest_v1.pkl   # Serialized model artifact
│   └── Dockerfile                    # Python 3.11 Slim container
│
└── scripts/
    └── seed-demo-user.js             # Seeds default Patient and Doctor accounts
```

---

## 6. Frontend Architecture

The frontend is built with **React 19.1.1** and **TypeScript**, styled via **Tailwind CSS**, and bundled with **Vite**.

### Routing and Protected Routes (`frontend/src/App.tsx`)
Navigation is managed through `react-router-dom` (v7.9.4):
- `/login`: Public authentication page ([`LoginPage.tsx`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/frontend/src/pages/LoginPage.tsx)).
- `/`: Protected Patient Dashboard ([`DashboardPage.tsx`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/frontend/src/pages/DashboardPage.tsx)).
- `/doctor`: Protected Doctor Supervision Console ([`DoctorDashboardPage.tsx`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/frontend/src/pages/DoctorDashboardPage.tsx)).

Access to protected routes is guarded by `PrivateRoute`:
```typescript
const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
};
```

### Patient Dashboard (`frontend/src/pages/DashboardPage.tsx`)
- **Metric Cards:** Uses [`MetricCard.tsx`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/frontend/src/components/MetricCard.tsx) to render immediate readouts for Heart Rate (bpm), Oxygen Saturation ($\text{SpO}_2$ %), and Blood Pressure (mmHg).
- **Dynamic Recharts Visualization:** Displays a sliding window of the last 20 measurements. Uses dual independent Y-axes: Left axis calibrated for Heart Rate ($[40, 200]\text{ bpm}$), Right axis calibrated for $\text{SpO}_2$ ($[70, 100]\%$) with animated transitions disabled for low-latency updates.
- **Push Toast Notifications:** Listens to the Socket.io `new_alert` event and displays high-visibility persistent red banners (`react-hot-toast`) for 6 seconds upon critical alert reception.

### Doctor Supervision Console (`frontend/src/pages/DoctorDashboardPage.tsx`)
The Doctor Dashboard provides advanced clinical triage:
- **Triage KPI Bar:** Real-time counters showing active monitored patients, active unacknowledged critical alerts, machine learning warnings, and pending local events.
- **Edge Gateway Connectivity Pill:** Displays live connectivity to edge devices (`Edge RPi: Connectée (Sync 17:32)` or `Edge RPi: Autonome`).
- **Multi-Patient Triage List:** Summarizes all monitored patients (`patient_001`), current biometrics, and severity status badges (`Critique` / `Stable`). Clicking a patient refocuses the real-time telemetry chart.
- **Clinical Alert Audit & Triage Table:** Displays historical and real-time alerts. Supports filtering by severity (`all`, `critical`, `warning`) and unacknowledged status.
- **Origin & SMS Delivery Badges:**
  - *Origin:* `Edge RPi` (purple badge) vs `Cloud` (blue badge).
  - *SMS Status:* `📱 SMS Transmis`, `🧪 SMS Mock`, `❌ SMS Échoué`, `⏳ Anti-Spam`.
  - *Dual Timestamps:* Displays event generation time and eventual cloud synchronization time.
  - *Action:* An interactive **"Acquitter"** button issuing a `PATCH /api/alerts/:id/ack` request to mark clinical review.

---

## 7. Backend Architecture & API Specifications

The central backend is orchestrated by `api-gateway`, an **Express 4.19.2** application functioning as a reverse proxy, security boundary, and ingestion router.

```mermaid
sequenceDiagram
    autonumber
    actor Patient as IoT Sensor
    participant GW as api-gateway (:3000)
    participant TS as TimescaleDB (:5432)
    participant RD as Redis Pub/Sub (:6379)
    participant AE as alert-engine
    participant ML as ml-service (:5000)
    participant MG as MongoDB (:27017)
    actor Doctor as Doctor Dashboard

    Patient->>GW: POST /api/vitals { patientId, vitals }
    GW->>TS: INSERT INTO vital_signs
    GW->>RD: PUBLISH vitals-channel (JSON payload)
    GW-->>Patient: 200 OK { message: 'stored and published' }

    par Real-Time Client Update
        GW-->>Doctor: WebSocket Emit 'vital_update'
    and Asynchronous Alert Evaluation
        RD-->>AE: Message Received on vitals-channel
        AE->>ML: POST /predict { vitals }
        ML-->>AE: { is_anomaly: true, rules_triggered: ['critical_tachycardia'] }
        AE->>AE: Check In-Memory Anti-Spam (5 min debounce)
        alt Not Spammed
            AE->>MG: Save Alert Document (Severity: critical)
            AE->>RD: PUBLISH alerts-channel (Alert JSON)
            RD-->>GW: Message Received on alerts-channel
            GW-->>Doctor: WebSocket Emit 'new_alert' (Sound/Toast)
        else Spammed
            AE->>AE: Suppress alert (Log Anti-Spam Block)
        end
    end
```

### Verified API Endpoints

| HTTP Method | Endpoint Route | Request Body / Query | Headers Required | Access / RBAC | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | None | None | Public | Health check / Welcome string |
| `GET` | `/api-docs` | None | None | Public | Interactive Swagger UI documentation |
| `POST` | `/api/auth/register` | `{ email, password, firstName, lastName, role }` | Content-Type: json | Public | Registers a new user with bcrypt-hashed password |
| `POST` | `/api/auth/login` | `{ email, password }` | Content-Type: json | Public | Authenticates user and returns 24h JWT Bearer token |
| `GET` | `/api/users/me` | None | `Authorization: Bearer <token>` | Authenticated | Retrieves current authenticated profile (excluding password) |
| `POST` | `/api/vitals` | `{ patientId, deviceId, timestamp, vitals }` | Content-Type: json | Public / Device | Ingests telemetry, inserts into TimescaleDB, publishes to Redis |
| `GET` | `/api/alerts` | Query: `?patientId=&severity=&acknowledged=&limit=` | `Authorization: Bearer <token>` | Patient (own only) / Doctor (all) | Retrieves alert records with RBAC patient data isolation |
| `GET` | `/api/alerts/summary`| None | `Authorization: Bearer <token>` | Patient (own) / Doctor (all) | Returns aggregate crisis statistics (critical, warning, unacked) |
| `GET` | `/api/alerts/patients`| None | `Authorization: Bearer <token>` | Doctor / Admin only | Returns list of patients with latest biometrics and alert counts |
| `PATCH`| `/api/alerts/:id/ack`| None | `Authorization: Bearer <token>` | Authenticated Doctor | Acknowledges an alert (`isAcknowledged = true`) |
| `POST` | `/api/edge/sync` | `{ gatewayId, alerts: [], measurements: [] }` | `X-Gateway-Key: <key>` | Edge Gateway | Idempotent batch insertion of offline alerts and measurements |
| `GET` | `/api/edge/status` | None | None | Public / Doctor | Returns registered edge gateways, last sync time, and health |

---

## 8. Database Design & Polyglot Persistence

The system uses three purpose-built database engines:

```mermaid
erDiagram
    USERS {
        ObjectId _id PK
        string email UK
        string password
        string role "patient | doctor | admin"
        object profile
        date createdAt
    }

    VITAL_SIGNS {
        timestamptz time PK
        varchar patient_id
        varchar device_id
        integer heart_rate
        integer spo2
        integer systolic
        integer diastolic
    }

    ALERTS {
        ObjectId _id PK
        string eventId UK
        string patientId
        string deviceId
        string gatewayId
        string type
        string severity "info | warning | critical"
        string message
        object metrics
        string detectionMethod
        string deliveryStatus
        boolean detectedOffline
        boolean isAcknowledged
        date eventTimestamp
        date syncedAt
    }

    USERS ||--o{ ALERTS : "supervised by / belongs to"
    USERS ||--o{ VITAL_SIGNS : "generates"
```

### 1. TimescaleDB (PostgreSQL 16 Engine)
- **Table:** `vital_signs`
- **Schema DDL:**
  ```sql
  CREATE TABLE IF NOT EXISTS vital_signs (
      time TIMESTAMPTZ NOT NULL,
      patient_id VARCHAR(50) NOT NULL,
      device_id VARCHAR(50),
      heart_rate INTEGER,
      spo2 INTEGER,
      systolic INTEGER,
      diastolic INTEGER
  );
  SELECT create_hypertable('vital_signs', 'time', if_not_exists => TRUE);
  CREATE INDEX IF NOT EXISTS idx_vital_signs_patient_time ON vital_signs (patient_id, time DESC);
  ```
- **Rationale:** Automatic partitioning into temporal chunks allows real-time write rates without index degradation, facilitating fast historical downsampling and analytic queries.

### 2. MongoDB 7 (Document Engine)
- **Collection `users`:** Manages identity, credentials, roles (`patient`, `doctor`, `admin`), and profile metadata.
- **Collection `alerts`:** Stores clinical alert documents containing full physiological snapshots (`metrics`), severity levels, edge detection metadata, and acknowledgment flags.

### 3. SQLite 3 (Edge Embedded Database)
- **Mode:** `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`
- **Tables:**
  - `measurements`: Buffers incoming vital readings with `is_synced` status flags.
  - `local_alerts`: Stores structured alert events indexed by UUID v4 `event_id`.
  - `sms_delivery_attempts`: Audit trail recording each cellular transmission attempt, error codes, and timestamps.
  - `sensor_states`: Heartbeat registry tracking device freshness and disconnection states.

---

## 9. Authentication, Authorization, and Data Protection

### Credential Handling & Password Storage
- Passwords are encrypted before database insertion using **bcrypt** with a work factor of 10 (`bcrypt.genSalt(10)`).
- The Mongoose `User` schema sets `password: { select: false }`, ensuring hashes are excluded from query results unless explicitly requested via `.select('+password')`.

### Token-Based Authentication
- Upon authentication (`POST /api/auth/login`), the server issues an industry-standard **JSON Web Token (JWT)** signed with `HMAC-SHA256` using the server secret `JWT_SECRET`.
- Tokens encode the user identifier and role (`{ user: { id, role } }`) with a 24-hour expiration window.
- The client provides this token via the HTTP header `Authorization: Bearer <token>`.

### Role-Based Access Control (RBAC) & Patient Isolation
Access control is enforced in [`api-gateway/routes/alerts.js`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/api-gateway/routes/alerts.js):
- **Doctor / Admin Role:** Granted access to global crisis summaries, multi-patient lists, and full telemetry inspection.
- **Patient Role:** Strict patient data isolation is enforced. If a user with role `patient` queries `/api/alerts` with another patient's identifier (`?patientId=patient_999`), the server rejects the request with **HTTP 403 Forbidden**:
  ```javascript
  if (req.user.role === 'patient') {
    const allowed = req.user.patientId || req.user.id || 'patient_001';
    if (patientId && patientId !== allowed) {
      return res.status(403).json({ message: 'Accès refusé : Dossier médical non autorisé.' });
    }
    filter.patientId = allowed;
  }
  ```

---

## 10. IoMT Measurement Pipeline

### Data Generation & Simulation
- Physiological vitals are generated by [`device-simulator/index.js`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/device-simulator/index.js).
- Measurements are simulated for `patientId: 'patient_001'` and `deviceId: 'smartwatch_123'` every 5,000 milliseconds.
- **Nominal Operating Ranges:**
  - Heart Rate: 60 to 100 bpm (uniform distribution).
  - Oxygen Saturation ($\text{SpO}_2$): 95% to 100%.
  - Blood Pressure: Systolic 110–140 mmHg, Diastolic 70–90 mmHg.
- **Anomaly Injection Mechanism:**
  - With a 20% probability (`Math.random() < 0.2`), the simulator forces an acute crisis:
    - `heartRate = 160 bpm` (Critical Tachycardia)
    - `spo2 = 88%` (Severe Hypoxia)

### Ingestion Validation & Normalization
Upon arrival at the Edge Gateway ([`edge-gateway/engine/validator.js`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/edge-gateway/engine/validator.js)), data undergoes four verification steps:
1. **Schema Check:** Verifies presence of `patientId`, `deviceId`, `timestamp`, and `vitals`.
2. **Clock Skew Check:** Rejects packets with timestamps exceeding 60 seconds into the future.
3. **Stale Data Check:** Evaluates freshness; packets older than 30 seconds are flagged (`isStale: true`).
4. **Physiological Feasibility Bounds:** Validates that measurements fall within biological plausibility ($0 \le HR \le 300\text{ bpm}$, $0 \le \text{SpO}_2 \le 100\%$, $20 \le Sys \le 320\text{ mmHg}$). Aberrant out-of-bounds readings return HTTP 400.

---

## 11. Edge Computing and Anomaly Detection

### Edge Heuristic Engine (`edge-gateway/engine/ruleEngine.js`)
Detection on the Raspberry Pi Edge Gateway relies on deterministic, transparent clinical threshold rules that evaluate in $< 1\text{ ms}$ with zero cloud or GPU requirements:

| Clinical Condition | Monitored Metric | Configured Threshold | Assigned Severity |
| :--- | :--- | :--- | :--- |
| **Critical Bradycardia** | Heart Rate | $< 40\text{ bpm}$ | `critical` |
| **Critical Tachycardia** | Heart Rate | $> 150\text{ bpm}$ | `critical` |
| **Severe Hypoxia** | $\text{SpO}_2$ Saturation | $< 90\%$ | `critical` |
| **Acute Hypotension** | Systolic Pressure | $< 90\text{ mmHg}$ | `critical` |
| **Hypertensive Crisis** | Systolic Pressure | $> 180\text{ mmHg}$ | `critical` |

### Sensor Disconnection vs Physiological Emergency (`healthMonitor.js`)
The `SensorHealthMonitor` records device heartbeats. If a sensor stops transmitting for more than 20 seconds:
- Status transitions from `ONLINE` to `DISCONNECTED`.
- Generates an alert with `type: 'sensor_disconnected'` and `severity: 'warning'`.
- Reason string: *"Perte de signal du capteur. Ce statut matériel n'implique pas à lui seul une urgence clinique."*
- **Explicit Design Requirement:** Hardware failure is decoupled from vital emergencies.

### Local Lightweight ML Component (`localML.js`)
When enabled (`ENABLE_LOCAL_ML=true`), the edge gateway evaluates a sliding window of the last 10 biometric tuples, calculating running mean and standard deviation:
$$Z = \frac{|x - \mu|}{\sigma}$$
If $Z \ge 3.0$ on any metric without exceeding hard clinical thresholds, an early-warning anomaly `local_ml_statistical_anomaly` is raised.

### Cloud Inference Service (`ml-service/app.py`)
In the central backend, `ml-service` executes a trained **Isolation Forest** model:
- **Features:** 3-dimensional array `[heartRate, spo2, systolic]`.
- **Contamination Factor:** $0.1$ (10%).
- **Prediction:** Returns `-1` for multivariate anomalies; combined with deterministic clinical checks in Python.

---

## 12. Autonomous Alerting and Direct SMS Delivery

### End-to-End Autonomous Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Sensor as Medical Sensor
    participant Edge as Edge Gateway (:3001)
    participant DB as Local SQLite (WAL)
    participant NM as Notification Manager
    participant Modem as Cellular Modem (AT Driver)
    actor Doctor as Doctor Handset (Cellular)

    Note over Sensor,Doctor: Complete Cloud Backend & Internet Outage (Offline)

    Sensor->>Edge: POST /api/vitals (HR=162, SpO2=86)
    Edge->>Edge: Validate Schema & Freshness
    Edge->>DB: INSERT INTO measurements
    Edge->>Edge: Evaluate Clinical Rules -> Anomaly: Tachycardia + Hypoxia
    Edge->>DB: INSERT INTO local_alerts (eventId: UUID, status: 'pending')
    
    Edge->>NM: dispatchAlert(alert)
    NM->>DB: Check Anti-Spam (getRecentAlert within 5 min)
    
    alt Is Within 5 min Window
        NM->>DB: UPDATE local_alerts SET deliveryStatus = 'debounced'
        NM-->>Edge: Alert Debounced (SMS Suppressed)
    else First Occurrence
        loop Retries with Exponential Backoff (1s, 2s, 4s - Max 3)
            NM->>Modem: sendSms("+336...", MessageBody)
            Modem->>Modem: AT+CMGF=1 \r -> OK
            Modem->>Modem: AT+CMGS="+33..." \r -> > Message \x1A
            Modem-->>NM: +CMGS: Ref42 -> accepted_by_modem
            NM->>DB: INSERT INTO sms_delivery_attempts (status: 'accepted_by_modem')
        end
        NM->>DB: UPDATE local_alerts SET deliveryStatus = 'accepted_by_modem'
        Modem-->>Doctor: 📱 Cellular SMS Transmission
    end
```

### Modular Driver Implementation
1. **`SerialModemSmsTransport` ([`modemTransport.js`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/edge-gateway/notification/transports/modemTransport.js)):**
   - Connects to hardware serial interfaces (e.g., `/dev/ttyUSB0` or `COM3` at 115,200 baud).
   - Issues Hayes AT commands conforming to 3GPP standards.
   - Enforces a 160-character compact ASCII payload to avoid multi-part PDU fragmentation.
2. **`MockSmsTransport` ([`mockTransport.js`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/edge-gateway/notification/transports/mockTransport.js)):**
   - In-memory mock used for unit tests and local Docker development where serial modems are absent.
   - Distinctly labels records as `accepted_by_mock_transport` to ensure simulated tests are never misrepresented as real cellular delivery.

### Delivery Semantics & Failure States
- `pending`: Event created locally; transmission unattempted.
- `attempted`: Command issued to modem; awaiting BTS acknowledgment.
- `accepted_by_modem`: Base Transceiver Station accepted SMS for cellular transmission.  
  *(Crucial distinction: Submission to modem does not equal confirmed delivery to physical handset).*
- `accepted_by_mock_transport`: Validated in automated test/dev mode.
- `debounced`: Suppressed by the 5-minute anti-spam window to avoid flooding caregivers.
- `failed`: Terminal failure following 3 exhausted retries (e.g., no cellular coverage).

---

## 13. Offline Operation and Idempotent Synchronization

### Eventual Consistency Pipeline
When the network link between the Edge Gateway and the Central Backend drops, the Edge Gateway enters autonomous offline mode:
1. All vital signs are stored in SQLite `measurements` (`is_synced = 0`).
2. Generated alerts and cellular dispatch attempts are stored in SQLite `local_alerts` (`is_synced = 0`).

```mermaid
sequenceDiagram
    autonumber
    participant Edge as Edge Gateway (SQLite)
    participant Sync as SyncAgent (:3001)
    participant Cloud as Cloud API Gateway (:3000)
    participant TS as TimescaleDB
    participant MG as MongoDB
    actor DocUI as Doctor Dashboard

    Note over Edge,DocUI: Internet Restored / Backend Reconnected

    Sync->>Sync: Probe Cloud: GET http://api-gateway:3000/
    Sync->>Edge: Query getUnsyncedAlerts(50) & getUnsyncedMeasurements(100)
    Sync->>Cloud: POST /api/edge/sync { gatewayId, alerts, measurements } (X-Gateway-Key)
    
    Cloud->>TS: INSERT INTO vital_signs (original timestamps) ON CONFLICT DO NOTHING
    loop For Each Alert
        Cloud->>MG: findOne({ eventId })
        alt Not Found
            Cloud->>MG: Insert Alert (detectedOffline: true, syncedAt: NOW)
            Cloud-->>DocUI: WebSocket Emit 'new_alert' (Badge: Edge RPi)
        else Found
            Cloud->>MG: Update acknowledgment if modified
        end
    end
    
    Cloud-->>Sync: 200 OK { success: true, syncedEventIds: [...], syncedMeasurementIds: [...] }
    Sync->>Edge: UPDATE local_alerts SET is_synced = 1, synced_at = NOW
    Sync->>Edge: UPDATE measurements SET is_synced = 1, synced_at = NOW
```

### Idempotency Guarantees
- **Alert Deduplication:** Every local alert is assigned a UUID v4 `eventId` upon creation. Central MongoDB upserts match on `eventId`. Syncing the same batch multiple times produces zero duplicate alerts.
- **Time-Series Integrity:** Measurements are committed to TimescaleDB using the original sensor timestamp recorded at the edge, ensuring accurate historical curves rather than skewed synchronization times.

---

## 14. Deployment Infrastructure & Raspberry Pi Setup

### Multi-Container Topology (`docker-compose.yml`)

The multi-container stack runs 9 services:

| Container Service | Base Image | Ports Exposed | Volume Mounts | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **`health-frontend`** | `node:20-alpine` | `5173:5173` | None | React/Vite development server |
| **`health-edge-gateway`**| `node:22-alpine`| `3001:3001` | `edge_data:/app/data` | Autonomous edge gateway & SQLite store |
| **`health-api-gateway`** | `node:20-alpine` | `3000:3000` | None | Central Express API, WebSockets, Swagger |
| **`health-alert-engine`**| `node:20-alpine` | Internal | None | Redis alert consumer & deduplicator |
| **`health-device-simulator`**| `node:20-alpine`| Internal | None | Synthetic biometric generator |
| **`health-ml-service`** | `python:3.11-slim`| `5000:5000` | None | Flask Isolation Forest inference engine |
| **`health-timescaledb`** | `timescale/timescaledb:latest-pg16` | `5432:5432` | `timescale_data`, `./init-db` | TimescaleDB hypertable engine |
| **`health-mongo`** | `mongo:7` | `27017:27017` | `mongo_data:/data/db` | MongoDB document store |
| **`health-redis`** | `redis:7-alpine` | `6379:6379` | `redis_data:/data` | In-memory Pub/Sub broker |

### Safe Environment Variable Specification (`.env.example`)

```ini
# Core Ports
PORT=3000
EDGE_PORT=3001

# Database Connections
MONGO_URI=mongodb://mongo:27017/healthdb
DB_HOST=timescaledb
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=timescale
PG_CONN=postgresql://postgres:postgres@timescaledb:5432/timescale
REDIS_URI=redis://redis:6379

# Security Tokens
JWT_SECRET=supersecretjwtkeypfe2025
EDGE_SYNC_API_KEY=edge_secret_token_pfe_2026

# Microservice Endpoints
ML_SERVICE_URL=http://ml-service:5000/predict
CENTRAL_BACKEND_URL=http://api-gateway:3000

# Edge & Cellular Modem Configuration
EDGE_GATEWAY_ID=edge_rpi_gateway_01
SMS_TRANSPORT=mock                  # Change to 'modem' for real hardware
MODEM_SERIAL_PORT=/dev/ttyUSB0       # COM3 on Windows, /dev/ttyUSB0 on Linux
MODEM_BAUD_RATE=115200
DOCTOR_PHONE_NUMBER=+33600000000     # Verified recipient number
```

### Raspberry Pi Deployment Summary
Full hardware setup instructions are documented in [`EDGE_DEPLOYMENT_AND_HARDWARE_MANUAL.md`](file:///c:/Users/barae/OneDrive/Documents/pfe/Health-Monitoring-Platform-main/EDGE_DEPLOYMENT_AND_HARDWARE_MANUAL.md):
- **Hardware:** Raspberry Pi 4B/5 + Quectel EC25 / Huawei E3372 USB Modem.
- **Serial Permissions:** `sudo usermod -a -G dialout $USER`.
- **Systemd Daemon:** Managed via `/etc/systemd/system/edge-gateway.service` with auto-restart on boot.

---

## 15. Testing, Verification, and Observed Results

### Automated Test Suite Execution
Tests were run natively via the command:
```bash
node --test edge-gateway/test/edge.test.js
```

### Observed Execution Log
```text
(node:46404) ExperimentalWarning: SQLite is an experimental feature and might change at any time
✔ 1. Configured anomaly triggers a local alert without a backend request (9.20ms)
✔ 2. Mock SMS transport is invoked while the backend is offline (28.97ms)
✔ 3. The event persists after a service restart (4.93ms)
✔ 4. Repeated abnormal measurements do not cause uncontrolled SMS flooding (25.77ms)
✔ 5. Failed SMS attempts are retried according to policy (95.36ms)
✔ 6. Cellular delivery failure is distinct from successful delivery (92.45ms)
✔ 7. Events synchronize after the backend reconnects without duplicates (28.97ms)
✔ 8. Sensor disconnection is reported separately from medical emergencies (3.63ms)
✔ 9. Unauthorized users cannot access another patient's information (30.30ms)

ℹ tests 9 | pass 9 | fail 0 | duration_ms 421.98ms
```

### Verification Matrix

| Test ID | Verified Invariant | Methodology | Observed Result |
| :--- | :--- | :--- | :--- |
| **TEST-01** | Local Detection Independence | Fed $HR=165\text{ bpm}$ with mock backend URL disconnected | Alert generated and persisted in SQLite; zero cloud network calls |
| **TEST-02** | Direct SMS Invocation | Triggered hypoxia ($\text{SpO}_2=85\%$) with offline backend | `MockSmsTransport` received formatted text with ID within $30\text{ ms}$ |
| **TEST-03** | Service Restart Survival | Closed DB instance, re-instantiated from disk file, queried by UUID | Record returned intact with identical timestamps and payload |
| **TEST-04** | Anti-Spam Deduplication | Injected identical crisis $5\text{ s}$ after initial dispatch | Second event marked `debounced`; SMS counter remained strictly at 1 |
| **TEST-05** | Exponential Backoff Retry | Simulated 2 hardware modem failures followed by success | Attempt audit records 3 entries ($10\text{ms}, 20\text{ms}$ delays); state `accepted` |
| **TEST-06** | Distinct Cellular Failure | Simulated persistent network outage (`NO_CELLULAR_CARRIER`) | Terminal state set to `failed`; cleanly distinguished from `accepted_by_modem` |
| **TEST-07** | Idempotent Cloud Sync | Spun up local HTTP server; synced 2 alerts, triggered sync again | Batch 1 uploaded 2 alerts; Batch 2 sent 0 records (no duplicates) |
| **TEST-08** | Sensor Disconnection Logic | Advanced device clock $40\text{ s}$ past heartbeat window | Alert created with `sensor_disconnected` and `warning` (not cardiac arrest) |
| **TEST-09** | Patient RBAC Privacy Isolation | Sent request for `patient_999` using `patient_001` JWT Bearer token | API rejected request with **HTTP 403 Forbidden** |

---

## 16. Security, Reliability, and Failure Analysis

### Failure Mode & Effects Analysis (FMEA)

| Failure Scenario | Immediate System Impact | Automated Mitigation Implemented | Residual Risk / Limitation |
| :--- | :--- | :--- | :--- |
| **Internet Loss** | Cloud dashboard disconnects | Edge Gateway continues local rule evaluation, SQLite persistence, and SMS dispatch | Central hospital dashboard is blind until link restoration |
| **Cloud Crash** | Central backend stops | Edge Gateway buffers telemetry and alerts locally without process termination | Historical deep analytics unavailable at edge |
| **Cellular Signal Loss** | SMS cannot be transmitted | Edge Gateway attempts 3 retries with backoff, sets status to `failed`, logs audit trace | Remote caregiver cannot be alerted via cellular without signal |
| **Modem Unplugged** | Serial port missing | `SerialModemSmsTransport` catches missing path, records `failed` in SQLite | Hardware repair required |
| **Sensor Silence** | No biometric data | `SensorHealthMonitor` triggers `sensor_disconnected` alert after 20s | Cannot distinguish dead battery from loose electrode |
| **Power Outage** | Gateway shuts down | SQLite WAL mode guarantees zero database corruption; systemd auto-restarts | Monitoring interrupted during power loss unless backed by UPS |
| **Reconnection Spike**| Dense backlog of records | `SyncAgent` syncs in bounded chunks (50 alerts, 100 vitals) using idempotent upserts | High initial bandwidth consumption |

---

## 17. Known Limitations and Future Improvements

### Verified Current Limitations
1. **SMS Transport in Default Container:** Operates in `SMS_TRANSPORT=mock` within standard Docker Compose to enable local reproduction without physical USB modems attached. Real cellular testing requires physical modem hardware.
2. **Delivery Confirmation Ceiling:** Cellular networks confirm submission to the Base Transceiver Station (`+CMGS: <mr>`), which is distinct from guaranteed delivery to the doctor's hand.
3. **Sensor Pairing Layer:** Simulator communicates via HTTP; real production deployments require Bluetooth Low Energy (BLE) or Zigbee medical protocol drivers.

### Potential Research Extensions (Future Work)
- **Distributed Edge Anti-Spam via Redis Cluster:** Sharing deduplication state across multiple physical gateways within the same ward.
- **Deep Learning Sequence Modeling:** Deploying quantized ONNX/TensorFlow Lite LSTM models to predict physiological deterioration 30 minutes before acute threshold crossing.
- **Biometric Encryption at Rest:** Implementing SQLCipher for AES-256 transparent database encryption of local SQLite stores on the Raspberry Pi.

---

## 18. Conclusion

This project successfully demonstrates an **autonomous, fault-tolerant edge remote patient monitoring architecture**. By shifting the initial critical alert decision and cellular notification mechanism to a local edge node, the platform eliminates reliance on central cloud availability for life-critical notifications. The combination of polyglot persistence, idempotent eventual consistency, and role-based privacy protection creates a robust, production-ready foundation for modern IoMT applications.

---

## 19. References

1. **TimescaleDB Architecture:** [https://docs.timescale.com/use-timescale/latest/hypertables/](https://docs.timescale.com/use-timescale/latest/hypertables/)
2. **MongoDB Manual & Document Validation:** [https://www.mongodb.com/docs/manual/core/document-validation/](https://www.mongodb.com/docs/manual/core/document-validation/)
3. **Redis Pub/Sub Specification:** [https://redis.io/docs/latest/develop/interact/pubsub/](https://redis.io/docs/latest/develop/interact/pubsub/)
4. **3GPP TS 27.005 / TS 27.007 AT Command Set:** [https://www.3gpp.org/specifications-technologies/propositions-for-specifications](https://www.3gpp.org/specifications-technologies/propositions-for-specifications)
5. **scikit-learn Isolation Forest:** Liu, F. T., Ting, K. M., & Zhou, Z. H. (2008). *Isolation Forest*. ICDM. [https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html)
6. **SQLite Write-Ahead Logging:** [https://www.sqlite.org/wal.html](https://www.sqlite.org/wal.html)
7. **Socket.io Real-time Specification:** [https://socket.io/docs/v4/](https://socket.io/docs/v4/)
8. **React Documentation:** [https://react.dev/](https://react.dev/)
