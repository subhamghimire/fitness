import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Workout } from '../../workouts/entities/workout.entity';
@Entity('users')
export class User {
  @PrimaryColumn('char', { length: 36 }) id: string;
  @Column({ unique: true }) email: string;
  @Column() password: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @OneToMany(() => Workout, (w) => w.user) workouts: Workout[];
}
