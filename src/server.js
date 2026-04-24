const app = require("./app");
const config = require("./config");

app.listen(config.server.port, () => {
  console.log(`Server running on http://localhost:${config.server.port}`);
  console.log(`Health check: http://localhost:${config.server.port}/health`);
  console.log(
    `API endpoint: POST http://localhost:${config.server.port}/api/getOnetimeURL`
  );
});
