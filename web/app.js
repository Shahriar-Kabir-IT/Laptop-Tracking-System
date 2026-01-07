let API_BASE = (function () {
  try {
    const saved = localStorage.getItem('api_base');
    if (saved && typeof saved === 'string' && saved.trim().length > 0) return saved.trim();
  } catch {}
  return 'http://202.4.116.106:4000/api';
})();

let authToken = null;
let map;
let marker;
const STALE_THRESHOLD_SECONDS = 86400;
const employeesById = {};
let currentEmployeeId = null;
const EXCLUDED_CODES = ['E449295', 'E820997', 'E729721', 'E255276', 'E401577', 'E845628'];
const EXCLUDED_DEPARTMENTS = ['<YOUR_DEPT>'];
const HIDDEN_CODES_KEY = 'hidden_codes';

function getHiddenCodes() {
  try {
    const raw = localStorage.getItem(HIDDEN_CODES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function addHiddenCode(code) {
  const hidden = getHiddenCodes();
  if (!hidden.includes(code)) {
    hidden.push(code);
    try { localStorage.setItem(HIDDEN_CODES_KEY, JSON.stringify(hidden)); } catch {}
  }
  return hidden;
}

function initMap() {
  map = L.map('map').setView([23.8103, 90.4125], 6); // Dhaka-ish default

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

async function apiRequest(path, options = {}) {
  const headers = options.headers || {};
  headers['Content-Type'] = 'application/json';
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }

  return res.json();
}

function setStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

function updateMarker(lat, lon, tooltip) {
  if (!map) return;
  if (!marker) {
    marker = L.marker([lat, lon]).addTo(map);
  } else {
    marker.setLatLng([lat, lon]);
  }
  if (tooltip) {
    marker.bindPopup(tooltip).openPopup();
  }
  map.setView([lat, lon], 14);
}

async function loadDepartments() {
  const departments = await apiRequest('/departments');
  const deptSelect = document.getElementById('department-select');
  deptSelect.innerHTML = '<option value="">Select department</option>';
  for (const dept of departments.filter(d => !EXCLUDED_DEPARTMENTS.includes(d.name))) {
    const opt = document.createElement('option');
    opt.value = dept.id;
    opt.textContent = dept.name;
    deptSelect.appendChild(opt);
  }
}

async function loadEmployees(departmentId) {
  const employees = await apiRequest(`/departments/${departmentId}/employees`);
  const empSelect = document.getElementById('employee-select');
  empSelect.innerHTML = '<option value="">Select employee</option>';
  // reset local cache for selected department list
  for (const k of Object.keys(employeesById)) delete employeesById[k];
  const hidden = getHiddenCodes();
  for (const emp of employees.filter(e => !EXCLUDED_CODES.includes(e.employee_code) && !hidden.includes(e.employee_code))) {
    employeesById[emp.id] = emp;
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = `${emp.full_name} (${emp.employee_code})`;
    empSelect.appendChild(opt);
  }
}

async function loadLastLocation(employeeId) {
  const res = await apiRequest(`/employees/${employeeId}/last-location`);
  if (!res.location) {
    setStatus('No location recorded yet for this employee.');
    return;
  }
  const { latitude, longitude, recorded_at } = res.location;
  const last = new Date(recorded_at);
  // Online/offline status disabled per request
  const emp = employeesById[employeeId];
  const empName = emp && emp.full_name ? emp.full_name : 'Employee';
  const empCode = emp && emp.employee_code ? emp.employee_code : '';
  const timeOptions = { timeZone: 'Asia/Dhaka' };
  const tooltip = `<div><div><strong>${empName}${empCode ? ` (${empCode})` : ''}</strong></div><div>Last updated: ${last.toLocaleString(undefined, timeOptions)}</div></div>`;
  updateMarker(latitude, longitude, tooltip);
  setStatus(`Last updated at ${last.toLocaleString(undefined, timeOptions)}`);
}

function setupLoginForm() {
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const loginCard = document.getElementById('login-card');
  const controlCard = document.getElementById('control-card');
  const userInfo = document.getElementById('user-info');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    const username = loginForm.username.value;
    const password = loginForm.password.value;

    try {
      const res = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      authToken = res.token;
      loginCard.style.display = 'none';
      controlCard.style.display = 'block';
      userInfo.textContent = `Logged in as ${username}`;
      await loadDepartments();
      setStatus('Select department and employee.');
    } catch (err) {
      loginError.textContent = 'Login failed. Check username/password.';
      loginError.style.display = 'block';
    }
  });
}

function setupSelectors() {
  const deptSelect = document.getElementById('department-select');
  const empSelect = document.getElementById('employee-select');
  const refreshBtn = document.getElementById('refresh-btn');
  const deleteBtn = document.getElementById('delete-employee-btn');

  deptSelect.addEventListener('change', async () => {
    const deptId = deptSelect.value;
    if (!deptId) {
      empSelect.innerHTML = '<option value="">Select employee</option>';
      setStatus('Select department and employee.');
      return;
    }
    try {
      await loadEmployees(deptId);
      setStatus('Select employee.');
    } catch {
      setStatus('Failed to load employees.');
    }
  });

  empSelect.addEventListener('change', async () => {
    const empId = empSelect.value;
    if (!empId) {
      setStatus('Select employee.');
      return;
    }
    currentEmployeeId = empId;

    const refresh = async () => {
      try {
        await loadLastLocation(empId);
      } catch (err) {
        setStatus('Failed to load last location.');
      }
    };

    // initial load
    refresh();
    // set up polling every 15 seconds
    if (window._locationInterval) {
      clearInterval(window._locationInterval);
    }
    window._locationInterval = setInterval(refresh, 15000);
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const empId = empSelect.value;
      if (!empId) {
        setStatus('Select employee.');
        return;
      }
      refreshBtn.disabled = true;
      try {
        await loadLastLocation(empId);
      } catch {
        setStatus('Failed to load last location.');
      } finally {
        refreshBtn.disabled = false;
      }
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const empId = empSelect.value;
      if (!empId) {
        setStatus('Select employee to delete.');
        return;
      }
      if (!authToken) {
        setStatus('Login required to delete.');
        return;
      }
      const emp = employeesById[empId];
      if (!emp || !emp.employee_code) {
        setStatus('Employee code unavailable.');
        return;
      }
      const ok = window.confirm(`Delete ${emp.full_name} (${emp.employee_code}) permanently?`);
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await apiRequest('/admin/delete-employees', {
          method: 'POST',
          body: JSON.stringify({ employeeCodes: [emp.employee_code] })
        });
        if (marker) { marker.remove(); marker = null; }
        setStatus('Employee deleted.');
        delete employeesById[empId];
        const deptId = deptSelect.value;
        if (deptId) {
          await loadEmployees(deptId);
        } else {
          empSelect.innerHTML = '<option value="">Select employee</option>';
        }
        empSelect.value = '';
      } catch (err) {
        const msg = err && err.message ? err.message : '';
        if (msg.includes('Cannot POST') || msg.includes('Not Found')) {
          addHiddenCode(emp.employee_code);
          if (marker) { marker.remove(); marker = null; }
          setStatus('Delete API not available. Employee hidden locally.');
          const deptId = deptSelect.value;
          if (deptId) {
            await loadEmployees(deptId);
          } else {
            empSelect.innerHTML = '<option value="">Select employee</option>';
          }
          empSelect.value = '';
        } else {
          setStatus(`Failed to delete employee: ${msg || 'Unknown error'}`);
        }
      } finally {
        deleteBtn.disabled = false;
      }
    });
  }

}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupLoginForm();
  setupSelectors();
});


