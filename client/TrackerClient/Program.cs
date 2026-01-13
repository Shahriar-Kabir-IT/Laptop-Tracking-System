using System.Net.Http.Json;
using System.Text.Json;
using System.Diagnostics;
using System.Text;
using System.Threading.Tasks;
using System.Linq;
using System.Windows.Forms;
using Microsoft.Win32;
using System;
using Windows.Devices.Geolocation;

internal class AppConfig
{
    public string BackendBaseUrl { get; set; } = "http://202.4.116.106:4000/api";
    public string EmployeeCode { get; set; } = "";
    public string ClientToken { get; set; } = "dev_client_token";
    public int IntervalSeconds { get; set; } = 60;
    public string EmployeeName { get; set; } = "";
    public string DepartmentName { get; set; } = "";
}

internal class LocationPayload
{
    public string DeviceId { get; set; } = "";
    public string EmployeeCode { get; set; } = "";
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public DateTime Timestamp { get; set; }
}

internal class Program
{
    private static readonly HttpClient Http = new();
    private static string AppDir => AppContext.BaseDirectory;
    private static string LocalDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LaptopTracker");
    private static string OverridePath => Path.Combine(LocalDir, "appsettings.override.json");
    private static string LogPath => Path.Combine(LocalDir, "client.log");
    private static bool LocationHelpShown = false;
    private class CliOptions
    {
        public bool ProvisionAndExit { get; set; }
        public bool InstallAutostart { get; set; }
        public bool NoUi { get; set; }
        public string? Name { get; set; }
        public string? Dept { get; set; }
        public string? Backend { get; set; }
        public string? Token { get; set; }
    }

