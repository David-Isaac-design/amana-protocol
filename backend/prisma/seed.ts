import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Clear existing data (respecting foreign key constraints)
  await prisma.dispute.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.processedEvent.deleteMany({});

  // Create 3 demo users with properly formatted wallet addresses (lowercase)
  const user1 = await prisma.user.create({
    data: {
      walletAddress: 'gbk7d7z5qhqp3m6v2x8j1n4c5r7t9w2k', // Already lowercase
      displayName: 'Alice',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      walletAddress: 'gk8e9f2g1h3i4j5k6l7m8n9o0p1q2w3e', // Already lowercase
      displayName: 'Bob',
    },
  });

  const user3 = await prisma.user.create({
    data: {
      walletAddress: 'gr3t4y5u6i7o8p9a0s1d2f3g4h5j6k7l', // Already lowercase
      displayName: 'Charlie',
    },
  });

  console.log('✓ Created 3 demo users');

  // Create 2 demo trades
  const trade1 = await prisma.trade.create({
    data: {
      tradeId: 'trade_001',
      buyerAddress: user1.walletAddress,
      sellerAddress: user2.walletAddress,
      amountUsdc: '1000.50',
      status: 'COMPLETED',
    },
  });

  const trade2 = await prisma.trade.create({
    data: {
      tradeId: 'trade_002',
      buyerAddress: user2.walletAddress,
      sellerAddress: user3.walletAddress,
      amountUsdc: '500.25',
      status: 'DELIVERED',
    },
  });

  console.log('✓ Created 2 demo trades');

  // Create a sample dispute for trade_001
  const dispute1 = await prisma.dispute.create({
    data: {
      tradeId: trade1.tradeId,
      initiator: user1.walletAddress,
      reason: 'Item not received as described',
      status: 'UNDER_REVIEW',
    },
  });

  console.log('✓ Created 1 sample dispute');

  // Pilot demo accounts (#128) — see docs/pilot-demo-script.md.
  // Point these at testnet wallets you control (DEMO_*_ADDRESS) so you can sign
  // in with them; the placeholders only exist so the seed runs without setup.
  const demo = await seedPilotDemo();
  console.log('✓ Created pilot demo accounts and trades');
  console.log('Pilot demo:', demo);

  console.log('\n✅ Database seed completed successfully!');
  console.log('Demo Users:', { user1, user2, user3 });
  console.log('Demo Trades:', { trade1, trade2 });
  console.log('Demo Dispute:', { dispute1 });
}

const DEMO_PLACEHOLDERS = {
  seller: 'gdemoseller000000000000000000000000000000000000000000000',
  buyer: 'gdemobuyer0000000000000000000000000000000000000000000000',
  mediator: 'gdemomediator00000000000000000000000000000000000000000',
};

/** Wallet addresses are always stored lowercase. */
function demoAddress(envKey: string, fallback: string): string {
  return (process.env[envKey]?.trim() || fallback).toLowerCase();
}

/**
 * Seeds the accounts and trades used by the guided pilot demo
 * (docs/pilot-demo-script.md). Idempotent: safe to re-run before each demo.
 *
 * - Seller and buyer are ordinary users.
 * - The mediator is a user whose address must ALSO be in ADMIN_STELLAR_PUBKEYS
 *   (the mediator allowlist) for the mediator console to open.
 * - The driver has no account: their name and ID are entered by the seller on
 *   the dispatch manifest.
 */
export async function seedPilotDemo(client: PrismaClient = prisma) {
  const seller = demoAddress('DEMO_SELLER_ADDRESS', DEMO_PLACEHOLDERS.seller);
  const buyer = demoAddress('DEMO_BUYER_ADDRESS', DEMO_PLACEHOLDERS.buyer);
  const mediator = demoAddress('DEMO_MEDIATOR_ADDRESS', DEMO_PLACEHOLDERS.mediator);

  const users = [
    { walletAddress: seller, displayName: 'Demo Seller — Kano Grains Co-op' },
    { walletAddress: buyer, displayName: 'Demo Buyer — Lagos Foods Ltd' },
    { walletAddress: mediator, displayName: 'Demo Mediator' },
  ];
  for (const user of users) {
    await client.user.upsert({
      where: { walletAddress: user.walletAddress },
      update: { displayName: user.displayName },
      create: user,
    });
  }

  // Ready-made trades so the dispatch and dispute steps can be shown without
  // waiting on earlier on-chain steps.
  const trades = [
    { tradeId: 'demo_funded', status: 'FUNDED' as const, amountUsdc: '250.0000000' },
    { tradeId: 'demo_disputed', status: 'DISPUTED' as const, amountUsdc: '120.0000000' },
  ];
  for (const trade of trades) {
    await client.trade.upsert({
      where: { tradeId: trade.tradeId },
      update: { status: trade.status, buyerAddress: buyer, sellerAddress: seller },
      create: {
        ...trade,
        buyerAddress: buyer,
        sellerAddress: seller,
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      },
    });
  }

  const existingDispute = await client.dispute.findFirst({ where: { tradeId: 'demo_disputed' } });
  if (!existingDispute) {
    await client.dispute.create({
      data: {
        tradeId: 'demo_disputed',
        initiator: buyer,
        reason: 'Demo: 3 of 20 bags arrived water-damaged',
        status: 'UNDER_REVIEW',
      },
    });
  }

  return { seller, buyer, mediator, trades: trades.map((t) => t.tradeId) };
}

if (require.main === module) {
main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
}
