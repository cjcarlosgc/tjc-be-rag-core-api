import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { WebhookDelivery } from '../generated/prisma/client.js';

export interface RecordWebhookDeliveryInput {
  deliveryId: string;
  repositoryId: string;
  prNumber: number;
  headSha: string;
  event: string;
  action: string;
  analysisRunId: string | null;
}

@Injectable()
export class WebhookDeliveriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByDeliveryId(deliveryId: string): Promise<WebhookDelivery | null> {
    return this.prisma.webhookDelivery.findUnique({ where: { deliveryId } });
  }

  create(input: RecordWebhookDeliveryInput): Promise<WebhookDelivery> {
    return this.prisma.webhookDelivery.create({ data: input });
  }
}
