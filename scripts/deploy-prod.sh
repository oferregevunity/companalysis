#!/usr/bin/env bash
# Deploy Competitor Analysis app to production.
# Only deploys this app's targets (hosting, firestore, compAnalysisApi, weeklyFetch).
# Does NOT delete or modify other functions in the Firebase project (e.g. asoapi).

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Building frontend..."
(cd frontend && npm run build)

echo "Deploying to Firebase (hosting, firestore, and this app's functions only)..."
firebase deploy --only "hosting,firestore,functions:compAnalysisApi,functions:weeklyFetch" "$@"

echo "Done."
