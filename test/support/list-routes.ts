import type { Express } from 'express';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

function collect(stack: Layer[]): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const path = layer.route.path;
      return Object.keys(layer.route.methods)
        .filter((method) => method !== '_all')
        .map((method) => `${method.toUpperCase()} ${path}`);
    }
    return layer.handle?.stack ? collect(layer.handle.stack) : [];
  });
}

export function listRoutes(app: Express): string[] {
  return collect((app as unknown as { router: { stack: Layer[] } }).router.stack);
}
