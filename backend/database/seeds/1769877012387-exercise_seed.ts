import { DataSource } from "typeorm";
import { Seeder, SeederFactoryManager } from "typeorm-extension";
import { Exercise } from "src/modules/exercise/entities/exercise.entity";

export class ExerciseSeed1769877012387 implements Seeder {
  track = false;

  public async run(dataSource: DataSource, factoryManager: SeederFactoryManager): Promise<void> {
    const exerciseRepo = dataSource.getRepository(Exercise);

    const exercises: Partial<Exercise>[] = [
      {
        title: "Push Up",
        slug: "push-up",
        description: "A bodyweight exercise targeting chest, shoulders, and triceps.",
        images: ["pushup1.png", "pushup2.png"]
      },
      {
        title: "Squat",
        slug: "squat",
        description: "Compound lower body movement targeting quads and glutes.",
        images: ["squat.png"]
      },
      {
        title: "Plank",
        slug: "plank",
        description: "Isometric core strengthening exercise."
      },
      {
        title: "Lunges",
        slug: "lunges",
        description: "Lower body exercise improving balance and strength."
      },
      {
        title: "Burpees",
        slug: "burpees",
        description: "High intensity full body exercise."
      },
      {
        title: "Mountain Climbers",
        slug: "mountain-climbers",
        description: "Cardio move engaging core and legs."
      },
      {
        title: "Jumping Jacks",
        slug: "jumping-jacks",
        description: "Classic full body warm-up exercise."
      },
      {
        title: "Bicep Curls",
        slug: "bicep-curls",
        description: "Isolation exercise for biceps."
      },
      {
        title: "Tricep Dips",
        slug: "tricep-dips",
        description: "Upper body push exercise targeting triceps."
      },
      {
        title: "Shoulder Press",
        slug: "shoulder-press",
        description: "Strength exercise for shoulder muscles."
      },
      {
        title: "Deadlift",
        slug: "deadlift",
        description: "Compound exercise targeting posterior chain."
      },
      {
        title: "Bench Press",
        slug: "bench-press",
        description: "Chest-focused strength movement."
      },
      {
        title: "Pull Up",
        slug: "pull-up",
        description: "Upper body pulling exercise."
      },
      {
        title: "Lat Pulldown",
        slug: "lat-pulldown",
        description: "Back exercise emphasizing lat muscles."
      },
      {
        title: "Leg Press",
        slug: "leg-press",
        description: "Lower body machine-based strength exercise."
      },
      {
        title: "Calf Raises",
        slug: "calf-raises",
        description: "Isolation exercise for calf muscles."
      },
      {
        title: "Russian Twist",
        slug: "russian-twist",
        description: "Core rotation movement."
      },
      {
        title: "Leg Raises",
        slug: "leg-raises",
        description: "Abdominal strengthening exercise."
      },
      {
        title: "Hip Thrust",
        slug: "hip-thrust",
        description: "Glute-focused strength exercise."
      },
      {
        title: "Wall Sit",
        slug: "wall-sit",
        description: "Isometric lower body endurance exercise."
      }
    ];

    await exerciseRepo.upsert(exercises, ["slug"]);
  }
}
