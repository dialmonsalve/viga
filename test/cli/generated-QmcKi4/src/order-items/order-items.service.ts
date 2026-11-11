import { Injectable, NotFoundException } from '../../../../../src/index.ts';

export interface OrderItem {
  id: number;
  name: string;
}

@Injectable()
export class OrderItemsService {
  private readonly items = new Map<number, OrderItem>();
  private nextId = 1;

  findAll() {
    return [...this.items.values()];
  }

  findOne(id: number) {
    const item = this.items.get(id);
    if (!item) throw new NotFoundException();
    return item;
  }

  create(data: { name: string }) {
    const item = { id: this.nextId++, ...data };
    this.items.set(item.id, item);
    return item;
  }

  update(id: number, data: { name?: string | undefined }) {
    const item = { ...this.findOne(id), ...(data.name === undefined ? {} : { name: data.name }) };
    this.items.set(id, item);
    return item;
  }

  remove(id: number) {
    this.findOne(id);
    this.items.delete(id);
  }
}
