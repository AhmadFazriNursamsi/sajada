#!/bin/sh
# Seeds the demo koperasi that are missing (existing data is kept), then serves the app.
set -e
node scripts/seed-demo.ts
# Listens on 0.0.0.0:3000 inside the container (HOSTNAME/PORT in the Dockerfile);
# compose publishes the port on the host's 127.0.0.1 only.
exec node server.js
