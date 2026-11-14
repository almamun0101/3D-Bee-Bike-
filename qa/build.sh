#!/bin/sh
# Builds the QA bundle (mock Firebase) into /tmp/qa-out, then restores the normal production build output.
cd "$(dirname "$0")/.."
export NEXT_PUBLIC_FIREBASE_API_KEY=qa NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=qa.test NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://qa.firebaseio.com NEXT_PUBLIC_FIREBASE_PROJECT_ID=qa NEXT_PUBLIC_FIREBASE_APP_ID=qa NEXT_PUBLIC_DB_ROOT=3dbee QA_MOCK_FIREBASE=1
node node_modules/next/dist/bin/next build >/tmp/qa-build.log 2>&1 || { tail -30 /tmp/qa-build.log; exit 1; }
rm -rf /tmp/qa-out && cp -r .next-qa /tmp/qa-out && rm -rf .next-qa && echo "QA bundle ready in /tmp/qa-out"
