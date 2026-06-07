import { describe } from 'vitest';
import { getPass, type TestPass } from './pass';

export function serverSide(fn: () => void): void {
  describeInPass('server', fn);
}

export function clientSide(fn: () => void): void {
  describeInPass('client', fn);
}

function describeInPass(pass: TestPass, fn: () => void): void {
  if (getPass() === pass) {
    describe(`(${pass})`, fn);
  }
}
