const { Client } = require('pg');
const xsenv = require('@sap/xsenv'); 

let dbClient = null;

//Ініціалізація підключення до бази даних PostgreSQL
const connectDB = async () => {
    try {
        const dbServices = xsenv.getServices({ db: { name: 'my-postgres-db' } });
        
        dbClient = new Client({
            connectionString: dbServices.db.uri,
            ssl: { rejectUnauthorized: false } 
        });
        
        await dbClient.connect();
        console.log("Database: Connected to SAP BTP PostgreSQL");
        
        // Автоматична ініціалізація схеми таблиці при старті сервісу
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
        await dbClient.query(createTableQuery);
        console.log("Database schema is ready");
    } catch (err) {
        console.log("Database Config Error (Local Mode):", err.message);
    }
};

const getDbClient = () => dbClient;

module.exports = { connectDB, getDbClient };