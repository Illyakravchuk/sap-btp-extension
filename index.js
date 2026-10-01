const express = require('express');
const os = require('os');
const path = require('path'); 
const xsenv = require('@sap/xsenv'); 

// Імпорт модулів
const { connectDB, getDbClient } = require('./database');
const { configureSecurity, requireAuth, requireRole, getAuthStatus } = require('./security');

const app = express();
const port = process.env.PORT || 8080;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ініціалізація інфраструктури
configureSecurity(app);
connectDB();

// МОДЕЛЬ ДАНИХ ТА ЖУРНАЛ
let appState = {
    instances: 1,
    status: 'RUNNING'
};

const systemLogs = [];
const addLog = (level, message) => {
    const logEntry = { timestamp: new Date().toISOString(), level, message };
    systemLogs.unshift(logEntry);
    if (systemLogs.length > 50) systemLogs.pop(); 
};

addLog("INFO", "Систему ініціалізовано. Контейнер запущено.");
if (getAuthStatus()) addLog("SUCCESS", "XSUAA Security успішно підключено.");
else addLog("WARNING", "Локальний режим: SAP-сервіси недоступні.");

// МАРШРУТИ API
app.get('/api/system/logs', requireAuth, (req, res) => {
    res.status(200).json(systemLogs);
});

