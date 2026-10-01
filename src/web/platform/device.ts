/** "Safari on iPhone": how this browser appears in the account's device list. */
export function webDeviceName(ua = navigator.userAgent): string {
  const device = ua.includes('iPhone')
    ? 'iPhone'
    : ua.includes('iPad')
      ? 'iPad'
      : ua.includes('Android')
        ? 'Android'
        : ua.includes('Windows')
          ? 'Windows'
          : ua.includes('Mac OS X')
            ? 'Mac'
            : ua.includes('Linux')
              ? 'Linux'
              : 'web';
  const browser = /EdgA?\//.test(ua)
    ? 'Edge'
    : /Firefox|FxiOS/.test(ua)
      ? 'Firefox'
      : /CriOS|Chrome/.test(ua)
        ? 'Chrome'
        : ua.includes('Safari')
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${device} (web board)`;
}
