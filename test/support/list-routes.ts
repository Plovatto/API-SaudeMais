import type { Express } from 'express';

interface Layer {
  slash?: boolean;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

function collect(stack: Layer[]): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const path = layer.route.path.replace(/:(\w+)/g, '{$1}');
      return Object.keys(layer.route.methods)
        .filter((method) => method !== '_all')
        .map((method) => `${method.toUpperCase()} ${path}`);
    }
    if (layer.handle?.stack) {
      if (!layer.slash) throw new Error('listRoutes: mount routers at the root and declare full paths');
      return collect(layer.handle.stack);
    }
    return [];
  });
}

export function listRoutes(app: Express): string[] {
  return collect((app as unknown as { router: { stack: Layer[] } }).router.stack);
}
