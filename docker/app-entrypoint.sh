#!/bin/sh
# Seeds the demo koperasi that are missing (existing data is kept), then serves the app.
set -e
node scripts/seed-demo.ts
# 0.0.0.0 inside the container; compose publishes the port on the host's 127.0.0.1 only.
exec node_modules/.bin/next start -H 0.0.0.0 -p 3000
