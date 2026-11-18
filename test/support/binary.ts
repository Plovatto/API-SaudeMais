import type { Response } from 'superagent';

export const binary = (response: Response, done: (error: Error | null, body: Buffer) => void) => {
  const stream = response as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
};
