import { Stack } from 'expo-router';

export default function WorkoutLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitleAlign: 'center',
      }}
    >
      <Stack.Screen
        name="[id]"
        options={{
          title: 'Workout',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="exercise-picker"
        options={{
          title: 'Add Exercise',
          presentation: 'modal',
        }}
      />
      <Stack.Screen
        name="exercise-history"
        options={{
          title: 'Exercise History',
        }}
      />
    </Stack>
  );
}
