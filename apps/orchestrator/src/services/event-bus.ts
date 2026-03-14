import type Redis from 'ioredis';
import type { AgentEvent } from '@rigelhq/shared';
import { REDIS_CHANNELS, REDIS_STREAMS } from '@rigelhq/shared';

export class EventBus {
  constructor(
    private publisher: Redis,
    private subscriber: Redis,
  ) {}

  /** Dual-write: publish to Pub/Sub + append to Stream */
  async publish(event: AgentEvent): Promise<void> {
    const payload = JSON.stringify(event);

    // Write to persistent Redis Stream
    await this.publisher.xadd(
      REDIS_STREAMS.EVENTS,
      '*',
      'data', payload,
    );

    // Also write to per-agent stream
    await this.publisher.xadd(
      REDIS_STREAMS.agentEvents(event.agentId),
      '*',
      'data', payload,
    );

    // Publish to Pub/Sub for real-time subscribers
    await this.publisher.publish(REDIS_CHANNELS.EVENTS, payload);
    await this.publisher.publish(REDIS_CHANNELS.agentEvents(event.agentId), payload);
  }

  /** Publish agent status update */
  async publishStatus(agentId: string, status: string): Promise<void> {
    await this.publisher.publish(
      REDIS_CHANNELS.agentStatus(agentId),
      JSON.stringify({ agentId, status, timestamp: Date.now() }),
    );
  }

  /** Subscribe to real-time events */
  async subscribe(
    channel: string,
    callback: (event: AgentEvent) => void,
  ): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          callback(JSON.parse(message));
        } catch {
          // Ignore non-JSON messages
        }
      }
    });
  }

  /** Read event history from Stream for replay on reconnect */
  async getHistory(
    streamKey: string,
    lastId: string = '0',
    count: number = 100,
  ): Promise<AgentEvent[]> {
    const results = await this.publisher.xrange(streamKey, lastId, '+', 'COUNT', count);
    return results.map(([, fields]) => {
      const dataIndex = fields.indexOf('data');
      return JSON.parse(fields[dataIndex + 1]) as AgentEvent;
    });
  }
}
