// Copy to config.js for local development (config.js is gitignored).
// Production store builds inject config via REPORT_ENDPOINT / REPORT_SECRET env vars.
self.REPORTING_CONFIG = {
  enabled: false,
  reportEndpoint: "",
  reportSecret: "",
};
