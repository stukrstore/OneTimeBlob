const dotenv = require("dotenv");
dotenv.config();

const config = {
  databricks: {
    host: process.env.DATABRICKS_HOST,
    httpPath: process.env.DATABRICKS_HTTP_PATH,
  },
  storage: {
    account: process.env.STORAGE_ACCOUNT || "mskrblobonetime",
    container: process.env.STORAGE_CONTAINER || "api",
  },
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
  },
  sas: {
    expiryMinutes: parseInt(process.env.SAS_EXPIRY_MINUTES, 10) || 5,
  },
};

const required = ["DATABRICKS_HOST", "DATABRICKS_HTTP_PATH"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = config;
