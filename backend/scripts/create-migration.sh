#!/bin/bash

set -e

# Check if a name was provided
if [ -z "$1" ]; then
  echo "❌ Please provide a migration name."
  echo "Usage: ./create-migration.sh MigrationName"
  exit 1
fi

# Create the migration file
npm run typeorm migration:generate "database/migrations/$1" -d typeOrm.config.ts
