import { Stack } from 'expo-router';

export default function WorkoutLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
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
    </Stack>
  );
}
