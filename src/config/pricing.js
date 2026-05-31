
export const GOAL_TOKEN_PACKS = {
  impulse: { id: 'impulse', goalTokens: 50, priceUSD: 0.99 },
  warrior: { id: 'warrior', goalTokens: 250, priceUSD: 3.99 },
  tribe_leader: { id: 'tribe_leader', goalTokens: 1000, priceUSD: 9.99 },
};

export const REGIONAL_CONFIG = {
  ZAR: {
    currency: 'ZAR',
    symbol: 'R',
    provider: 'paystack',
    pro: {
      monthly: { price: 39.99 },
      annual: { price: 399.99 },
    },
    packs: {
      impulse: { price: 19.99, label: 'R19.99' },
      warrior: { price: 79.99, label: 'R79.99' },
      tribe_leader: { price: 199.99, label: 'R199.99' },
    }
  },
  NGN: {
    currency: 'NGN',
    symbol: '₦',
    provider: 'paystack',
    pro: {
      monthly: { price: 3000 },
      annual: { price: 30000 },
    },
    packs: {
      impulse: { price: 1500, label: '₦1,500' },
      warrior: { price: 6000, label: '₦6,000' },
      tribe_leader: { price: 15000, label: '₦15,000' },
    }
  },
  KES: {
    currency: 'KES',
    symbol: 'KSh',
    provider: 'paystack',
    pro: {
      monthly: { price: 260 },
      annual: { price: 2600 },
    },
    packs: {
      impulse: { price: 130, label: 'KSh 130' },
      warrior: { price: 520, label: 'KSh 520' },
      tribe_leader: { price: 1300, label: 'KSh 1,300' },
    }
  },
  GHS: {
    currency: 'GHS',
    symbol: 'GH₵',
    provider: 'paystack',
    pro: {
      monthly: { price: 30 },
      annual: { price: 300 },
    },
    packs: {
      impulse: { price: 15, label: 'GH₵ 15' },
      warrior: { price: 60, label: 'GH₵ 60' },
      tribe_leader: { price: 150, label: 'GH₵ 150' },
    }
  },
  EGP: {
    currency: 'EGP',
    symbol: 'E£',
    provider: 'stripe',
    pro: {
      monthly: { price: 100 },
      annual: { price: 1000 },
    },
    packs: {
      impulse: { price: 50, label: 'E£ 50' },
      warrior: { price: 200, label: 'E£ 200' },
      tribe_leader: { price: 500, label: 'E£ 500' },
    }
  },
  TZS: {
    currency: 'TZS',
    symbol: 'TSh',
    provider: 'stripe',
    pro: {
      monthly: { price: 5000 },
      annual: { price: 50000 },
    },
    packs: {
      impulse: { price: 2500, label: 'TSh 2,500' },
      warrior: { price: 10000, label: 'TSh 10,000' },
      tribe_leader: { price: 25000, label: 'TSh 25,000' },
    }
  },
  // Add more as needed for Big 15
};

export function getPricingForCurrency(currency) {
  return REGIONAL_CONFIG[currency.toUpperCase()] || REGIONAL_CONFIG['ZAR'];
}
