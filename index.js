const express = require('express');
const os = require('os');
const { performance } = require('perf_hooks');
const { Client } = require('pg');
const xsenv = require('@sap/xsenv'); 

const passport = require('passport');
const { XssecPassportStrategy, XsuaaService } = require('@sap/xssec'); 

const app = express();
const port = process.env.PORT || 8080;
app.use(express.json());

// --- МОДЕЛЬ БЕЗПЕКИ ---
let isAuthEnabled = false;
try {
    const services = xsenv.getServices({ uaa: { name: 'xsuaa-auth' } });
    
    const xsuaaService = new XsuaaService(services.uaa);
    passport.use('JWT', new XssecPassportStrategy(xsuaaService));
    
    app.use(passport.initialize());
    isAuthEnabled = true;
    console.log("XSUAA Security: Enabled (v4 Strategy)");
} catch (err) {
    console.log("XSUAA Security: Disabled. Причина:", err.message);
}

const requireAuth = (req, res, next) => {
    if (isAuthEnabled) {
        return passport.authenticate('JWT', { session: false })(req, res, next);
    }
    return res.status(500).json({ error: "Security Configuration Error: XSUAA is offline." });
};

// --- МОДЕЛЬ ДАНИХ ---
let dbClient = null;
try {
    const dbServices = xsenv.getServices({ 
        db: { name: 'my-postgres-db' } 
    });
    
    dbClient = new Client({
        connectionString: dbServices.db.uri,
        ssl: { rejectUnauthorized: false } 
    });
    
    dbClient.connect()
        .then(() => {
            console.log("Database: Connected to SAP BTP PostgreSQL");
            
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS research_metrics (
                    id SERIAL PRIMARY KEY,
                    exp_id VARCHAR(50),
                    iterations BIGINT,
                    exec_time NUMERIC,
                    load_before NUMERIC,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `;
            return dbClient.query(createTableQuery);
        })
        .then(() => console.log("Database schema is ready"))
        .catch(err => console.error("Database Connection/Setup Error:", err.message));

} catch (err) {
    console.log("Database Config Error:", err.message);
}

let deployments = [
    { id: 'cf-app-001', name: 'sap-btp-extension-core', status: 'RUNNING', instances: 1, memory_quota: '256M', cpu_usage: '12%' },
    { id: 'cf-app-002', name: 'sap-btp-auth-service', status: 'STOPPED', instances: 0, memory_quota: '128M', cpu_usage: '0%' }
];

// --- МАРШРУТИ ---

app.get('/api/system/metrics', requireAuth, (req, res) => {
    const vcapApp = process.env.VCAP_APPLICATION ? JSON.parse(process.env.VCAP_APPLICATION) : null;
    
    res.status(200).json({
        status: "success",
        environment: vcapApp ? "SAP BTP Cloud Foundry" : "Local Docker Container",
        container_host: os.hostname(),
        metrics: {
            free_mem: Math.round(os.freemem() / 1024 / 1024) + ' MB',
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

app.post('/api/research/benchmark', requireAuth, async (req, res) => {
    const iterations = req.body.iterations || 1000000;
    const start = performance.now();
    
    let result = 0;
    for (let i = 0; i < iterations; i++) {
        result += Math.sqrt(i) * Math.sin(i);
    }
    
    const end = performance.now();
    const executionTime = (end - start).toFixed(4);
    
    const experimentData = {
        experiment_id: "EXP-" + Date.now(),
        iterations: iterations,
        execution_time_ms: executionTime,
        system_load_before: os.loadavg()[0]
    };

    if (dbClient) {
        try {
            await dbClient.query(
                'INSERT INTO research_metrics(exp_id, iterations, exec_time, load_before) VALUES($1, $2, $3, $4)',
                [experimentData.experiment_id, iterations, executionTime, experimentData.system_load_before]
            );
            experimentData.saved_to_db = true;
        } catch (dbErr) {
            console.error("DB Save Error:", dbErr);
            experimentData.saved_to_db = false;
        }
    } else {
        experimentData.saved_to_db = false;
    }

    res.status(200).json(experimentData);
});

app.get('/api/research/history', requireAuth, async (req, res) => {
    if (!dbClient) {
        return res.status(501).json({ error: "Database not connected. History unavailable." });
    }
    try {
        const result = await dbClient.query('SELECT * FROM research_metrics ORDER BY id DESC LIMIT 20');
        res.status(200).json({ count: result.rowCount, data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/deployments', requireAuth, (req, res) => {
    res.status(200).json({
        total_deployments: deployments.length,
        timestamp: new Date().toISOString(),
        data: deployments
    });
});

app.post('/api/deployments/:id/scale', requireAuth, (req, res) => {
    const { id } = req.params;
    const { target_instances } = req.body;

    if (target_instances === undefined || target_instances < 0) {
        return res.status(400).json({ error: "Invalid instance count" });
    }

    const appIndex = deployments.findIndex(d => d.id === id);
    if (appIndex === -1) {
        return res.status(404).json({ error: "Deployment not found" });
    }

    deployments[appIndex].instances = target_instances;
    deployments[appIndex].status = target_instances > 0 ? 'RUNNING' : 'STOPPED';

    res.status(200).json({
        message: `Deployment ${id} scaling initiated`,
        updated_state: deployments[appIndex]
    });
});

app.listen(port, () => {
    console.log(`SAP BTP Advanced Manager API is running on port ${port}`);
});