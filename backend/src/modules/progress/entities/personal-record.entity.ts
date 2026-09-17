import { Entity, Column, Index } from "typeorm";
import { AbstractEntity } from "src/entities";
import { PersonalRecordType } from "../enums/progress.enum";

/**
 * PERSONAL RECORDS — the PR event chain.
 *
 * One row per time a running best was strictly exceeded (see
 * `detectPersonalRecords`). The chain is derived, never hand-edited: the
 * projection worker regenerates the *entire* chain for a (user, exercise) on
 * every mutation, so edits and deletions can never leave a stale PR behind.
 *
 * `value` is unit-encoded by `pr_type` (kg / reps / m / s), same convention as
 * the calculator. `exercise_id` is a soft reference (no FK) so the record
 * survives catalog deletion; `exercise_name` is the display snapshot.
 */
@Entity("personal_records")
@Index("idx_pr_user_achieved", ["userId", "achievedAt"])
@Index("idx_pr_user_exercise_type", ["userId", "exerciseId", "prType"])
export class PersonalRecord extends AbstractEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "exercise_id", type: "uuid", nullable: true })
  exerciseId: string | null;

  @Column({ name: "exercise_name", type: "varchar", length: 200, nullable: true })
  exerciseName: string | null;

  @Column({ name: "pr_type", type: "varchar", length: 40 })
  prType: PersonalRecordType;

  @Column({ type: "double precision" })
  value: number;

  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @Column({ name: "workout_exercise_id", type: "uuid" })
  workoutExerciseId: string;

  @Index("idx_pr_achieved_at")
  @Column({ name: "achieved_at", type: "timestamp" })
  achievedAt: Date;
}
