import { Platform } from 'react-native';
import type { Workout } from '@/types';
import { formatDuration } from '@/utils/date';

const CHANNEL_ID = 'active-workout';

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;

function getNotificationsModule(): NotificationsModule | null {
  if (notificationsModule !== undefined) return notificationsModule;
  try {
    // Lazy-load so app won't crash when native module is unavailable (e.g., Expo Go without rebuild).
    notificationsModule = require('expo-notifications') as NotificationsModule;
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    return notificationsModule;
  } catch {
    notificationsModule = null;
    return null;
  }
}

class WorkoutNotificationService {
  private notificationId: string | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private permissionGranted = false;
  private notificationsAvailable = true;

  private async ensurePermissions(): Promise<boolean> {
    const Notifications = getNotificationsModule();
    if (!Notifications) {
      this.notificationsAvailable = false;
      return false;
    }

    if (this.permissionGranted) return true;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const request = await Notifications.requestPermissionsAsync();
      finalStatus = request.status;
    }

    this.permissionGranted = finalStatus === 'granted';

    if (Platform.OS === 'android' && this.permissionGranted) {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Active Workout',
        importance: Notifications.AndroidImportance.LOW,
        vibrationPattern: [0],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    return this.permissionGranted;
  }

  private getLatestCompletedSet(workout: Workout): { exerciseName: string; summary: string } | null {
    for (let exIndex = workout.exercises.length - 1; exIndex >= 0; exIndex -= 1) {
      const exercise = workout.exercises[exIndex];
      for (let setIndex = exercise.sets.length - 1; setIndex >= 0; setIndex -= 1) {
        const set = exercise.sets[setIndex];
        if (!set.isCompleted) continue;

        const weight = set.weight ?? 0;
        const reps = set.reps ?? 0;
        const typeLabel = set.isWarmup ? '[W] - Warm-up' : set.isDropset ? '[D] - Drop set' : set.isFailure ? '[F] - Failure' : '';
        const summary = `${weight} ${this.currentUnit} × ${reps}${typeLabel ? ` ${typeLabel}` : ''}`;
        return { exerciseName: exercise.name, summary };
      }
    }

    return null;
  }

  private currentUnit: 'kg' | 'lb' = 'kg';

  private buildContent(workout: Workout, unit: 'kg' | 'lb') {
    this.currentUnit = unit;
    const elapsed = formatDuration(workout.startedAt);
    const latest = this.getLatestCompletedSet(workout);

    const title = `Fitness • ${elapsed}`;
    const body = latest
      ? `${latest.exerciseName}\n${latest.summary}`
      : 'Workout in progress\nComplete a set to show details';

    return {
      title,
      body,
      sound: false,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID, sticky: true } : {}),
    };
  }

  async update(workout: Workout, unit: 'kg' | 'lb'): Promise<void> {
    const Notifications = getNotificationsModule();
    if (!Notifications) {
      this.notificationsAvailable = false;
      return;
    }
    const allowed = await this.ensurePermissions();
    if (!allowed) return;

    if (this.notificationId) {
      try {
        await Notifications.dismissNotificationAsync(this.notificationId);
      } catch {
        // noop
      }
    }

    this.notificationId = await Notifications.scheduleNotificationAsync({
      content: this.buildContent(workout, unit),
      trigger: null,
    });
  }

  async start(workout: Workout, unit: 'kg' | 'lb'): Promise<void> {
    if (!this.notificationsAvailable) return;
    await this.update(workout, unit);

    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      this.update(workout, unit).catch(() => undefined);
    }, 5000);
  }

  async stop(): Promise<void> {
    const Notifications = getNotificationsModule();
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.notificationId && Notifications) {
      try {
        await Notifications.dismissNotificationAsync(this.notificationId);
      } catch {
        // noop
      }
      this.notificationId = null;
    }
  }
}

export const workoutNotificationService = new WorkoutNotificationService();
