#!/usr/bin/env node
/**
 * Create the journey table in DynamoDB Local.
 *
 * `npm run dynamodb:init` after `docker compose --profile dynamodb up`.
 *
 * It refuses to run against a real AWS endpoint: creating tables is a
 * provisioning job for CloudFormation (`infra/01-data.yaml`), not for a
 * development script with ambient credentials.
 */
import process from 'node:process';
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const tableName = process.env.DYNAMODB_TABLE ?? 'buskothay-dev';

if (!/^https?:\/\/(localhost|127\.0\.0\.1|dynamodb)(:|\/|$)/.test(endpoint)) {
  console.error(
    `Refusing to run against ${endpoint}. This script is for DynamoDB Local only;\n` +
      'use infra/01-data.yaml to provision the real table.',
  );
  process.exit(2);
}

const client = new DynamoDBClient({
  endpoint,
  region: process.env.AWS_REGION ?? 'ap-south-1',
  // Dummy credentials scoped to the local process. Never ship these to AWS.
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

try {
  await client.send(new DescribeTableCommand({ TableName: tableName }));
  console.log(`Table "${tableName}" already exists at ${endpoint}.`);
  process.exit(0);
} catch (error) {
  if (error?.name !== 'ResourceNotFoundException') throw error;
}

await client.send(
  new CreateTableCommand({
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
  }),
);

try {
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    }),
  );
} catch {
  // DynamoDB Local accepts the table but not always the TTL call. Application
  // reads filter expired records anyway, so this is not fatal locally.
  console.warn('TTL could not be enabled locally; application-level expiry still applies.');
}

console.log(`Created table "${tableName}" at ${endpoint}.`);
