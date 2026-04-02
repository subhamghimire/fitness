import type { Workout } from '@/types';

export interface SummaryMetrics {
  totalWorkouts: number;
  totalVolume: number;
  avgDuration: number;
  currentStreak: number;
}

export interface PRData {
  maxWeight: number;
  maxReps: number;
  maxVolumeString: string;
}

export interface DailyActivity {
  date: string;
  weekday: string;
  workouts: number;
  sets: number;
  volume: number;
  topExercise: string | null;
  intensity: number;
}

export interface WeeklyWorkoutData {
  label: string;
  weekStart: string;
  weekEnd: string;
  workouts: number;
  sets: number;
  volume: number;
}

/**
 * Calculates high-level summary metrics.
 */
export function getSummaryMetrics(workouts: Workout[]): SummaryMetrics {
  const totalWorkouts = workouts.length;
  
  let totalVolume = 0;
  let totalDuration = 0;
  let validDurationCount = 0;

  const datesSet = new Set<string>();

  workouts.forEach((w) => {
    // Volume
    w.exercises.forEach((ex) => {
      ex.sets.forEach((s) => {
        totalVolume += (s.weight ?? 0) * (s.reps ?? 0);
      });
    });

    // Duration
    if (w.startedAt && w.endedAt) {
      const start = new Date(w.startedAt).getTime();
      const end = new Date(w.endedAt).getTime();
      const diff = Math.floor((end - start) / 1000);
      if (diff > 0) {
        totalDuration += diff;
        validDurationCount++;
      }
    }

    // Days for streak tracking
    if (w.startedAt) {
      const d = new Date(w.startedAt);
      const tzOffset = d.getTimezoneOffset() * 60000; // offset in milliseconds
      const localISOTime = new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
      datesSet.add(localISOTime);
    }
  });

  const avgDuration = validDurationCount > 0 ? Math.floor(totalDuration / validDurationCount) : 0;
  
  // Calculate Streak
  const uniqueDaysDesc = Array.from(datesSet).sort().reverse();
  let currentStreak = 0;
  
  const today = new Date();
  const tzOffsetToday = today.getTimezoneOffset() * 60000;
  const todayStr = new Date(today.getTime() - tzOffsetToday).toISOString().slice(0, 10);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tzOffsetYest = yesterday.getTimezoneOffset() * 60000;
  const yesterdayStr = new Date(yesterday.getTime() - tzOffsetYest).toISOString().slice(0, 10);

  if (uniqueDaysDesc.length > 0) {
    let checkDate = new Date(todayStr);
    
    // If not worked out today or yesterday, streak is broken
    if (uniqueDaysDesc[0] === todayStr || uniqueDaysDesc[0] === yesterdayStr) {
      checkDate = new Date(uniqueDaysDesc[0]); // start counting backwards from the most recent
      
      for (const dStr of uniqueDaysDesc) {
        const d = new Date(dStr);
        if (d.getTime() === checkDate.getTime()) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1); // move back exactly one day
        } else {
          break; // Gap found
        }
      }
    }
  }

  return { totalWorkouts, totalVolume, avgDuration, currentStreak };
}

/**
 * Returns a map of YYYY-MM-DD -> intensity (1-4).
 * Intensity is calculated relative to maximum daily volume.
 */
export function generateHeatmapData(workouts: Workout[]): Record<string, number> {
  const heatmap: Record<string, number> = {};
  const daily = getDailyActivity(workouts);
  Object.entries(daily).forEach(([dateStr, activity]) => {
    heatmap[dateStr] = activity.intensity;
  });
  return heatmap;
}

