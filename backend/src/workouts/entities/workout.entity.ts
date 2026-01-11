import { Entity, PrimaryColumn, Column, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Exercise } from './exercise.entity';
@Entity('workouts')
export class Workout {
  @PrimaryColumn('char', { length: 36 }) id: string;
  @Column('char', { length: 36, name: 'user_id' }) userId: string;
  @Column({ name: 'started_at', type: 'datetime' }) startedAt: Date;
  @Column({ name: 'ended_at', type: 'datetime', nullable: true }) endedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @ManyToOne(() => User, (u) => u.workouts, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
  @OneToMany(() => Exercise, (e) => e.workout, { cascade: true }) exercises: Exercise[];
}
