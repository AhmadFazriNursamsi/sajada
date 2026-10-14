#!/bin/sh
# Creates the first admin account if needed, then serves the app.
set -e
# First admin account from SAJADA_ADMIN_USERNAME/SAJADA_ADMIN_PASSWORD (only while none exists).
node scripts/admin-account.ts
# Listens on 0.0.0.0:3000 inside the container (HOSTNAME/PORT in the Dockerfile);
# compose publishes the port on the host's 127.0.0.1 only.
exec node server.js
