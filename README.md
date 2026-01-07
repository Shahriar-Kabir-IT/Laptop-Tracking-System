# 🛰️ Laptop Tracker

> **A lightweight, end-to-end solution for real-time corporate asset tracking.**

**Laptop Tracker** is a comprehensive system designed for IT administrators to monitor the location of company laptops. It features a silent Windows background agent that reports location data to a central server, visualized on an interactive web dashboard.

## ✨ Key Features

- **📍 Real-Time Location**: Periodically captures latitude/longitude (via Windows Location API or IP geolocation stubs).
- **🗺️ Interactive Dashboard**: View all employee locations on a dynamic map using Leaflet & OpenStreetMap.
- **👥 Employee & Department Management**: Organize devices by hierarchy; supports auto-provisioning of new devices.
- **🔋 Lightweight Client**: Unobtrusive .NET background service optimized for minimal battery and CPU usage.
- **🛡️ Basic Security**: Token-based authentication for devices and password-protected admin access.
- **💾 Zero-Config Database**: Uses SQLite for instant setup without external database dependencies.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js, SQLite
- **Frontend**: HTML5, CSS3, Vanilla JavaScript, Leaflet.js
- **Client**: .NET 8 (C#)
- **Deployment**: Inno Setup, PowerShell

---

## 📂 Project Structure

```text
├── backend/            # Node.js API server and database
├── web/                # Admin dashboard (static files)
├── installer/          # Installation scripts and Inno Setup files
└── client/             # Windows client source code (C#)
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- **.NET 8 SDK** (for building the client)
- **Windows 10/11** (for the client application)

### 1️⃣ Backend Setup

1.  Navigate to the backend directory and install dependencies:
    ```bash
    cd backend
    npm install
    ```

2.  Configure environment variables:
    ```bash
    cp .env.example .env
    ```
    > **Note:** Update `ADMIN_PASSWORD` and `JWT_SECRET` in `.env` for security.

3.  Start the server:
    ```bash
    npm start
    ```
    The API will run at `http://localhost:4000`. The database (`tracker.db`) is created automatically.

### 2️⃣ Web Dashboard

The dashboard is served statically. You can host it via the backend or separately.

-   **Access**: `http://localhost:4000` (served by backend)
-   **Default Login**:
    -   Username: `admin`
    -   Password: `admin123`

### 3️⃣ Windows Client

The client runs on employee laptops to send location updates.

1.  **Build the Client**:
    ```bash
    cd client/TrackerClient
    dotnet publish -c Release -r win-x64 --self-contained
    ```

2.  **Configure**:
    Update `appsettings.json` with your backend URL and client token.

3.  **Deploy**:
    Run the generated `.exe` or use the provided **Installer** script (`installer/install.ps1`) to set it up as a Scheduled Task.

---

## ⚙️ Configuration

| Component | File | Description |
| :--- | :--- | :--- |
| **Backend** | `.env` | Port, Secrets, Database path |
| **Client** | `appsettings.json` | API Endpoint, Token, Update Interval |
| **Web** | `app.js` | API Base URL configuration |

---

## ⚠️ Important Notes

-   **Location Accuracy**: The client currently uses a stub for location. For production use, integrate with the **Windows Location API** or a Wi-Fi geolocation provider.
-   **Security**: This project is a template. Enable SSL (HTTPS) and implement robust authentication before deploying to a public network.

---

## 🤝 Contributing

Contributions are welcome! Please fork the repository and submit a Pull Request.

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
