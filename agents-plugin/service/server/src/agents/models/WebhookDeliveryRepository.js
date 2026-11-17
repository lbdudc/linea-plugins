import { Container } from 'typedi';
import MongooseRepository from '../../model/repositories/MongooseRepository.js';
import WebhookDelivery from './WebhookDelivery.js';

export default class WebhookDeliveryRepository extends MongooseRepository {
  constructor() {
    super(WebhookDelivery);
  }

  async log(data) {
    return this.model.create(data);
  }

  async findRecent(limit = 50) {
    return this.model.find().sort({ createdAt: -1 }).limit(limit).lean();
  }
}

Container.set(WebhookDeliveryRepository, new WebhookDeliveryRepository());
