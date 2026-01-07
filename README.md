## Laptop Tracking System

This project is a minimal end‑to‑end example of a **laptop tracking system** with:

- **Backend API** (`backend/`) – receives location updates and serves data to the dashboard.
- **Web dashboard** (`web/`) – admin can log in, pick department and employee, and see the last known location on a map.
- **Windows client** (`client/TrackerClient/`) – a C# app that runs on laptops and periodically sends their location to the backend.

> Note: Most laptops do **not** expose a true GPS chip. This sample leaves the location acquisition as a stub you can connect to Windows Location API or an IP/Wi‑Fi geolocation service.

---

## 1. Prerequisites

- **Backend & Web**
  - Node.js 18+ and npm
  - Internet access (for map tiles via OpenStreetMap/Leaflet)
- **Windows Client**
  - Windows 10 or later
  - .NET 8 SDK (you can also change `TargetFramework` to a lower version if needed)

---

## 2. Backend setup (`backend/`)

### 2.1 Install dependencies

```bash
cd backend
npm install
```

### 2.2 Configure environment

Copy `.env.example` to `.env` and adjust values if needed:

```bash
cp .env.example .env
```

Defaults:

- `PORT=4000`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=admin123`

> Never use these defaults in production; change to strong secrets.

### 2.3 Run database migrations (auto‑create)

The first run of the server will auto‑create a SQLite file `tracker.db` and seed:

- Departments: HR, ICT, ADMIN, Commercial, Merchandising, Audit, Account, Supplychain
- Example employees with codes like `E1001`, `E1002`, …

### 2.4 Start backend

```bash
cd backend
npm start
```

The API will be available at `http://localhost:4000`.

---

## 3. Web dashboard (`web/`)

This is a minimal HTML + JavaScript dashboard that talks to the backend API and uses **Leaflet** for maps.

### 3.1 Configure backend URL (optional)

In `web/app.js`, the default API base is:

```js
const API_BASE = 'http://localhost:4000/api';
```

If you host the backend on a server, change this to your server URL.

### 3.2 Open the dashboard

You can open `web/index.html` directly in a browser, or serve it with any simple static file server.

Example (from project root, using Node’s `http-server` if you have it):

```bash
npm install -g http-server
cd web
http-server -p 8080
```

Dashboard: `http://localhost:8080`

**Login credentials** (from `.env`):

- Username: `admin`
- Password: `admin123`

---

## 4. Windows client (`client/TrackerClient/`)

### 4.1 Build the client

```bash
cd client/TrackerClient
dotnet restore
dotnet build -c Release
```

The compiled `.exe` will be under:

- `client/TrackerClient/bin/Release/net8.0/TrackerClient.exe`

### 4.2 Configure the client

Edit `appsettings.json`:

- `BackendBaseUrl`: the base URL of your backend (e.g. `http://your-server:4000/api`)
- `EmployeeCode`: code for the employee using this laptop (e.g. `E1001`)
- `ClientToken`: simple shared token that must match `CLIENT_TOKEN` in backend `.env`

### 4.3 Run on a laptop

1. Copy the built `TrackerClient.exe` and `appsettings.json` to the laptop  
   (e.g. `C:\Program Files\YourCompany\LaptopTracker\`).
2. Open **PowerShell as Administrator**.
3. Test run (you should see log lines):

   ```powershell
   cd "C:\Program Files\YourCompany\LaptopTracker"
   .\TrackerClient.exe
   ```

4. To run automatically at startup, simplest option is a **Scheduled Task**:
   - Open **Task Scheduler** → **Create Task**
   - **General**: run whether user is logged on or not, run with highest privileges
   - **Triggers**: At startup
   - **Actions**: Start a program → point to `TrackerClient.exe`

You can later convert this console app into a proper Windows Service if desired.

---

## 5. Basic workflow

- IT deploys backend on a server reachable from employee laptops.
- IT deploys the web dashboard (can be same server as backend, served statically).
- IT builds and installs the Windows client on each laptop and configures `EmployeeCode` correctly.
- Each laptop periodically sends location updates to the backend.
- Admin opens the dashboard, logs in, selects:
  - **Department → Employee**
  - Sees the last known location on the map.

---

## 6. Important notes

- **Location acquisition** in the client is intentionally left as a stub (`GetCurrentLocationAsync`):  
  you must plug in your own method (Windows Location API, Wi‑Fi/IP geolocation, external GPS dongle, etc.).
- This sample is **not production hardened**:
  - No SSL termination, no rate limiting, no full access control.
  - Admin credentials are static.
  - Client auth is a shared token.

Use this as a **starting point** and harden it for real‑world use.