    [STAThread]
    private static async Task Main()
    {
        AppDomain.CurrentDomain.UnhandledException += (sender, e) =>
        {
            Log($"FATAL UnhandledException: {e.ExceptionObject}");
        };

        try
        {
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        EnsureLocalDir();
        Log("Starting TrackerClient");

        var cli = ParseArgs(Environment.GetCommandLineArgs());
        var config = LoadConfig();
        if (!string.IsNullOrWhiteSpace(cli.Backend)) config.BackendBaseUrl = cli.Backend;
        if (!string.IsNullOrWhiteSpace(cli.Token)) config.ClientToken = cli.Token;
        Log($"Backend {config.BackendBaseUrl}");
        Log($"EmployeeCode {config.EmployeeCode}");

        var deviceId = Environment.MachineName;
        Log($"DeviceId {deviceId}");

        SetClientToken(config.ClientToken);

        config = await EnsureBackendReachable(config);

        if (cli.ProvisionAndExit)
        {
            var employeeName = string.IsNullOrWhiteSpace(cli.Name) ? (string.IsNullOrWhiteSpace(config.EmployeeName) ? deviceId : config.EmployeeName) : cli.Name!;
            var departmentName = string.IsNullOrWhiteSpace(cli.Dept) ? (string.IsNullOrWhiteSpace(config.DepartmentName) ? "Unassigned" : config.DepartmentName) : cli.Dept!;
            var ok = await TryProvision(config, deviceId, employeeName, departmentName);
            if (!ok)
            {
                Environment.Exit(1);
                return;
            }
            if (cli.InstallAutostart) EnsureAutostart();
            Environment.Exit(0);
            return;
        }

        if (string.IsNullOrWhiteSpace(config.EmployeeCode))
        {
            var backendOk = await TryBackend(config);
            if (backendOk && cli.NoUi)
            {
                var employeeName = string.IsNullOrWhiteSpace(config.EmployeeName) ? deviceId : config.EmployeeName;
                var departmentName = string.IsNullOrWhiteSpace(config.DepartmentName) ? "Unassigned" : config.DepartmentName;
                var ok = await TryProvision(config, deviceId, employeeName, departmentName);
                if (!ok) return;
            }
            else if (backendOk)
            {
                var employeeName = string.IsNullOrWhiteSpace(config.EmployeeName) ? deviceId : config.EmployeeName;
                var departmentName = string.IsNullOrWhiteSpace(config.DepartmentName) ? "Unassigned" : config.DepartmentName;
                var ok = await TryProvision(config, deviceId, employeeName, departmentName);
                if (ok)
                {
                    EnsureAutostart();
                }
                else
                {
                    var setup = new SetupForm(config, async (cfg, status) =>
                    {
                        var ok = await TryBackend(cfg);
                        if (!ok)
                        {
                            status("Backend not reachable");
                            return false;
                        }
                        var en = string.IsNullOrWhiteSpace(cfg.EmployeeName) ? deviceId : cfg.EmployeeName;
                        var dn = string.IsNullOrWhiteSpace(cfg.DepartmentName) ? "Unassigned" : cfg.DepartmentName;
                        var rOk = await TryProvision(cfg, deviceId, en, dn);
                        if (!rOk)
                        {
                            status("Provision failed");
                            return false;
                        }
                        EnsureAutostart();
                        return true;
                    });
                    var result = setup.ShowDialog();
                    if (result != DialogResult.OK) return;
                    config = setup.Config;
                }
            }
            else
            {
                var setup = new SetupForm(config, async (cfg, status) =>
                {
                    var ok = await TryBackend(cfg);
                    if (!ok)
                    {
                        status("Backend not reachable");
                        return false;
                    }
                    var en = string.IsNullOrWhiteSpace(cfg.EmployeeName) ? deviceId : cfg.EmployeeName;
                    var dn = string.IsNullOrWhiteSpace(cfg.DepartmentName) ? "Unassigned" : cfg.DepartmentName;
                    var rOk = await TryProvision(cfg, deviceId, en, dn);
                    if (!rOk)
                    {
                        status("Provision failed");
                        return false;
                    }
                    EnsureAutostart();
                    return true;
                });
                var result = setup.ShowDialog();
                if (result != DialogResult.OK) return;
                config = setup.Config;
            }
        }

        while (true)
        {
            try
            {
                var location = await GetCurrentLocationAsync();
                if (location == null)
                {
                    Log("Location unavailable");
                }
                else
                {
                    var payload = new LocationPayload
                    {
                        DeviceId = deviceId,
                        EmployeeCode = config.EmployeeCode,
                        Latitude = location.Value.Lat,
                        Longitude = location.Value.Lon,
                        Timestamp = DateTime.UtcNow
                    };

                    var url = $"{config.BackendBaseUrl.TrimEnd('/')}/location";
                    var response = await Http.PostAsJsonAsync(url, payload, new JsonSerializerOptions
                    {
                        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                    });

                    if (response.IsSuccessStatusCode)
                    {
                        Log($"Sent {payload.Latitude},{payload.Longitude}");
                    }
                    else
                    {
                        var body = await response.Content.ReadAsStringAsync();
                        Log($"Send failed {response.StatusCode} {body}");
                        if ((int)response.StatusCode == 400 && body.Contains("Unknown employee code"))
                        {
                            var employeeName = !string.IsNullOrWhiteSpace(config.EmployeeName)
                                ? config.EmployeeName
                                : Environment.GetEnvironmentVariable("LAPTOP_TRACKER_NAME") ?? deviceId;
                            var departmentName = !string.IsNullOrWhiteSpace(config.DepartmentName)
                                ? config.DepartmentName
                                : Environment.GetEnvironmentVariable("LAPTOP_TRACKER_DEPT") ?? "Unassigned";
                            var provisionRes = await Http.PostAsJsonAsync(
                                $"{config.BackendBaseUrl.TrimEnd('/')}/provision",
                                new { deviceId, employeeName, departmentName }
                            );
                            if (provisionRes.IsSuccessStatusCode)
                            {
                                var pjson = await provisionRes.Content.ReadAsStringAsync();
                                using var pdoc = JsonDocument.Parse(pjson);
                                var newCode = pdoc.RootElement.GetProperty("employeeCode").GetString() ?? "";
                                config.EmployeeCode = newCode;
                                config.EmployeeName = employeeName;
                                config.DepartmentName = departmentName;
                                SaveOverride(config);
                                Log($"Re-provisioned {newCode}");
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log($"Error {ex.Message}");
            }

            await Task.Delay(TimeSpan.FromSeconds(config.IntervalSeconds));
        }
    }
    catch (Exception ex)
    {
        Log($"FATAL Main Error: {ex}");
    }
}

    private static AppConfig LoadConfig()
    {
        var basePath = Path.Combine(AppDir, "appsettings.json");
        AppConfig cfg = new();
        if (File.Exists(basePath))
        {
            try
            {
                var json = File.ReadAllText(basePath);
                var loaded = JsonSerializer.Deserialize<AppConfig>(json);
                if (loaded != null) cfg = loaded;
            }
            catch {}
        }
        if (File.Exists(OverridePath))
        {
            try
            {
                var json = File.ReadAllText(OverridePath);
                var over = JsonSerializer.Deserialize<AppConfig>(json);
                if (over != null)
                {
                    if (!string.IsNullOrWhiteSpace(over.BackendBaseUrl)) cfg.BackendBaseUrl = over.BackendBaseUrl;
                    if (!string.IsNullOrWhiteSpace(over.EmployeeCode)) cfg.EmployeeCode = over.EmployeeCode;
                    if (!string.IsNullOrWhiteSpace(over.ClientToken)) cfg.ClientToken = over.ClientToken;
                    if (over.IntervalSeconds > 0) cfg.IntervalSeconds = over.IntervalSeconds;
                    if (!string.IsNullOrWhiteSpace(over.EmployeeName)) cfg.EmployeeName = over.EmployeeName;
                    if (!string.IsNullOrWhiteSpace(over.DepartmentName)) cfg.DepartmentName = over.DepartmentName;
                }
            }
            catch {}
        }
        return cfg;
    }

    private static async Task<(double Lat, double Lon)?> GetCurrentLocationAsync()
    {
        var access = await Geolocator.RequestAccessAsync();
        if (access != GeolocationAccessStatus.Allowed)
        {
            if (!LocationHelpShown)
            {
                LocationHelpShown = true;
                try
                {
                    MessageBox.Show("Enable Windows Location Service: Settings → Privacy & security → Location", "LaptopTracker", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    Process.Start(new ProcessStartInfo("ms-settings:privacy-location") { UseShellExecute = true });
                }
                catch {}
            }
            return null;
        }

        var locator = new Geolocator
        {
            DesiredAccuracy = PositionAccuracy.High
        };
        var pos = await locator.GetGeopositionAsync();
        var coord = pos.Coordinate.Point.Position;
        return (coord.Latitude, coord.Longitude);
    }

    private static void SaveConfig(AppConfig config)
    {
        var json = JsonSerializer.Serialize(config, new JsonSerializerOptions
        {
            WriteIndented = true
        });
        File.WriteAllText(Path.Combine(AppDir, "appsettings.json"), json);
    }

    private static void EnsureAutostart()
    {
        try
        {
            using var runKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
            if (runKey != null)
            {
                var exePath = Path.Combine(AppDir, "TrackerClient.exe");
                runKey.SetValue("LaptopTracker", $"\"{exePath}\"");
            }
        }
        catch {}
    }

    private static void EnsureLocalDir()
    {
        try { Directory.CreateDirectory(LocalDir); } catch {}
    }

    private static void Log(string message)
    {
        try
        {
            var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}";
            File.AppendAllText(LogPath, line, Encoding.UTF8);
        }
        catch {}
    }

    private static async Task<AppConfig> EnsureBackendReachable(AppConfig cfg)
    {
        try
        {
            var healthUrl = $"{cfg.BackendBaseUrl.TrimEnd('/')}/health";
            var res = await Http.GetAsync(healthUrl);
            if (res.IsSuccessStatusCode) return cfg;
        }
        catch {}
        var ports = Enumerable.Range(4000, 11);
        foreach (var p in ports)
        {
            try
            {
                var url = $"http://localhost:{p}/api/health";
                var r = await Http.GetAsync(url);
                if (r.IsSuccessStatusCode)
                {
                    cfg.BackendBaseUrl = $"http://localhost:{p}/api";
                    SaveOverride(cfg);
                    Log($"Backend discovered {cfg.BackendBaseUrl}");
                    return cfg;
                }
            }
            catch {}
        }
        return cfg;
    }

    private static async Task<bool> TryBackend(AppConfig cfg)
    {
        try
        {
            var healthUrl = $"{cfg.BackendBaseUrl.TrimEnd('/')}/health";
            var res = await Http.GetAsync(healthUrl);
            if (res.IsSuccessStatusCode) return true;
        }
        catch {}
        var ports = Enumerable.Range(4000, 11);
        foreach (var p in ports)
        {
            try
            {
                var url = $"http://localhost:{p}/api/health";
                var r = await Http.GetAsync(url);
                if (r.IsSuccessStatusCode)
                {
                    cfg.BackendBaseUrl = $"http://localhost:{p}/api";
                    SaveOverride(cfg);
                    Log($"Backend discovered {cfg.BackendBaseUrl}");
                    return true;
                }
            }
            catch {}
        }
        return false;
    }

    private static void SaveOverride(AppConfig cfg)
    {
        EnsureLocalDir();
        var json = JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true });
        try { File.WriteAllText(OverridePath, json); } catch {}
    }

    private static void SetClientToken(string token)
    {
        try
        {
            Http.DefaultRequestHeaders.Remove("x-client-token");
            Http.DefaultRequestHeaders.Add("x-client-token", token);
        }
        catch {}
    }

    private static CliOptions ParseArgs(string[] args)
    {
        var opts = new CliOptions();
        for (int i = 1; i < args.Length; i++)
        {
            var a = args[i];
            if (a.Equals("--provision-and-exit", StringComparison.OrdinalIgnoreCase)) opts.ProvisionAndExit = true;
            else if (a.Equals("--install-autostart", StringComparison.OrdinalIgnoreCase)) opts.InstallAutostart = true;
            else if (a.Equals("--no-ui", StringComparison.OrdinalIgnoreCase)) opts.NoUi = true;
            else if (a.Equals("--name", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) { opts.Name = args[++i]; }
            else if (a.Equals("--dept", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) { opts.Dept = args[++i]; }
            else if (a.Equals("--backend", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) { opts.Backend = args[++i]; }
            else if (a.Equals("--token", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) { opts.Token = args[++i]; }
        }
        return opts;
    }

    private static async Task<bool> TryProvision(AppConfig cfg, string deviceId, string employeeName, string departmentName)
    {
        // First attempt with current settings
        var url = $"{cfg.BackendBaseUrl.TrimEnd('/')}/provision";
        var provisionRes = await Http.PostAsJsonAsync(url, new { deviceId, employeeName, departmentName });
        if (provisionRes.IsSuccessStatusCode)
        {
            var json = await provisionRes.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            var newCode = doc.RootElement.GetProperty("employeeCode").GetString() ?? "";
            cfg.EmployeeCode = newCode;
            cfg.EmployeeName = employeeName;
            cfg.DepartmentName = departmentName;
            SaveOverride(cfg);
            return true;
        }

        // If failed, try discovering a working backend (ports 4000-4010) and retry
        var discovered = await TryBackend(cfg);
        if (discovered)
        {
            url = $"{cfg.BackendBaseUrl.TrimEnd('/')}/provision";
            provisionRes = await Http.PostAsJsonAsync(url, new { deviceId, employeeName, departmentName });
            if (provisionRes.IsSuccessStatusCode)
            {
                var json2 = await provisionRes.Content.ReadAsStringAsync();
                using var doc2 = JsonDocument.Parse(json2);
                var newCode2 = doc2.RootElement.GetProperty("employeeCode").GetString() ?? "";
                cfg.EmployeeCode = newCode2;
                cfg.EmployeeName = employeeName;
                cfg.DepartmentName = departmentName;
                SaveOverride(cfg);
                return true;
            }
        }

        // Try ports directly without token header, then switch to the first that provisions
        var ports = Enumerable.Range(4000, 11);
        foreach (var p in ports)
        {
            try
            {
                using var hc = new HttpClient();
                var testUrl = $"http://localhost:{p}/api/provision";
                var r = await hc.PostAsJsonAsync(testUrl, new { deviceId, employeeName, departmentName });
                if (r.IsSuccessStatusCode)
                {
                    var j = await r.Content.ReadAsStringAsync();
                    using var d = JsonDocument.Parse(j);
                    var code = d.RootElement.GetProperty("employeeCode").GetString() ?? "";
                    cfg.EmployeeCode = code;
                    cfg.EmployeeName = employeeName;
                    cfg.DepartmentName = departmentName;
                    cfg.BackendBaseUrl = $"http://localhost:{p}/api";
                    cfg.ClientToken = "dev_client_token";
                    SaveOverride(cfg);
                    SetClientToken(cfg.ClientToken);
                    return true;
                }
            }
            catch {}
        }

        // Token fallback to dev_client_token, then final retry on current backend
        cfg.ClientToken = "dev_client_token";
        SetClientToken(cfg.ClientToken);
        url = $"{cfg.BackendBaseUrl.TrimEnd('/')}/provision";
        var finalRes = await Http.PostAsJsonAsync(url, new { deviceId, employeeName, departmentName });
        if (!finalRes.IsSuccessStatusCode) return false;
        var pj = await finalRes.Content.ReadAsStringAsync();
        using var pd = JsonDocument.Parse(pj);
        var nc = pd.RootElement.GetProperty("employeeCode").GetString() ?? "";
        cfg.EmployeeCode = nc;
        cfg.EmployeeName = employeeName;
        cfg.DepartmentName = departmentName;
        SaveOverride(cfg);
        return true;
    }
}

internal class SetupForm : Form
{
    private readonly TextBox _name = new() { Width = 240 };
    private readonly TextBox _dept = new() { Width = 240 };
    private readonly TextBox _backend = new() { Width = 240 };
    private readonly TextBox _token = new() { Width = 240 };
    private readonly Label _status = new() { AutoSize = true };
    private readonly Button _connect = new() { Text = "Connect" };
    private readonly Func<AppConfig, Action<string>, Task<bool>> _onConnect;
    public AppConfig Config { get; private set; }

    public SetupForm(AppConfig cfg, Func<AppConfig, Action<string>, Task<bool>> onConnect)
    {
        _onConnect = onConnect;
        Config = cfg;
        Text = "LaptopTracker Setup";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Width = 440;
        Height = 300;
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 6, Padding = new Padding(8) };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text = "Name", AutoSize = true }, 0, 0);
        panel.Controls.Add(_name, 1, 0);
        panel.Controls.Add(new Label { Text = "Department", AutoSize = true }, 0, 1);
        panel.Controls.Add(_dept, 1, 1);
        panel.Controls.Add(new Label { Text = "Backend URL", AutoSize = true }, 0, 2);
        panel.Controls.Add(_backend, 1, 2);
        panel.Controls.Add(new Label { Text = "Client Token", AutoSize = true }, 0, 3);
        panel.Controls.Add(_token, 1, 3);
        panel.Controls.Add(_connect, 1, 4);
        panel.Controls.Add(_status, 1, 5);
        Controls.Add(panel);
        _name.Text = cfg.EmployeeName ?? "";
        _dept.Text = cfg.DepartmentName ?? "";
        _backend.Text = string.IsNullOrWhiteSpace(cfg.BackendBaseUrl) ? "http://202.4.116.106:4000/api" : cfg.BackendBaseUrl;
        _token.Text = string.IsNullOrWhiteSpace(cfg.ClientToken) ? "dev_client_token" : cfg.ClientToken;
        _connect.Click += async (_, __) =>
        {
            _connect.Enabled = false;
            Config.EmployeeName = _name.Text.Trim();
            Config.DepartmentName = _dept.Text.Trim();
            Config.BackendBaseUrl = _backend.Text.Trim();
            Config.ClientToken = _token.Text.Trim();
            try
            {
                var ok = await _onConnect(Config, s => _status.Text = s);
                if (ok)
                {
                    DialogResult = DialogResult.OK;
                    Hide();
                }
            }
            finally
            {
                _connect.Enabled = true;
            }
        };
    }
}
