import { isIPv6 } from 'node:net';
import { diagnostic } from '../diagnostics.ts';

function toWords(ipv6: string) {
  const text = ipv6.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) =>
    [(a << 8) | b, (c << 8) | d].map((word) => word.toString(16)).join(':')
  );
  const [head = '', tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((word) => Number.parseInt(word, 16));
}

export function ipKey(address: string, ipv6Subnet = 56) {
  if (!Number.isInteger(ipv6Subnet) || ipv6Subnet < 1 || ipv6Subnet > 128) {
    throw new Error(diagnostic('rateLimit.invalidIpv6Subnet', { ipv6Subnet }));
  }
  const ip = address.split('%')[0] ?? address;
  if (!isIPv6(ip)) return ip;

  const words = toWords(ip);
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const [high = 0, low = 0] = words.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }

  const prefix = words.map((word, index) => {
    const bits = Math.min(16, Math.max(0, ipv6Subnet - index * 16));
    return (word & (0xffff << (16 - bits))) & 0xffff;
  });
  return `${prefix.map((word) => word.toString(16)).join(':')}/${ipv6Subnet}`;
}
