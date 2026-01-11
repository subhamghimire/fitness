#!/bin/bash

set -e

# Check if a name was provided
if [ -z "$1" ]; then
  echo "❌ Please provide a seed name."
  echo "Usage: ./create-seed.sh SeedName"
  exit 1
fi

# Create the seed file
# pnpm typeorm-extension seed:create --name "database/seeds/$1" 
npm run typeorm-extension -- seed:create --name "database/seeds/$1" 
