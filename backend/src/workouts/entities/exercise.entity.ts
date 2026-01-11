import { Entity, PrimaryColumn, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Workout } from './workout.entity';
import { Set } from './set.entity';
@Entity('exercises')
export class Exercise {
  @PrimaryColumn('char', { length: 36 }) id: string;
  @Column('char', { length: 36, name: 'workout_id' }) workoutId: string;
  @Column({ length: 255 }) name: string;
  @Column({ name: 'order_index', type: 'int' }) orderIndex: number;
  @ManyToOne(() => Workout, (w) => w.exercises, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'workout_id' }) workout: Workout;
  @OneToMany(() => Set, (s) => s.exercise, { cascade: true }) sets: Set[];
}
