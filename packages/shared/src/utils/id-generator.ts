let counter = 0;

export function generateId(prefix: string = 'rgl'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  counter += 1;
  return `${prefix}_${timestamp}_${random}_${counter}`;
}

export function generateRunId(): string {
  return generateId('run');
}

export function generateEventId(): string {
  return generateId('evt');
}
