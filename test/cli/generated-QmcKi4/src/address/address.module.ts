import { Module } from 'viga';
import { AddressController } from './address.controller.ts';
import { AddressService } from './address.service.ts';

@Module({
  controllers: [AddressController],
  providers: [AddressService],
})
export class AddressModule {}
