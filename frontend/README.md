# UdyamCoach

A local-first workout tracker app built with Expo (React Native), featuring offline-first architecture with periodic bulk sync to a backend.

## Architecture

This app follows a **local-first** architecture where:

- All workout edits are saved locally (SQLite)
- No API calls during workout editing
- Sync happens in bulk (periodic, on workout end, app state changes)
- Mobile generates all UUIDs
- Backend is stateless and idempotent

```
User Action → Zustand (in-memory) → SQLite (persistent) → Bulk Sync → Backend
```

## Tech Stack

- **Framework**: Expo (React Native, TypeScript)
- **Navigation**: Expo Router
- **State Management**: Zustand
- **Local Database**: expo-sqlite
- **API Client**: Axios
- **Auth Storage**: expo-secure-store

## Project Structure

```
app/
├── (auth)/              # Auth screens (login, register)
├── (tabs)/              # Tab screens (home, history, settings)
├── workout/             # Workout screens (active workout, exercise picker)
├── _layout.tsx          # Root layout with auth guard
store/
├── auth.store.ts        # Authentication state
├── workout.store.ts     # Workout editing state
db/
├── schema.ts            # SQLite schema definitions
├── database.ts          # Database initialization
├── queries.ts           # CRUD operations
sync/
├── sync.service.ts      # Bulk sync logic with triggers
services/
├── api.ts               # Axios client with auth interceptor
types/
├── index.ts             # TypeScript type definitions
components/
├── WorkoutTimer.tsx     # Live workout duration timer
├── ExerciseCard.tsx     # Exercise with sets UI
├── SetRow.tsx           # Editable set row
├── SyncIndicator.tsx    # Sync status indicator
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI
- iOS Simulator or Android Emulator (or physical device)

### Installation

```bash
# Install dependencies
npm install

# Start the development server
npx expo start
```

### Running the App

```bash
# iOS
npm run ios

# Android
npm run android

# Web
npm run web
```

## Features

### Workout Tracking
- Start/end workouts with timer
- Add exercises from common list or custom
- Track sets with weight, reps, RPE
- Mark sets as warmup
- Real-time editing with instant local persistence

### Offline Support
- All data stored locally in SQLite
- Works completely offline
- Syncs when connection available

### Sync Triggers
- Every 30 seconds (periodic)
- When workout ends
- App goes to background/foreground
- Network connectivity restored

## Local Database Schema

```sql
workouts_local (
  id TEXT PRIMARY KEY,
  status TEXT,          -- active | completed | synced
  started_at TEXT,
  ended_at TEXT,
  last_synced_at TEXT
);

exercises_local (
  id TEXT PRIMARY KEY,
  workout_id TEXT,
  name TEXT,
  order_index INTEGER
);

sets_local (
  id TEXT PRIMARY KEY,
  exercise_id TEXT,
  weight REAL,
  reps INTEGER,
  rpe INTEGER,
  is_warmup INTEGER
);
```

## Sync Payload Format

```json
{
  "workout": {
    "id": "uuid",
    "startedAt": "2025-01-03T10:00:00.000Z",
    "endedAt": "2025-01-03T11:00:00.000Z",
    "exercises": [
      {
        "id": "uuid",
        "name": "Bench Press",
        "orderIndex": 0,
        "sets": [
          {
            "id": "uuid",
            "weight": 80,
            "reps": 8,
            "rpe": 8,
            "isWarmup": false
          }
        ]
      }
    ]
  }
}
```

## Environment Variables

Create a `.env` file:

```
EXPO_PUBLIC_API_URL=http://localhost:3000
```

## Backend Requirements

The backend should implement:

1. **POST /auth/login** - Email/password login, returns JWT + user
2. **POST /auth/register** - User registration
3. **POST /sync/workouts** - Idempotent workout upsert

The sync endpoint should:
- Accept the full workout payload
- Use client-provided UUIDs
- Perform upsert (not duplicate on re-sync)
- Delete and re-insert exercises/sets for simplicity
- Validate user ownership

## Development Notes

### Non-Negotiable Rules
- No API calls during workout editing
- All workout edits saved locally first
- Mobile generates all UUIDs
- Backend is stateless and idempotent

### Key Patterns
- Zustand for live editing state
- SQLite for persistence
- Every mutation: Zustand → SQLite (transaction)
- Sync only completed workouts
