import { createServer } from 'node:http';

export type RecordedRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
};

export async function startServer(
  handler: (request: RecordedRequest, response: import('node:http').ServerResponse) => void | Promise<void>,
) {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const recorded = {
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: request.headers,
    };
    requests.push(recorded);
    Promise.resolve(handler(recorded, response)).catch((error) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
