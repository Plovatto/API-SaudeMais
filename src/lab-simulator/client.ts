import { setTimeout as sleep } from 'node:timers/promises';
import { MINUTE } from '../lib/time.js';
import {
  resultReceiptSchema,
  worklistSchema,
  type ResultInput,
  type ResultReceipt,
  type Worklist,
} from '../modules/lab-integration/lab-integration.model.js';

const REQUEST_TIMEOUT = 15_000;
const RETRY_DELAY = 1_000;

export interface LabClientOptions {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<unknown>;
}

export type Publication = ResultReceipt['outcome'] | { failed: number | 'network'; code?: string };

function retryDelayOf(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MINUTE) : MINUTE;
}

export class LabClient {
  private readonly fetch: typeof fetch;
  private readonly wait: (ms: number) => Promise<unknown>;

  constructor(private readonly options: LabClientOptions) {
    this.fetch = options.fetch ?? fetch;
    this.wait = options.wait ?? sleep;
  }

  async worklist(date: string): Promise<Worklist> {
    const response = await this.send(`/api/integrations/lab/worklist?date=${date}`);
    if (!response.ok) throw new Error(`Worklist request failed with status ${response.status}`);
    return worklistSchema.parse(await response.json());
  }

  async publish(result: ResultInput): Promise<Publication> {
    let response: Response;
    try {
      response = await this.send('/api/integrations/lab/results', { method: 'POST', body: JSON.stringify(result) });
    } catch {
      return { failed: 'network' };
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) return resultReceiptSchema.parse(body).outcome;
    const code = (body as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' ? { failed: response.status, code } : { failed: response.status };
  }

  private async send(path: string, init: RequestInit = {}): Promise<Response> {
    const request = () =>
      this.fetch(new URL(path, this.options.apiUrl), {
        ...init,
        headers: { 'X-Api-Key': this.options.apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
    const response = await request().catch(() => undefined);
    if (response && response.status !== 429 && response.status < 500) return response;
    await response?.body?.cancel();
    await this.wait(response?.status === 429 ? retryDelayOf(response) : RETRY_DELAY);
    return request();
  }
}
