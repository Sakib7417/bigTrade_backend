import { prisma } from '../../config/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/error.middleware.js';
import { WalletService } from '../wallet/wallet.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { toDecimal } from '../../utils/money.js';
import { earningCapInfo } from '../../utils/earnings.js';
import {
  CYCLE_DAYS,
  MS_DAY,
  MONTHLY_MIN_PCT,
  MONTHLY_MAX_PCT,
  DEFAULT_MIN_DAILY_PCT,
  DEFAULT_MAX_DAILY_PCT,
  floorMoney,
  toUtcDate,
  cycleFor,
  isWeekend,
  workdaysBetween,
  isPayoutWindowOpen,
} from '../../utils/dailyroi.js';
import logger from '../../config/logger.js';

const walletService = new WalletService();
const commissionService = new CommissionService();
 
export class DailyRoiService {
  async getRateLimits() {
    const [min, max] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'DAILY_ROI_MIN_PCT' } }),
      prisma.systemSetting.findUnique({ where: { key: 'DAILY_ROI_MAX_PCT' } }),
    ]);
    return {
      min: toDecimal(min?.value ?? DEFAULT_MIN_DAILY_PCT),
      max: toDecimal(max?.value ?? DEFAULT_MAX_DAILY_PCT),
    };
  }

  async cumulativeForCycle(investmentId, cycleIndex) {
    const agg = await prisma.roiPayout.aggregate({
      where: { investmentId, cycleIndex, status: 'CREDITED' },
      _sum: { creditedAmount: true },
    });
    return toDecimal(agg._sum.creditedAmount ?? 0);
  }
 
  async getMinInvestment() {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'MIN_INVESTMENT' } });
    return toDecimal(setting?.value ?? '100');
  }

  // Per-date user exclusions — admin can block specific users from a day's ROI
  async getExcludedUserIds(roiDate) {
    const rows = await prisma.dailyRoiExclusion.findMany({
      where: { roiDate: toUtcDate(roiDate) },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  async getExclusions(roiDate) {
    return prisma.dailyRoiExclusion.findMany({
      where: { roiDate: toUtcDate(roiDate) },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setExclusion({ roiDate, userId, excluded, reason }, adminId, ipAddress = null) {
    const date = toUtcDate(roiDate);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) throw new NotFoundError('User not found');

    const existing = await prisma.dailyRoiExclusion.findUnique({
      where: { roiDate_userId: { roiDate: date, userId } },
    });

    let record = null;
    if (excluded && !existing) {
      record = await prisma.dailyRoiExclusion.create({
        data: { roiDate: date, userId, reason, createdBy: adminId },
      });
    } else if (!excluded && existing) {
      await prisma.dailyRoiExclusion.delete({ where: { id: existing.id } });
    }

    await prisma.auditLog.create({
      data: {
        adminId,
        action: excluded ? 'ADMIN_EXCLUDE_DAILY_ROI' : 'ADMIN_UNEXCLUDE_DAILY_ROI',
        targetType: 'USER',
        targetId: userId,
        ipAddress,
        metadata: { roiDate: date, reason },
      },
    });

    logger.info(
      `Daily ROI exclusion ${excluded ? 'added' : 'removed'}: user ${userId} for ${date.toISOString().slice(0, 10)} by ${adminId}`
    );
    return { excluded, record };
  }
 
  async eligibleInvestments(roiDate) {
    const minInvestment = await this.getMinInvestment();

    // Auto-deactivate: an ACTIVE investment below the minimum earns nothing
    await prisma.investment.updateMany({
      where: { status: 'ACTIVE', principal: { lt: minInvestment } },
      data: { status: 'INACTIVE' },
    });

    const investments = await prisma.investment.findMany({
      where: {
        status: 'ACTIVE',
        startedAt: { lte: new Date(toUtcDate(roiDate).getTime() + MS_DAY - 1) },
        principal: { gte: minInvestment },
      },
      select: { id: true, userId: true, principal: true, startedAt: true, earningCap: true, totalRoiEarned: true },
    });
    return investments.filter((i) => cycleFor(i.startedAt, roiDate) !== null);
  }
 
  async buildProjections(roiDate, ratePercent) {
    const limits = await this.getRateLimits();
    const investments = await this.eligibleInvestments(roiDate);
 
    const items = [];
    let totalPrincipal = toDecimal(0);
    let estDailyPayout = toDecimal(0);
    let projectedEndAmount = toDecimal(0);
    let projectedEndAmountMin = toDecimal(0);
    let projectedEndAmountMax = toDecimal(0);
    let paidThisCycle = toDecimal(0);
 
    for (const inv of investments) {
      const cycle = cycleFor(inv.startedAt, roiDate);
      const cumulative = await this.cumulativeForCycle(inv.id, cycle.index);
      const principal = toDecimal(inv.principal);
      const maxTarget = principal.mul(MONTHLY_MAX_PCT).div(100);
      const remainingCap = toDecimal(maxTarget.sub(cumulative)).greaterThan(0)
        ? maxTarget.sub(cumulative)
        : toDecimal(0);
 
      const daily = floorMoney(principal.mul(ratePercent).div(100));
      const actual = daily.lte(remainingCap) ? daily : remainingCap;

      // Projections count only remaining WORKING days — weekends carry no ROI
      const workdays = workdaysBetween(roiDate, cycle.cycleEnd);
      const projected = cumulative.add(actual).add(
        principal.mul(ratePercent).div(100).mul(Math.max(0, workdays - 1))
      );
      const projMin = cumulative.add(
        principal.mul(limits.min).div(100).mul(workdays)
      );
      const projMax = cumulative.add(
        principal.mul(limits.max).div(100).mul(workdays)
      );
 
      totalPrincipal = totalPrincipal.add(principal);
      estDailyPayout = estDailyPayout.add(actual);
      paidThisCycle = paidThisCycle.add(cumulative);
      projectedEndAmount = projectedEndAmount.add(projected);
      projectedEndAmountMin = projectedEndAmountMin.add(projMin);
      projectedEndAmountMax = projectedEndAmountMax.add(projMax);
 
      items.push({
        investmentId: inv.id,
        userId: inv.userId,
        principal,
        cycle,
        cumulative,
        remainingCap,
        dailyAmount: actual,
        projectedEnd: projected,
      });
    }

    // Smart suggestion: for each investment, the daily rate that lands the cycle
    // exactly on the 10% floor / 12% cap given paid-so-far and remaining
    // WORKING days (weekends are skipped). Aggregate across investments.
    const suggestion = this.suggestRate(roiDate, items, limits);
 
    const pct = (amount) =>
      totalPrincipal.gt(0) ? amount.div(totalPrincipal).mul(100).toDecimalPlaces(4) : toDecimal(0);
 
    return {
      limits,
      items,
      totalEligiblePrincipal: totalPrincipal,
      estimatedDailyPayout: estDailyPayout,
      paidThisCycle,
      projectedEndAmount,
      projectedEndPercent: pct(projectedEndAmount),
      projectedMinPercent: pct(projectedEndAmountMin),
      projectedMaxPercent: pct(projectedEndAmountMax),
      minRemainingDays: items.length ? Math.min(...items.map((i) => i.cycle.remainingDays)) : 0,
      maxRemainingDays: items.length ? Math.max(...items.map((i) => i.cycle.remainingDays)) : 0,
      suggestion,
      isWeekend: isWeekend(roiDate),
    };
  }

  // Suggested daily rate so every investment lands between the 10% floor and
  // 12% cap by cycle end — counting only remaining WORKING days.
  //   need_i  = (10% target − paid so far) ÷ workdays left   (per investment)
  //   max_i   = (12% cap   − paid so far) ÷ workdays left
  // suggested = highest need, but never above the lowest max or the limits
  suggestRate(roiDate, items, limits) {
    const zero = toDecimal(0);
    // No eligible investments yet — still show the range floor as default
    if (!items.length) {
      return {
        suggested: limits.min,
        suggestedMin: limits.min,
        suggestedMax: limits.max,
        remainingWorkdays: 0,
        noInvestments: true,
      };
    }

    let need = zero;
    let ceiling = null;
    let minWorkdays = null;

    for (const item of items) {
      const workdays = workdaysBetween(roiDate, item.cycle.cycleEnd);
      if (workdays <= 0) continue;
      minWorkdays = minWorkdays === null ? workdays : Math.min(minWorkdays, workdays);

      const paidPct = item.principal.gt(0)
        ? item.cumulative.div(item.principal).mul(100)
        : zero;

      const needRate = toDecimal(MONTHLY_MIN_PCT).sub(paidPct).div(workdays);
      if (needRate.gt(need)) need = needRate;

      const maxRate = toDecimal(MONTHLY_MAX_PCT).sub(paidPct).div(workdays);
      ceiling = ceiling === null ? maxRate : (maxRate.lt(ceiling) ? maxRate : ceiling);
    }

    if (minWorkdays === null) {
      return { suggested: null, suggestedMin: null, suggestedMax: null, remainingWorkdays: 0 };
    }

    // Clamp the suggestion into the allowed range and under everyone's cap
    const floor = need.gt(limits.min) ? need : limits.min;
    let suggested = floor;
    if (ceiling && suggested.gt(ceiling)) suggested = ceiling;
    if (suggested.gt(limits.max)) suggested = limits.max;
    if (suggested.lt(0)) suggested = zero;

    return {
      suggested: suggested.toDecimalPlaces(6),
      suggestedMin: need.gt(0) ? need.toDecimalPlaces(6) : toDecimal(0),
      suggestedMax: ceiling && ceiling.gt(0) ? ceiling.toDecimalPlaces(6) : toDecimal(0),
      remainingWorkdays: minWorkdays,
    };
  }
 
  async validateRate(roiDate, ratePercent) {
    const date = toUtcDate(roiDate);
    const rate = toDecimal(ratePercent);
    const limits = await this.getRateLimits();
    const errors = [];
    const warnings = [];
 
    const existing = await prisma.dailyRoiRate.findUnique({ where: { roiDate: date } });
    if (existing && ['PROCESSED', 'LOCKED'].includes(existing.status)) {
      errors.push(`A rate for ${date.toISOString().slice(0, 10)} is already processed and locked`);
    }
 
    if (rate.lt(limits.min) || rate.gt(limits.max)) {
      errors.push(
        `Rate must be between ${limits.min}% and ${limits.max}% (per 30-day target of ${MONTHLY_MIN_PCT}%–${MONTHLY_MAX_PCT}%)`
      );
    }
 
    const proj = await this.buildProjections(date, rate);

    if (isWeekend(date)) {
      warnings.push('Weekend — this date normally carries no ROI payout');
    }
 
    // Reject if projected cycle-end exceeds the 12% cap for ANY investment
    for (const item of proj.items) {
      const maxTarget = toDecimal(item.principal).mul(MONTHLY_MAX_PCT).div(100);
      if (item.projectedEnd.gt(maxTarget)) {
        errors.push(
          `Investment ${item.investmentId.slice(0, 8)}… projected cycle ROI ${item.projectedEnd
            .toDecimalPlaces(2)} exceeds the 12% cap (${maxTarget.toDecimalPlaces(2)}) — lower the rate`
        );
      }
    }
 
    // Warn if the 10% target is mathematically unreachable at max allowed rate
    const unreachable = proj.items.filter((item) => {
      const projMax = item.cumulative.add(
        toDecimal(item.principal).mul(limits.max).div(100).mul(item.cycle.remainingDays)
      );
      return projMax.lt(toDecimal(item.principal).mul(MONTHLY_MIN_PCT).div(100));
    });
    if (unreachable.length) {
      warnings.push(
        `${unreachable.length} investment(s) can no longer reach the 10% cycle target even at ${limits.max}%/day — mark "Target Unreachable"`
      );
    }
 
    if (proj.items.length === 0) {
      warnings.push('No eligible investments for this date — payout will be empty');
    }
 
    return { valid: errors.length === 0, errors, warnings, projections: proj };
  }
 
  async getCycleOverview(roiDate) {
    const date = toUtcDate(roiDate);
    const rate = await prisma.dailyRoiRate.findUnique({ where: { roiDate: date } });
    const proj = await this.buildProjections(date, rate?.ratePercent ?? (await this.getRateLimits()).min);
 
    const payoutStats = rate
      ? await prisma.roiPayout.groupBy({
          by: ['status'],
          where: { roiDate: date },
          _count: true,
          _sum: { creditedAmount: true },
        })
      : [];
 
    return { roiDate: date, rate, projections: proj, payoutStats };
  }
 
  async saveDraft({ roiDate, ratePercent, reason }, adminId) {
    const date = toUtcDate(roiDate);
    const existing = await prisma.dailyRoiRate.findUnique({ where: { roiDate: date } });
    if (existing && ['PROCESSED', 'LOCKED'].includes(existing.status)) {
      throw new ConflictError('This rate is already processed and cannot be changed');
    }
 
    const result = await this.validateRate(date, ratePercent);
    if (!result.valid) {
      throw new ValidationError(result.errors.join('; '));
    }
 
    const rate = await prisma.dailyRoiRate.upsert({
      where: { roiDate: date },
      create: {
        roiDate: date,
        ratePercent: toDecimal(ratePercent),
        status: 'DRAFT',
        reason,
        createdBy: adminId,
      },
      update: {
        ratePercent: toDecimal(ratePercent),
        status: 'DRAFT',
        reason,
        previousRate: existing?.ratePercent ?? null,
      },
    });
 
    logger.info(`Daily ROI draft saved: ${date.toISOString().slice(0, 10)} @ ${ratePercent}% by admin ${adminId}`);
    return { rate, validation: result };
  }
 
  async publish({ roiDate, ratePercent, reason }, adminId, ipAddress = null) {
    const date = toUtcDate(roiDate);
    const existing = await prisma.dailyRoiRate.findUnique({ where: { roiDate: date } });
 
    if (existing && ['PROCESSED', 'LOCKED'].includes(existing.status)) {
      throw new ConflictError('This rate is already processed and locked — payouts exist for it');
    }
 
    const rate = ratePercent != null ? ratePercent : existing?.ratePercent;
    if (rate == null) {
      throw new ValidationError('No draft exists for this date — provide a rate');
    }
 
    const result = await this.validateRate(date, rate);
    if (!result.valid) {
      throw new ValidationError(result.errors.join('; '));
    }
 
    const published = await prisma.$transaction(async (tx) => {
      const updated = await tx.dailyRoiRate.upsert({
        where: { roiDate: date },
        create: {
          roiDate: date,
          ratePercent: toDecimal(rate),
          status: 'PUBLISHED',
          reason,
          createdBy: adminId,
          publishedBy: adminId,
          publishedAt: new Date(),
        },
        update: {
          ratePercent: toDecimal(rate),
          status: 'PUBLISHED',
          reason,
          previousRate: existing?.ratePercent ?? null,
          publishedBy: adminId,
          publishedAt: new Date(),
        },
      });
 
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'ADMIN_PUBLISH_DAILY_ROI',
          targetType: 'DAILY_ROI_RATE',
          targetId: updated.id,
          ipAddress,
          metadata: {
            roiDate: date,
            newRate: String(rate),
            previousRate: existing?.ratePercent ?? null,
            reason,
            warnings: result.warnings,
          },
        },
      });
 
      return updated;
    });
 
    logger.info(
      `Daily ROI published: ${date.toISOString().slice(0, 10)} @ ${rate}% by admin ${adminId}`
    );
 
    return { rate: published, validation: result };
  }
 
  // Process payouts for a published rate. Idempotent — re-runs skip credited
  // rows, retry FAILED ones, and never double-credit (unique constraint).
  async processDaily(roiDate, adminId = null, ipAddress = null) {
    const date = toUtcDate(roiDate);
 
    const rate = await prisma.dailyRoiRate.findUnique({ where: { roiDate: date } });
    if (!rate) throw new NotFoundError('No rate exists for this date — save a draft first');
    if (rate.status !== 'PUBLISHED' && rate.status !== 'PROCESSED') {
      throw new ConflictError('Rate must be published before processing payouts');
    }

    // Admin may click Process any time — outside the 6–8 PM window the request
    // is queued and the cron credits wallets when the window opens
    if (!isPayoutWindowOpen()) {
      await prisma.dailyRoiRate.update({
        where: { id: rate.id },
        data: { processRequested: true },
      });
      logger.info(`Daily ROI payout queued for ${date.toISOString().slice(0, 10)} — credits in 6–8 PM window`);
      return {
        roiDate: date,
        rate,
        queued: true,
        summary: null,
        message: 'Queued — wallets will be credited between 6:00 PM and 8:00 PM',
      };
    }
 
    const investments = await this.eligibleInvestments(date);
    const excludedUsers = await this.getExcludedUserIds(date);
    const summary = { credited: 0, capped: 0, skipped: 0, failed: 0, totalCredited: toDecimal(0) };
 
    for (const inv of investments) {
      try {
        const outcome = await prisma.$transaction(async (tx) => {
          const cycle = cycleFor(inv.startedAt, date);
          const principal = toDecimal(inv.principal);
          const calculated = floorMoney(principal.mul(rate.ratePercent).div(100));
 
          // Existing row? CREDITED → skip; FAILED → retry
          const existing = await tx.roiPayout.findUnique({
            where: { investmentId_roiDate: { investmentId: inv.id, roiDate: date } },
          });
          if (existing && existing.status === 'CREDITED') {
            return 'skipped';
          }

          // Admin exclusion for this date — recorded as SKIPPED (visible + reversible)
          if (excludedUsers.has(inv.userId)) {
            await upsertPayout(tx, existing, {
              dailyRoiRateId: rate.id,
              roiDate: date,
              userId: inv.userId,
              investmentId: inv.id,
              ratePercent: rate.ratePercent,
              eligiblePrincipal: principal,
              calculatedAmount: calculated,
              creditedAmount: toDecimal(0),
              cycleIndex: cycle.index,
              status: 'SKIPPED',
              failureReason: 'Excluded by admin for this date',
            });
            return 'skipped';
          }
 
          const cumulative = await tx.roiPayout.aggregate({
            where: { investmentId: inv.id, cycleIndex: cycle.index, status: 'CREDITED' },
            _sum: { creditedAmount: true },
          }).then((a) => toDecimal(a._sum.creditedAmount ?? 0));
 
          // 12% monthly cycle cap
          const maxTarget = principal.mul(MONTHLY_MAX_PCT).div(100);
          const remainingCap = maxTarget.sub(cumulative);
          if (remainingCap.lte(0)) {
            await upsertPayout(tx, existing, {
              dailyRoiRateId: rate.id,
              roiDate: date,
              userId: inv.userId,
              investmentId: inv.id,
              ratePercent: rate.ratePercent,
              eligiblePrincipal: principal,
              calculatedAmount: calculated,
              creditedAmount: toDecimal(0),
              cycleIndex: cycle.index,
              status: 'CAPPED',
            });
            return 'capped';
          }
 
          // Global promoter cap: ALL income types combined vs 10x invested
          const incomeInfo = await earningCapInfo(inv.userId, tx);
          if (incomeInfo.remaining.lte(0)) {
            await tx.investment.update({ where: { id: inv.id }, data: { status: 'CAPPED' } });
            await upsertPayout(tx, existing, {
              dailyRoiRateId: rate.id,
              roiDate: date,
              userId: inv.userId,
              investmentId: inv.id,
              ratePercent: rate.ratePercent,
              eligiblePrincipal: principal,
              calculatedAmount: calculated,
              creditedAmount: toDecimal(0),
              cycleIndex: cycle.index,
              status: 'SKIPPED',
              failureReason: '10x income cap reached — top up to continue',
            });
            return 'skipped';
          }
 
          // Per-tranche cap (this investment's own 10x ROI limit)
          const earningCap = toDecimal(inv.earningCap);
          const earned = toDecimal(inv.totalRoiEarned);
          const remainingEarning = earningCap.sub(earned);
          if (remainingEarning.lte(0)) {
            await tx.investment.update({ where: { id: inv.id }, data: { status: 'CAPPED' } });
            await upsertPayout(tx, existing, {
              dailyRoiRateId: rate.id,
              roiDate: date,
              userId: inv.userId,
              investmentId: inv.id,
              ratePercent: rate.ratePercent,
              eligiblePrincipal: principal,
              calculatedAmount: calculated,
              creditedAmount: toDecimal(0),
              cycleIndex: cycle.index,
              status: 'SKIPPED',
              failureReason: 'Earning cap reached',
            });
            return 'skipped';
          }
 
          let credit = calculated.lte(remainingCap) ? calculated : remainingCap;
          if (credit.gt(remainingEarning)) credit = remainingEarning;
          if (credit.gt(incomeInfo.remaining)) credit = incomeInfo.remaining;
          credit = floorMoney(credit);
 
          const payout = await upsertPayout(tx, existing, {
            dailyRoiRateId: rate.id,
            roiDate: date,
            userId: inv.userId,
            investmentId: inv.id,
            ratePercent: rate.ratePercent,
            eligiblePrincipal: principal,
            calculatedAmount: calculated,
            creditedAmount: credit,
            cycleIndex: cycle.index,
            status: 'CREDITED',
          });
 
          // Credit wallet + ledger in the SAME transaction
          const { transaction } = await walletService.creditTx(
            tx,
            inv.userId,
            credit,
            'ROI',
            'DAILY_ROI',
            payout.id,
            `Daily ROI ${date.toISOString().slice(0, 10)} @ ${rate.ratePercent}%`,
            { roiDate: date, ratePercent: String(rate.ratePercent), investmentId: inv.id, cycleIndex: cycle.index },
            `daily-roi:${inv.id}:${date.toISOString().slice(0, 10)}`
          );
 
          await tx.roiPayout.update({
            where: { id: payout.id },
            data: { walletTransactionId: transaction.id },
          });
 
          // Update investment ROI totals + cap status
          const newEarned = earned.add(credit);
          await tx.investment.update({
            where: { id: inv.id },
            data: {
              totalRoiEarned: newEarned,
              status: newEarned.gte(earningCap) ? 'CAPPED' : 'ACTIVE',
            },
          });

          // Level income: this ROI credit distributes up the referral chain
          // (same tx — atomic; gated by sequential level qualification)
          await commissionService.distributeLevelIncomeTx(
            tx,
            inv.userId,
            credit,
            'DAILY_ROI',
            payout.id
          );
 
          return { credited: credit };
        });
 
        if (outcome === 'skipped') summary.skipped += 1;
        else if (outcome === 'capped') summary.capped += 1;
        else {
          summary.credited += 1;
          summary.totalCredited = summary.totalCredited.add(outcome.credited);
        }
      } catch (err) {
        // Record a FAILED payout row so admin can see + retry
        logger.error(`Daily ROI payout failed for investment ${inv.id}:`, err);
        try {
          const cycle = cycleFor(inv.startedAt, date);
          await prisma.roiPayout.upsert({
            where: { investmentId_roiDate: { investmentId: inv.id, roiDate: date } },
            create: {
              dailyRoiRateId: rate.id,
              roiDate: date,
              userId: inv.userId,
              investmentId: inv.id,
              ratePercent: rate.ratePercent,
              eligiblePrincipal: toDecimal(inv.principal),
              calculatedAmount: floorMoney(toDecimal(inv.principal).mul(rate.ratePercent).div(100)),
              creditedAmount: toDecimal(0),
              cycleIndex: cycle.index,
              status: 'FAILED',
              failureReason: err.message?.slice(0, 500),
            },
            update: {
              status: 'FAILED',
              failureReason: err.message?.slice(0, 500),
            },
          });
        } catch (e2) {
          logger.error(`Could not record FAILED payout for ${inv.id}:`, e2);
        }
        summary.failed += 1;
      }
    }
 
    // Lock the rate — no silent changes once payouts exist
    await prisma.dailyRoiRate.update({
      where: { id: rate.id },
      data: { status: 'PROCESSED', processedAt: new Date(), processRequested: false },
    });
 
    if (adminId) {
      await prisma.auditLog.create({
        data: {
          adminId,
          action: 'ADMIN_PROCESS_DAILY_ROI',
          targetType: 'DAILY_ROI_RATE',
          targetId: rate.id,
          ipAddress,
          metadata: {
            roiDate: date,
            credited: summary.credited,
            capped: summary.capped,
            skipped: summary.skipped,
            failed: summary.failed,
            totalCredited: String(summary.totalCredited),
          },
        },
      });
    }
 
    logger.info(
      `Daily ROI processed ${date.toISOString().slice(0, 10)}: ${summary.credited} credited, ${summary.capped} capped, ${summary.skipped} skipped, ${summary.failed} failed`
    );
 
    return { roiDate: date, rate, summary };
  }
 
  async getHistory(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [rates, total] = await Promise.all([
      prisma.dailyRoiRate.findMany({
        orderBy: { roiDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.dailyRoiRate.count(),
    ]);
    return { rates, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
 
  async getPayouts(roiDate = null, page = 1, limit = 20, status = null, userId = null) {
    const skip = (page - 1) * limit;
    const where = {};
    if (roiDate) where.roiDate = toUtcDate(roiDate);
    if (status) where.status = status;
    if (userId) where.userId = userId;
 
    const [payouts, total] = await Promise.all([
      prisma.roiPayout.findMany({
        where,
        orderBy: [{ roiDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
          investment: { select: { id: true, principal: true } },
        },
      }),
      prisma.roiPayout.count({ where }),
    ]);
    return { payouts, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
 
async function upsertPayout(tx, existing, data) {
  if (existing) {
    return tx.roiPayout.update({ where: { id: existing.id }, data });
  }
  return tx.roiPayout.create({ data });
}
 