app.post('/api/auth/auto-token', async (req, res) => {
    const { role, password } = req.body;
    const VALID_ADMIN_PASS = process.env.ADMIN_PASSWORD || "SecretAdmin1!";
    const VALID_OPERATOR_PASS = process.env.OPERATOR_PASSWORD || "OperatorPass!";

    if (role === 'Admin' && password !== VALID_ADMIN_PASS) return res.status(401).json({ error: "Невірний пароль Адміністратора." });
    if (role === 'Operator' && password !== VALID_OPERATOR_PASS) return res.status(401).json({ error: "Невірний пароль Оператора." });

    if (!getAuthStatus()) {
        addLog("SUCCESS", `[Локальний сервер] Вхід під роллю ${role}.`);
        return res.status(200).json({ access_token: "local-server-mock-token" });
    }

    try {
        const uaa = xsenv.getServices({ uaa: { name: 'xsuaa-auth' } }).uaa;
        const credentials = Buffer.from(`${uaa.clientid}:${uaa.clientsecret}`).toString('base64');
        const response = await fetch(`${uaa.url}/oauth/token?grant_type=client_credentials`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const data = await response.json();
        if (data.access_token) {
            addLog("SUCCESS", `Успішний вхід (SAP XSUAA) під роллю ${role}.`);
            res.status(200).json({ access_token: data.access_token });
        } else {
            res.status(400).json({ error: "Помилка токена SAP XSUAA" });
        }
    } catch (err) {
        res.status(500).json({ error: "Internal Auth Error: " + err.message });
    }
});

app.get('/api/system/metrics', requireAuth, (req, res) => {
    const vcapApp = process.env.VCAP_APPLICATION ? JSON.parse(process.env.VCAP_APPLICATION) : null;
    
    //  Базовий ліміт одного інстансу (256 МБ)
    let baseMemLimit = 256;
    if (process.env.MEMORY_LIMIT) {
        baseMemLimit = parseInt(process.env.MEMORY_LIMIT);
        if (process.env.MEMORY_LIMIT.toUpperCase().includes('G')) baseMemLimit *= 1024;
    }

    // Множимо ліміт на кількість активних інстансів (Сумарна ємність кластера)
    const activeInstances = appState.instances > 0 ? appState.instances : 1;
    const totalClusterMemMB = baseMemLimit * activeInstances;

    //  Множимо споживання пам'яті процесу на кількість інстансів
    const baseUsedMem = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const totalUsedMemMB = baseUsedMem * activeInstances;
    
    let freeMemMB = totalClusterMemMB - totalUsedMemMB;
    if (freeMemMB < 0) freeMemMB = 0;

    res.status(200).json({
        status: "success",
        environment: vcapApp ? "SAP BTP Cloud Foundry" : "Local Server Mode",
        container_host: os.hostname(),
        metrics: {
            used_mem: totalUsedMemMB + ' MB',
            free_mem: freeMemMB + ' MB',
            total_mem: totalClusterMemMB + ' MB',
            load_avg: os.loadavg(),
            uptime: os.uptime() + 's'
        },
        cf_app_details: vcapApp ? {
            app_id: vcapApp.application_id,
            app_name: vcapApp.application_name,
            limits: vcapApp.limits
        } : "N/A"
    });
});

// Прогнозування ресурсів 
const cpuHistory = [];
const HISTORY_LIMIT = 10; 

function predictCpuLoadML(currentLoad) {
    // 1. Оновлюємо історію 
    if (cpuHistory.length >= HISTORY_LIMIT) {
        cpuHistory.shift(); 
    }
    cpuHistory.push(currentLoad);

    // 2. Якщо даних замало для побудови тренду, то беремо базову оцінку
    if (cpuHistory.length < 3) {
        return currentLoad * 1.25; 
    }

    // 3. Алгоритм простої лінійної регресії
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = cpuHistory.length;

    for (let i = 0; i < n; i++) {
        sumX += i;            
        sumY += cpuHistory[i]; 
        sumXY += i * cpuHistory[i];
        sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // 4. Прогнозуємо наступне значення (X = n)
    let predictedLoad = (slope * n) + intercept;

    // 5. Нормалізуємо результат
    return Math.max(0, Math.min(100, predictedLoad));
}

app.get('/api/system/forecast', requireAuth, (req, res) => {
    let actualCpu = parseFloat(latestCpuPercent) || 0;
    
    // Викликаємо алгоритм для прогнозу
    let forecastCpu = predictCpuLoadML(actualCpu); 

    let status = "NORMAL";
    let message = "Поточна ємність кластера достатня.";
    let theme = "success"; 

    if (forecastCpu >= 80) {
        status = "CRITICAL";
        message = "УВАГА: Ризик перевантаження! Рекомендується Scale-Out (+1 інстанс).";
        theme = "danger";
    } else if (forecastCpu >= 50) {
        status = "WARNING";
        message = "Обчислювальних ресурсів достатньо."; 
        theme = "warning";
    }

    res.status(200).json({
        current: actualCpu.toFixed(1),
        forecast: forecastCpu.toFixed(1),
        status: status,
        message: message,
        theme: theme 
    });
});

app.get('/api/integration/destinations', requireAuth, (req, res) => {
    const isCloud = process.env.VCAP_APPLICATION ? true : false;

    res.status(200).json({
        destinations: [
            { 
                name: "S4HANA_Cloud", 
                type: "HTTP", 
                auth: "OAuth2SAMLBearerAssertion", 
                status: isCloud ? "Active" : "Offline (Local)" 
            },
            { 
                name: "SuccessFactors", 
                type: "HTTP", 
                auth: "BasicAuthentication", 
                status: "Inactive" 
            }
        ]
    });
});

// ФОНОВИЙ ГЕНЕРАТОР НАВАНТАЖЕННЯ
let currentLoadIntensity = 0; 
let isStressing = false;

// Функція, яка постійно виконується у фоновому режимі
function runStressLoop() {
    if (currentLoadIntensity <= 0) {
        isStressing = false;
        return;
    }
    
    const workDuration = currentLoadIntensity * 5; 
    const start = Date.now();
    let result = 0;
    while (Date.now() - start < workDuration) {
        result += Math.sqrt(Math.random()); 
    }
    
    setTimeout(runStressLoop, 10);
}

// API для керування генератором
app.post('/api/research/load', requireAuth, (req, res) => {
    const userRole = req.headers['x-demo-role'];
    if (userRole !== 'Admin') {
        addLog("WARNING", `Security: Відхилено спробу зміни навантаження. Роль ${userRole} не має доступу.`);
        return res.status(403).json({ error: "Access Denied. Тільки Administrator може керувати навантаженням." });
    }

    const { action } = req.body;
    let previousIntensity = currentLoadIntensity;
    
    if (action === 'increase' && currentLoadIntensity < 10) currentLoadIntensity++;
    if (action === 'decrease' && currentLoadIntensity > 0) currentLoadIntensity--;
    if (action === 'stop') currentLoadIntensity = 0;

    if (currentLoadIntensity > 0 && !isStressing) {
        isStressing = true;
        runStressLoop(); 
        addLog("WARNING", `Фонове навантаження активовано. Рівень: ${currentLoadIntensity}/10`);
    } else if (currentLoadIntensity === 0 && isStressing) {
        isStressing = false;
        addLog("INFO", "Фонове навантаження повністю зупинено.");
    } else if (isStressing && currentLoadIntensity !== previousIntensity) {
        const direction = currentLoadIntensity > previousIntensity ? "збільшено" : "зменшено";
        addLog("INFO", `Рівень навантаження ${direction} до ${currentLoadIntensity}/10`);
    }

    res.status(200).json({ intensity: currentLoadIntensity });
});

app.get('/api/research/history', requireAuth, async (req, res) => {
    const dbClient = getDbClient();
    if (!dbClient) return res.status(501).json({ error: "Database not connected." });
    try {
        const result = await dbClient.query('SELECT * FROM research_metrics ORDER BY id DESC LIMIT 20');
        res.status(200).json({ count: result.rowCount, data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

let lastTime = Date.now();
let lastCpu = process.cpuUsage();
let latestCpuPercent = 0;

app.get('/api/deployments', requireAuth, (req, res) => {
    const memLimit = process.env.MEMORY_LIMIT || '256 MB';

    const now = Date.now();
    const timeDiff = now - lastTime;
    
    const cpuDiff = process.cpuUsage(lastCpu);
    const cpuUsedMs = (cpuDiff.user + cpuDiff.system) / 1000;

    lastTime = now;
    lastCpu = process.cpuUsage();

    let rawCpuPercent = 0;
    if (timeDiff > 0) {
        rawCpuPercent = (cpuUsedMs / timeDiff) * 100;
    }

    let currentCpu = appState.instances > 0 ? (rawCpuPercent / appState.instances).toFixed(1) : 0;
    latestCpuPercent = currentCpu; 

    const dynamicDeployments = [
        { 
            id: 'cf-app-001', 
            name: 'sap-btp-node-extension', 
            status: appState.instances > 0 ? 'RUNNING' : 'STOPPED', 
            instances: appState.instances, 
            memory_quota: memLimit, 
            cpu_usage: `${currentCpu}%` 
        }
    ];

    res.status(200).json({ 
        total_deployments: dynamicDeployments.length, 
        timestamp: new Date().toISOString(), 
        data: dynamicDeployments,
        currentLoadIntensity: typeof currentLoadIntensity !== 'undefined' ? currentLoadIntensity : 0 
    });
});

app.post('/api/deployments/:id/scale', requireAuth, (req, res) => {
    const userRole = req.headers['x-demo-role'];
    if (userRole !== 'Admin') {
        addLog("WARNING", `Security: Відхилено спробу масштабування. Роль ${userRole} не має прав (Required: Admin).`);
        return res.status(403).json({ error: "Access Denied. Тільки Administrator може масштабувати сервіс." });
    }

    const { id } = req.params;
    const { target_instances } = req.body;
    
    if (target_instances === undefined || target_instances < 0) {
        return res.status(400).json({ error: "Invalid instance count" });
    }

    appState.instances = target_instances;
    appState.status = target_instances > 0 ? 'RUNNING' : 'STOPPED';

    lastTime = Date.now();
    lastCpu = process.cpuUsage();

    if (target_instances > 0) {
        addLog("SUCCESS", `Масштабування ${id} до ${target_instances} шт. Навантаження розподілено між інстансами.`);
    } else {
        addLog("WARNING", `Сервіс ${id} повністю зупинено.`);
    }
    
    res.status(200).json({ message: `Deployment ${id} scaling initiated` });
});

app.listen(port, () => console.log(`SAP BTP Advanced Manager API is running on port ${port}`));