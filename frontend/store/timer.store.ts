import { create } from 'zustand';

interface TimerState {
  isActive: boolean;
  timeLeft: number;
  duration: number; // default 60s
  startTimer: (durationSeconds?: number) => void;
  stopTimer: () => void;
  tick: () => void;
  adjustTimer: (seconds: number) => void;
}

export const useTimerStore = create<TimerState>((set, get) => {
  let interval: NodeJS.Timeout | null = null;

  const clearTimerInterval = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  };

  return {
    isActive: false,
    timeLeft: 0,
    duration: 60,

    startTimer: (durationSeconds = 60) => {
      clearTimerInterval();
      set({ isActive: true, duration: durationSeconds, timeLeft: durationSeconds });
      
      interval = setInterval(() => {
        get().tick();
      }, 1000);
    },

    stopTimer: () => {
      clearTimerInterval();
      set({ isActive: false, timeLeft: 0 });
    },

    tick: () => {
      const { timeLeft, isActive } = get();
      if (!isActive) return;
      
      if (timeLeft <= 1) {
        // Timer finished
        get().stopTimer();
        // Here you would trigger haptics
      } else {
        set({ timeLeft: timeLeft - 1 });
      }
    },

    adjustTimer: (seconds) => {
      const { timeLeft, isActive } = get();
      if (!isActive) return;
      const newTime = Math.max(0, timeLeft + seconds);
      if (newTime === 0) {
        get().stopTimer();
      } else {
        set({ timeLeft: newTime });
      }
    }
  };
});
