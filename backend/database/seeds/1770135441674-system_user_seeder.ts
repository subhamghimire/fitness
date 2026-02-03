import { DataSource } from 'typeorm';
import { Seeder, SeederFactoryManager } from 'typeorm-extension';
import { User } from '../../src/modules/users/entities/user.entity';
import * as bcrypt from 'bcrypt';

export class SystemUserSeeder1770135441674 implements Seeder {
  track = false;

  public async run(
    dataSource: DataSource,
    factoryManager: SeederFactoryManager
  ): Promise<any> {
    const userRepo = dataSource.getRepository(User);

    const email = 'system@udyamcoach.com';
    const existingUser = await userRepo.findOne({ where: { email } });

    if (existingUser) {
      // If user exists but verify it's the specific system user we expect?
      // For now just log and skip
      console.log(`System user with email ${email} already exists:`, existingUser.id);
      return;
    }

    const hashedPassword = await bcrypt.hash('password', 10);

    const newUser = userRepo.create({
      name: 'System',
      email: email,
      password: hashedPassword,
    });

    await userRepo.save(newUser);
    console.log('Created System user:', newUser.id);
  }
}