export function getDailyActivity(workouts: Workout[]): Record<string, DailyActivity> {
  const bucket: Record<string, { workouts: number; sets: number; volume: number; exerciseCounts: Record<string, number> }> = {};
  let maxDailyVolume = 0;

  workouts.forEach((workout) => {
    if (!workout.startedAt) return;
    const d = new Date(workout.startedAt);
    const tzOffset = d.getTimezoneOffset() * 60000;
    const dateStr = new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
    if (!bucket[dateStr]) {
      bucket[dateStr] = { workouts: 0, sets: 0, volume: 0, exerciseCounts: {} };
    }

    bucket[dateStr].workouts += 1;
    workout.exercises.forEach((exercise) => {
      bucket[dateStr].exerciseCounts[exercise.name] = (bucket[dateStr].exerciseCounts[exercise.name] || 0) + 1;
      exercise.sets.forEach((set) => {
        bucket[dateStr].sets += 1;
        bucket[dateStr].volume += (set.weight ?? 0) * (set.reps ?? 0);
      });
    });

    if (bucket[dateStr].volume > maxDailyVolume) maxDailyVolume = bucket[dateStr].volume;
  });

  const result: Record<string, DailyActivity> = {};
  Object.entries(bucket).forEach(([date, value]) => {
    const ratio = maxDailyVolume > 0 ? value.volume / maxDailyVolume : 0;
    const intensity =
      ratio > 0.75 ? 4 :
      ratio > 0.4 ? 3 :
      ratio > 0.1 ? 2 :
      value.workouts > 0 ? 1 : 0;

    const topExercise = Object.entries(value.exerciseCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    result[date] = {
      date,
      weekday: new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' }),
      workouts: value.workouts,
      sets: value.sets,
      volume: value.volume,
      topExercise,
      intensity,
    };
  });

  return result;
}

export function getWeeklyWorkoutData(workouts: Workout[], weeksToShow = 8): WeeklyWorkoutData[] {
  const weekBucket: Record<string, WeeklyWorkoutData> = {};
  const today = new Date();

  const getWeekStart = (date: Date) => {
    const copy = new Date(date);
    const day = copy.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday-based week
    copy.setDate(copy.getDate() + diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };

  workouts.forEach((workout) => {
    const started = new Date(workout.startedAt);
    const weekStart = getWeekStart(started);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const key = weekStart.toISOString().slice(0, 10);
    if (!weekBucket[key]) {
      weekBucket[key] = {
        label: `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        weekStart: key,
        weekEnd: weekEnd.toISOString().slice(0, 10),
        workouts: 0,
        sets: 0,
        volume: 0,
      };
    }

    weekBucket[key].workouts += 1;
    workout.exercises.forEach((exercise) => {
      weekBucket[key].sets += exercise.sets.length;
      exercise.sets.forEach((set) => {
        weekBucket[key].volume += (set.weight ?? 0) * (set.reps ?? 0);
      });
    });
  });

  const thisWeekStart = getWeekStart(today);
  const padded: WeeklyWorkoutData[] = [];
  for (let i = weeksToShow - 1; i >= 0; i--) {
    const weekStart = new Date(thisWeekStart);
    weekStart.setDate(thisWeekStart.getDate() - i * 7);
    const key = weekStart.toISOString().slice(0, 10);
    if (weekBucket[key]) {
      padded.push(weekBucket[key]);
    } else {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      padded.push({
        label: `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        weekStart: key,
        weekEnd: weekEnd.toISOString().slice(0, 10),
        workouts: 0,
        sets: 0,
        volume: 0,
      });
    }
  }

  return padded;
}

/**
 * Extracts PR data mapped by exercise normalized name.
 */
export function getExercisePRs(workouts: Workout[]): Record<string, PRData> {
  const prs: Record<string, PRData> = {};

  workouts.forEach((w) => {
    w.exercises.forEach((ex) => {
      const name = ex.name.trim().toLowerCase();
      if (!prs[name]) {
        prs[name] = { maxWeight: 0, maxReps: 0, maxVolumeString: '0' };
      }
      
      let exSessionVolume = 0;
      ex.sets.forEach((s) => {
        const wt = s.weight ?? 0;
        const rp = s.reps ?? 0;
        exSessionVolume += wt * rp;

        if (wt > prs[name].maxWeight) prs[name].maxWeight = wt;
        if (rp > prs[name].maxReps) prs[name].maxReps = rp;
      });

      const currentExVolStr = parseFloat(prs[name].maxVolumeString) || 0;
      if (exSessionVolume > currentExVolStr) {
        prs[name].maxVolumeString = exSessionVolume.toString();
      }
    });
  });

  return prs;
}

/**
 * Generates an array of generic insights based on recent performance.
 */
export function getSmartInsights(workouts: Workout[]): string[] {
  if (workouts.length < 2) return ["Complete more workouts to unlock smart insights!"];
  
  const insights: string[] = [];
  const ascWorkouts = [...workouts].reverse(); // oldest to newest
  
  // Volume progression insight
  const last = ascWorkouts[ascWorkouts.length - 1];
  const prev = ascWorkouts[ascWorkouts.length - 2];
  
  const getVol = (w: Workout) => w.exercises.reduce((acc, ex) => acc + ex.sets.reduce((sAcc, s) => sAcc + (s.weight ?? 0) * (s.reps ?? 0), 0), 0);
  
  const lastVol = getVol(last);
  const prevVol = getVol(prev);
  
  if (lastVol > prevVol && prevVol > 0) {
    const pct = Math.round(((lastVol - prevVol) / prevVol) * 100);
    insights.push(`You lifted ${pct}% more volume than your previous session! 🚀`);
  }

  // Streak insight
  const streak = getSummaryMetrics(workouts).currentStreak;
  if (streak > 2) {
    insights.push(`You're on a ${streak}-day streak 🔥 Keep the momentum going!`);
  }

  if (insights.length === 0) {
    insights.push("Consistency is key. Great job showing up!");
  }

  return insights;
}

/**
 * Extracts historical progression for a specific exercise to feed the chart.
 */
export function getExerciseProgression(workouts: Workout[], targetExerciseName: string): { label: string; value: number }[] {
  const data: { label: string; value: number, date: Date }[] = [];
  const name = targetExerciseName.trim().toLowerCase();

  workouts.forEach((w) => {
    if (!w.startedAt) return;
    const ex = w.exercises.find(e => e.name.trim().toLowerCase() === name);
    if (ex) {
      // We chart max weight for this session
      let maxW = 0;
      ex.sets.forEach(s => { if ((s.weight || 0) > maxW) maxW = s.weight || 0; });
      if (maxW > 0) {
        data.push({
          label: new Date(w.startedAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
          value: maxW,
          date: new Date(w.startedAt)
        });
      }
    }
  });

  // Sort chronological and take last 7
  return data.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(-7).map(d => ({ label: d.label, value: d.value }));
}
