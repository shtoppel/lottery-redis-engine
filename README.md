<div align="center">

# 🎰 Lottery Higload Engine
**High-performance backend experiment: FastAPI + Redis + Lua**

[![Python](https://img.shields.io/badge/Python-3.14-blue?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-v0.110+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Redis](https://img.shields.io/badge/Redis-v7.2-dc382d?style=flat-square&logo=redis&logoColor=white)](https://redis.io/)
[![Locust](https://img.shields.io/badge/Load_Testing-Locust-7eb140?style=flat-square&logo=python&logoColor=white)](https://locust.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)

[🇬🇧 English](#english) | [🇩🇪 Deutsch](#deutsch) | [🚀 Quick Start](#setup)

---

</div>

## 🇬🇧 English <a name="english"></a>

### Overview
This project simulates a lottery engine where thousands of users check and claim tickets simultaneously. It serves as a practical laboratory for studying **concurrency**, **atomicity**, and **system bottlenecks**.

### 🛠 Tech Stack
- **Backend:** Python 3.14, FastAPI
- **Storage:** Redis (using Lua scripts for atomicity)
- **Load Testing:** Locust
- **Frontend:** JavaScript (WebSocket UI for real-time logs)
- **Infrastructure:** Docker, Docker Compose

### 🚀 Key Demonstrations
* **Race Conditions:** Visualizing how "check-then-set" logic fails under load.
* **Atomic Operations:** Using Redis Lua scripts to ensure data consistency.
* **Load Analysis:** Measuring RPS, Latency, and Failure Rates via Locust.
* **Optimization:** Implementing connection pooling and local caching.

---

## 🇩🇪 Deutsch <a name="deutsch"></a>

### Übersicht
Dieses Projekt simuliert eine Lottery-Engine, bei der tausende Benutzer gleichzeitig Tickets prüfen und einlösen. Es dient als praktisches Experimentierfeld für **Nebenläufigkeit (Concurrency)**, **Atomarität** und **System-Engpässe**.

### 🛠 Tech Stack
- **Backend:** Python 3.14, FastAPI
- **Datenbank:** Redis (Lua-Skripte für Atomarität)
- **Lasttests:** Locust
- **Frontend:** JavaScript (WebSocket UI für Echtzeit-Logs)
- **Infrastruktur:** Docker, Docker Compose

### 🚀 Was das Projekt zeigt
* **Race Conditions:** Veranschaulichung, wie "Check-then-Set"-Logik unter Last versagt.
* **Atomare Operationen:** Einsatz von Redis Lua-Skripten zur Gewährleistung der Datenkonsistenz.
* **Lastanalyse:** Messung von RPS, Latenz und Fehlerraten über Locust.

---

## 🔧 Installation & Running <a name="setup"></a>

1. **Clone the repository:**

   ```bash
   git clone [https://github.com/kirill/lottery-redis-engine](https://github.com/kirill/lottery-redis-engine)
   cd lottery-redis-engine

 2. **Run with Docker:**

   ```bash
       docker-compose up --build
   ```

**🎯 Purpose:**

Created as part of my Fachinformatiker für Anwendungsentwicklung training. This project focuses on "learning by doing" — understanding how backend systems survive (or fail) under extreme pressure.
