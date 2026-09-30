/** Shared webhook payloads for the Edge Function tests. */

const USER = '11111111-1111-4111-8111-111111111111';
export function subscriptionEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'subscription.updated',
    occurred_at: '2026-10-01T00:00:00.000Z',
    data: {
      id: 'sub_01',
      status: 'active',
      customer_id: 'ctm_01',
      custom_data: { user_id: USER },
      current_billing_period: {
        starts_at: '2026-10-01T00:00:00Z',
        ends_at: '2026-11-01T00:00:00Z',
      },
      billing_cycle: { interval: 'month', frequency: 1 },
      items: [{ price: { id: 'pri_pro_month', custom_data: null } }],
      ...overrides,
    },
  };
}
