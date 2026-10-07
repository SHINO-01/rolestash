import { encode } from 'uqr';
import { qrPath } from '@/ui/qr';

describe('qrPath', () => {
  it('draws one square per dark module, inside a quiet zone', () => {
    const url = 'https://rolestash.com/board/';
    const { size, d } = qrPath(url);
    const { data } = encode(url, { ecc: 'M', border: 2 });
    expect(size).toBe(data.length);
    expect(d.match(/M/g)).toHaveLength(data.flat().filter(Boolean).length);
    // The quiet zone stays light.
    expect(data[0]!.some(Boolean)).toBe(false);
    expect(d.startsWith('M2 2h1v1h-1z')).toBe(true);
  });
});
