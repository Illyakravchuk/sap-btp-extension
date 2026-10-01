// Глобальні змінні для зберігання стану сесії та графіка
let sessionToken = '';
let currentRole = '';
let resourceChart;

// Формує заголовки для API-запитів, додаючи токен авторизації та обрану роль
function getHeaders() {
    return {
        'Authorization': 'Bearer ' + sessionToken,
        'Content-Type': 'application/json',
        'X-Demo-Role': document.getElementById('roleSelect').value 
    };
}
// Ініціалізує круговий графік використання оперативної пам'яті (Chart.js)
function initChart() {
    const ctx = document.getElementById('resourceChart').getContext('2d');
    resourceChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Використано (MB)', 'Вільно (MB)'],
            datasets: [{
                data: [0, 100],
                backgroundColor: ['#0d6efd', '#e9ecef'],
                borderWidth: 0
            }]
        },
        options: { cutout: '75%', responsive: true, maintainAspectRatio: false }
    });
}

// Виконує авторизацію, отримує токен і налаштовує відображення панелей інтерфейсу
async function login() {
    const btn = document.querySelector('button');
    const errBox = document.getElementById('loginError');
    const role = document.getElementById('roleSelect').value;
    const password = document.getElementById('passwordInput').value;

    if (!password) {
        errBox.innerText = "Будь ласка, введіть пароль.";
        return;
    }

    btn.innerText = "З'єднання з системою...";
    errBox.innerText = "";
    
    try {
        const res = await fetch('/api/auth/auto-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: role, password: password })
        });
        
        const data = await res.json();
        
        if (res.ok && data.access_token) {
            sessionToken = data.access_token;
            currentRole = role;
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            
            const badge = document.getElementById('userBadge');
            badge.innerText = `Role: ${role}`;
            badge.classList.remove('d-none');

            const testControls = document.getElementById('loadControlsWrapper');
            const testPanel = document.getElementById('loadGeneratorPanel');

            // Приховування панелі тестування для ролі Operator
            if (testControls && testPanel) {
                if (role === 'Admin') {
                    testControls.classList.remove('d-none');
                } else {
                    testControls.classList.add('d-none');
                    testPanel.classList.add('d-none'); 
                }
            }           
            initChart();
            updateChart();
            getDeployments();
            getLogs();
        } else {
            errBox.innerText = data.error || "Помилка авторизації.";
            btn.innerText = "Увійти в систему";
        }
    } catch (err) {
        errBox.innerText = "Сервер недоступний: " + err.message;
        btn.innerText = "Увійти в систему";
    }
}

// Отримує актуальні системні метрики та перемальовує графік пам'яті
async function updateChart() {
    try {
        const res = await fetch('/api/system/metrics', { headers: getHeaders() });
        const data = await res.json();
        if (data.metrics) {
            const used = parseInt(String(data.metrics.used_mem).replace(/\D/g, '')) || 0;
            const free = parseInt(String(data.metrics.free_mem).replace(/\D/g, '')) || 0;

            resourceChart.data.datasets[0].data = [used, free];
            resourceChart.update();
            
            const textEl = document.getElementById('usedMemText');
            if (textEl) textEl.innerText = used.toLocaleString();
        }
    } catch (e) {
        console.error("Помилка оновлення графіка:", e);
    }
}

// Завантажує список мікросервісів та генерує UI-елементи з кнопками масштабування
async function getDeployments() {
    const list = document.getElementById('deploymentsList');
    const errBox = document.getElementById('deployError');
    errBox.textContent = '';
    
    try {
        const res = await fetch('/api/deployments', { headers: getHeaders() });
        const responseData = await res.json();
        if (!res.ok) throw new Error(responseData.error);
        
        if (responseData.currentLoadIntensity !== undefined) {
            currentLoadLevel = responseData.currentLoadIntensity;
            const levelBadge = document.getElementById('loadLevelText');
            if (levelBadge) {
                levelBadge.innerText = `Рівень: ${currentLoadLevel}`;
                levelBadge.className = currentLoadLevel > 0 
                    ? 'fw-bold px-3 py-1 bg-primary text-white border border-primary rounded shadow-sm' 
                    : 'fw-bold px-3 py-1 bg-white text-secondary border rounded shadow-sm';
            }
        }

        list.innerHTML = '';
        responseData.data.forEach(app => {
            const statusColor = app.status === 'RUNNING' ? 'text-success' : 'text-secondary';
            
            let controlsHtml = '';
            if (currentRole === 'Admin') {
                controlsHtml = `
                    <button class="btn btn-sm btn-outline-dark me-1" onclick="scaleApp('${app.id}', ${app.instances + 1})">+</button>
                    <button class="btn btn-sm btn-outline-dark" onclick="scaleApp('${app.id}', Math.max(0, ${app.instances} - 1))">-</button>
                `;
            } else {
                controlsHtml = `<span class="badge bg-light text-muted border">Read-Only</span>`;
            }

            list.innerHTML += `
                <li class="list-group-item d-flex justify-content-between align-items-center px-0">
                    <div>
                        <h6 class="mb-0 fw-bold">${app.name} <span class="${statusColor} ms-2 small">&#9679; ${app.status}</span></h6>
                        <small class="text-muted">Інстанси: ${app.instances} | CPU: ${app.cpu_usage} | Квота: ${app.memory_quota}</small>
                    </div>
                    <div>
                        ${controlsHtml}
                    </div>
                </li>
            `;
        });
    } catch (err) {
        errBox.textContent = err.message;
    }
}

