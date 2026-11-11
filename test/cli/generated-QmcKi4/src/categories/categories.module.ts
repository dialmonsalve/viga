import { Module } from 'viga';
import { CategoriesController } from './categories.controller.ts';
import { CategoriesService } from './categories.service.ts';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
