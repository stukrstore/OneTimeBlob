const { DBSQLClient } = require("@databricks/sql");
const { DefaultAzureCredential } = require("@azure/identity");
const config = require("./config");

const DATABRICKS_SCOPE = "2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default";

async function getAadToken() {
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken(DATABRICKS_SCOPE);
  return token.token;
}

function toCsv(columns, rows) {
  const header = columns.map((c) => c.name).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => {
      const val = row[c.name];
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(",")
  );
  return [header, ...lines].join("\n");
}

async function executeQuery(query) {
  const token = await getAadToken();

  const client = new DBSQLClient();
  await client.connect({
    host: config.databricks.host.replace("https://", ""),
    path: config.databricks.httpPath,
    token,
  });

  const session = await client.openSession();
  const operation = await session.executeStatement(query, {
    runAsync: true,
  });

  const result = await operation.fetchAll();
  const schema = await operation.getSchema();

  const columns = schema.columns.map((c) => ({ name: c.columnName }));
  const csv = toCsv(columns, result);

  await operation.close();
  await session.close();
  await client.close();

  return csv;
}

module.exports = { executeQuery };
