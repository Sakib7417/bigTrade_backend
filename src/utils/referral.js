import { prisma } from '../config/database.js';
import { LIVE_INVESTMENT_STATUSES } from './commission.js';

export const generateReferralCode = (prefix = '') => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = prefix;
  for (let i = code.length; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const getUplineChain = async (userId, maxLevel = 20, db = prisma) => {
  const upline = [];
  let currentUser = await db.user.findUnique({
    where: { id: userId },
    select: { referredBy: true },
  });

  let level = 1;
  while (currentUser?.referredBy && level <= maxLevel) {
    upline.push({
      userId: currentUser.referredBy.id,
      level,
    });
    currentUser = await db.user.findUnique({
      where: { id: currentUser.referredBy.id },
      select: { referredBy: true },
    });
    level++;
  }

  return upline;
};

export const getReferralTree = async (userId, maxDepth = 20) => {
  const getChildren = async (parentId, depth = 0) => {
    if (depth >= maxDepth) return [];

    const children = await prisma.user.findMany({
      where: { referredById: parentId },
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const ids = children.map((c) => c.id);
    const [directCounts, activeDirectRows, invested, activeInv] = ids.length
      ? await Promise.all([
          prisma.user.groupBy({
            by: ['referredById'],
            where: { referredById: { in: ids } },
            _count: { _all: true },
          }),
          prisma.user.findMany({
            where: {
              referredById: { in: ids },
              status: 'ACTIVE',
              investments: { some: { status: { in: LIVE_INVESTMENT_STATUSES } } },
            },
            select: { referredById: true },
          }),
          prisma.investment.groupBy({
            by: ['userId'],
            where: { userId: { in: ids }, status: { not: 'CANCELLED' } },
            _sum: { amount: true },
          }),
          prisma.investment.groupBy({
            by: ['userId'],
            where: { userId: { in: ids }, status: { in: LIVE_INVESTMENT_STATUSES } },
            _sum: { amount: true },
          }),
        ])
      : [[], [], [], []];

    const directMap = new Map(directCounts.map((d) => [d.referredById, d._count._all]));
    const activeDirectMap = new Map();
    for (const r of activeDirectRows) {
      activeDirectMap.set(r.referredById, (activeDirectMap.get(r.referredById) ?? 0) + 1);
    }
    const investedMap = new Map(invested.map((d) => [d.userId, Number(d._sum.amount ?? 0)]));
    const activeMap = new Map(activeInv.map((d) => [d.userId, Number(d._sum.amount ?? 0)]));

    const result = [];
    for (const child of children) {
      const childData = {
        ...child,
        level: depth + 1,
        directs: directMap.get(child.id) ?? 0,
        activeDirects: activeDirectMap.get(child.id) ?? 0,
        invested: investedMap.get(child.id) ?? 0,
        activeInvested: activeMap.get(child.id) ?? 0,
        children: await getChildren(child.id, depth + 1),
      };
      result.push(childData);
    }

    return result;
  };

  const root = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      referralCode: true,
      status: true,
      createdAt: true,
    },
  });

  if (!root) return null;

  return {
    ...root,
    level: 0,
    children: await getChildren(userId, 0),
  };
};

export const getDirectReferrals = async (userId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [referrals, total] = await Promise.all([
    prisma.user.findMany({
      where: { referredById: userId },
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        status: true,
        createdAt: true,
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where: { referredById: userId } }),
  ]);

  return {
    referrals,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};
