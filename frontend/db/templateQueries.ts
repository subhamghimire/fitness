import { getDatabase } from './database';
import type { Template, TemplateLocal, TemplateExerciseLocal, TemplateSetLocal } from '@/types';

export async function insertTemplate(t: TemplateLocal): Promise<void> {
  await getDatabase().runAsync(`INSERT INTO templates_local (id, name, created_at) VALUES (?, ?, ?)`, [t.id, t.name, t.created_at]);
}

export async function insertTemplateExercise(e: TemplateExerciseLocal): Promise<void> {
  await getDatabase().runAsync(`INSERT INTO template_exercises_local (id, template_id, name, order_index) VALUES (?, ?, ?, ?)`, [e.id, e.template_id, e.name, e.order_index]);
}

export async function insertTemplateSet(s: TemplateSetLocal): Promise<void> {
  await getDatabase().runAsync(`INSERT INTO template_sets_local (id, template_exercise_id, weight, reps, is_warmup, is_dropset, is_failure) VALUES (?, ?, ?, ?, ?, ?, ?)`, [s.id, s.template_exercise_id, s.weight, s.reps, s.is_warmup, s.is_dropset, s.is_failure]);
}

export async function getAllTemplates(): Promise<Template[]> {
  const rows = await getDatabase().getAllAsync<TemplateLocal>(`SELECT * FROM templates_local ORDER BY created_at DESC`);
  return Promise.all(rows.map(async r => {
    const exRows = await getDatabase().getAllAsync<TemplateExerciseLocal>('SELECT * FROM template_exercises_local WHERE template_id = ? ORDER BY order_index', [r.id]);
    const exercises = await Promise.all(exRows.map(async ex => {
      const setRows = await getDatabase().getAllAsync<TemplateSetLocal>('SELECT * FROM template_sets_local WHERE template_exercise_id = ?', [ex.id]);
      return {
        id: ex.id, templateId: ex.template_id, name: ex.name, orderIndex: ex.order_index,
        sets: setRows.map(s => ({ id: s.id, templateExerciseId: s.template_exercise_id, weight: s.weight, reps: s.reps, isWarmup: s.is_warmup === 1, isDropset: s.is_dropset === 1, isFailure: s.is_failure === 1 }))
      };
    }));
    return { id: r.id, name: r.name, createdAt: r.created_at, exercises };
  }));
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = getDatabase();
  const exs = await db.getAllAsync<TemplateExerciseLocal>('SELECT id FROM template_exercises_local WHERE template_id = ?', [id]);
  for (const ex of exs) {
    await db.runAsync('DELETE FROM template_sets_local WHERE template_exercise_id = ?', [ex.id]);
  }
  await db.runAsync('DELETE FROM template_exercises_local WHERE template_id = ?', [id]);
  await db.runAsync('DELETE FROM templates_local WHERE id = ?', [id]);
}
