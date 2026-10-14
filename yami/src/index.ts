export class Yami {
  sayHello(): string {
    return "hello yami";
  }
}

export function createYami(): Yami {
  return new Yami();
}