// Надсилає запит на зміну кількості інстансів (Scale-Out / Scale-In)
async function scaleApp(id, target) {
    if (!confirm(`Підтвердіть дію: масштабувати сервіс ${id} до ${target} інстансів?`)) return;
    const errBox = document.getElementById('deployError');
    errBox.textContent = '';
    
    try {
        const res = await fetch(`/api/deployments/${id}/scale`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ target_instances: target })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error); 
        getDeployments(); 
        getLogs(); 
    } catch (err) {
        errBox.textContent = err.message;
    }
}

// Отримує історію системних подій (логів) і виводить їх на екран
async function getLogs() {
    const logContainer = document.getElementById('logsOutput');
    try {
        const res = await fetch('/api/system/logs', { headers: getHeaders() });
        const logs = await res.json();
        logContainer.innerHTML = '';
        logs.forEach(log => {
            const color = log.level === 'WARNING' ? 'text-warning' : (log.level === 'SUCCESS' ? 'text-success' : 'text-light');
            
            let timePart = '';
            if (log.timestamp) {
                timePart = new Date(log.timestamp).toLocaleTimeString('uk-UA', {
                    timeZone: 'Europe/Kyiv',
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
            }

            logContainer.innerHTML += `<div class="${color} mb-1">[${timePart}] <strong>${log.level}</strong>: ${log.message}</div>`;
        });
    } catch (err) {
        logContainer.innerText = "Помилка логів.";
    }
}

// Отримує та відмальовує дані предиктивної моделі CPU (розрахунок навантаження)
async function renderForecast(isAutoRefresh = false) {
    const container = document.getElementById('analyticsContent');
    
    if (!isAutoRefresh) {
        container.innerHTML = '<div class="text-center mt-4 text-primary">Аналіз даних...</div>';
    }
    
    try {
        const res = await fetch('/api/system/forecast', { headers: getHeaders() });
        const data = await res.json();
        
        container.innerHTML = `
            <h6 class="fw-bold mb-3 text-secondary">Предиктивна модель (CPU)</h6>
            <div class="mb-1 d-flex justify-content-between">
                <small>Поточне навантаження</small>
                <small class="fw-bold">${data.current}%</small>
            </div>
            <div class="progress mb-3" style="height: 8px;">
                <div class="progress-bar bg-primary" style="width: ${data.current}%"></div>
            </div>
            <div class="mb-1 d-flex justify-content-between">
                <small>Прогноз навантаження</small>
                <small class="fw-bold">${data.forecast}%</small>
            </div>
            <div class="progress mb-3" style="height: 8px;">
                <div class="progress-bar bg-warning" style="width: ${data.forecast}%"></div>
            </div>
            
            <!-- Використовуємо клас alert-success, alert-warning або alert-danger -->
            <div class="alert alert-${data.theme} p-2 mb-0 mt-3 border-0 d-flex justify-content-between align-items-center">
                <div class="text-dark"><strong>${data.status}</strong> <br><small>${data.message}</small></div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="text-danger mt-4 text-center">Помилка: ${err.message}</div>`;
    }
}

// Завантажує та відображає статуси підключених систем 
async function renderDestinations() {
    const container = document.getElementById('analyticsContent');
    container.innerHTML = '<div class="text-center mt-4 text-info">Отримання з\'єднань...</div>';
    try {
        const res = await fetch('/api/integration/destinations', { headers: getHeaders() });
        const data = await res.json();
        let html = '<h6 class="fw-bold mb-3 text-secondary">Маршрути SAP BTP Destinations</h6><ul class="list-group list-group-flush">';
        data.destinations.forEach(dest => {
            const badge = dest.status === 'Active' ? 'success' : 'secondary';
            html += `
                <li class="list-group-item bg-transparent px-0 d-flex justify-content-between align-items-center border-bottom border-light">
                    <div>
                        <div class="fw-bold text-dark">${dest.name}</div>
                        <small class="text-muted">${dest.type} | ${dest.auth}</small>
                    </div>
                    <span class="badge bg-${badge} rounded-pill">${dest.status}</span>
                </li>
            `;
        });
        html += '</ul>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<div class="text-danger mt-4 text-center">Помилка: ${err.message}</div>`;
    }
}

// Візуально перемикає відображення панелі генерації навантаження
function toggleLoadGenerator() {
    const panel = document.getElementById('loadGeneratorPanel');
    panel.classList.toggle('d-none');
}

let currentLoadLevel = 0;

// Надсилає команду на зміну інтенсивності штучного навантаження CPU
async function changeLoad(action) {
    try {
        const res = await fetch('/api/research/load', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ action: action })
        });
        const data = await res.json();
        currentLoadLevel = data.intensity;
        
        const levelBadge = document.getElementById('loadLevelText');
        if (levelBadge) {
            levelBadge.innerText = `Рівень: ${currentLoadLevel}`;
            
            levelBadge.className = currentLoadLevel > 0 
                ? 'fw-bold px-3 py-1 bg-primary text-white border border-primary rounded shadow-sm' 
                : 'fw-bold px-3 py-1 bg-white text-secondary border rounded shadow-sm';
        }
        
        updateChart();
        await getDeployments(); 
        
        if (document.getElementById('analyticsContent').innerHTML.includes('Предиктивна модель')) {
            renderForecast(true); 
        }
        getLogs(); 
    } catch (err) {
        console.error("Помилка зміни навантаження:", err);
    }
}

// Live-моніторинг: оновлення всіх дашбордів кожні 5 секунд
setInterval(async () => {
    if (document.getElementById('dashboard').style.display === 'block') {
        updateChart();
        
        await getDeployments(); 
        
        const analyticsBox = document.getElementById('analyticsContent');
        if (analyticsBox && analyticsBox.innerHTML.includes('Предиктивна модель')) {
            renderForecast(true);
        }

        getLogs();
    }
}, 5000);