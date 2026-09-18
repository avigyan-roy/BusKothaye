import type { AppConfig } from '../config.js';
import { DynamoJourneyRepository } from './dynamodb.js';
import { MemoryJourneyRepository } from './memory.js';
import type { JourneyRepository } from './types.js';

export * from './types.js';
export { MemoryJourneyRepository } from './memory.js';
export { DynamoJourneyRepository } from './dynamodb.js';

/**
 * Pick the adapter from configuration.
 *
 * `config.ts` has already refused a production configuration that asks for memory
 * persistence, so there is no silent fallback here: if DynamoDB is configured and
 * unreachable, the process reports not-ready rather than quietly losing journeys.
 */
export function createRepository(config: AppConfig): JourneyRepository {
  if (config.dataDriver === 'dynamodb') {
    return new DynamoJourneyRepository({
      tableName: config.dynamoTable,
      region: config.awsRegion,
      endpoint: config.dynamoEndpoint,
    });
  }
  return new MemoryJourneyRepository();
}
