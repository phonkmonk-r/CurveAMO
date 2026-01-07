import { assert } from "node:console";
import Constants from "../lib/Constants";
import Helpers from "../lib/Helpers";

export interface CurveStableSwapNGParams {
  n: number;                      // N_COINS
  amp: bigint;                    // A_precise() (already scaled by Constants.A_PRECISION in this contract)
  fee: bigint;                    // fee() (1e10 precision)
  offpegFeeMultiplier: bigint;    // offpeg_fee_multiplier() (1e10 precision)
  rates: bigint[];                // stored_rates() length n (1e18 precision multipliers)
}

export class CurveStableSwapNG {
  public readonly p: CurveStableSwapNGParams;

  // balances are `_balances()` i.e. LP balances excluding admin fees
  public balances: bigint[];
  public adminBalances: bigint[];
  public totalSupply: bigint;

  constructor(
    params: CurveStableSwapNGParams,
    balances: bigint[],
    totalSupply: bigint,
    adminBalances?: bigint[],
  ) {
    assert(balances.length === params.n, "balances length != n");
    assert(params.rates.length === params.n, "rates length != n");

    this.p = {
      n: params.n,
      amp: params.amp,
      fee: params.fee,
      offpegFeeMultiplier: params.offpegFeeMultiplier,
      rates: params.rates.slice(),
    };

    this.balances = balances.slice();
    this.adminBalances = adminBalances ? adminBalances.slice() : new Array(params.n).fill(0n);
    assert(this.adminBalances.length === params.n, "adminBalances length != n");
    this.totalSupply = totalSupply;
  }

  // ---------- snapshot/restore ----------
  snapshot(): { balances: bigint[]; adminBalances: bigint[]; totalSupply: bigint } {
    return {
      balances: this.balances.slice(),
      adminBalances: this.adminBalances.slice(),
      totalSupply: this.totalSupply,
    };
  }

  restore(s: { balances: bigint[]; adminBalances: bigint[]; totalSupply: bigint }): void {
    this.balances = s.balances.slice();
    this.adminBalances = s.adminBalances.slice();
    this.totalSupply = s.totalSupply;
  }

  clone(): CurveStableSwapNG {
    return new CurveStableSwapNG(this.p, this.balances, this.totalSupply, this.adminBalances);
  }

  private xp(balances?: bigint[]): bigint[] {
    const b = balances ?? this.balances;
    const out: bigint[] = [];
    for (let i = 0; i < this.p.n; i++) {
      out.push((this.p.rates[i] * b[i]) / Constants.PRECISION);
    }
    return out;
  }

  private dynamicFee(xpi: bigint, xpj: bigint, baseFee: bigint): bigint {
    const offpeg = this.p.offpegFeeMultiplier;
    if (offpeg <= Constants.FEE_DENOMINATOR) return baseFee;

    const xps2 = (xpi + xpj) ** 2n;
    const num = offpeg * baseFee;
    const den =
      ((offpeg - Constants.FEE_DENOMINATOR) * 4n * xpi * xpj) / xps2 + Constants.FEE_DENOMINATOR;
    return num / den;
  }

  // ---------- core invariant math ----------
  getD(xp: bigint[], amp?: bigint): bigint {
    const n = BigInt(this.p.n);
    const A = amp ?? this.p.amp;

    let S = 0n;
    for (const x of xp) S += x;
    if (S === 0n) return 0n;

    let D = S;
    const Ann = A * n;
    const nPowN = n ** n;

    for (let iter = 0; iter < 255; iter++) {
      let DP = D;
      for (const x of xp) {
        DP = (DP * D) / x;
      }
      DP = DP / nPowN;

      const Dprev = D;
      const num = ((Ann * S) / Constants.A_PRECISION + DP * n) * D;
      const den = ((Ann - Constants.A_PRECISION) * D) / Constants.A_PRECISION + (n + 1n) * DP;
      D = num / den;

      if (Helpers.abs(D - Dprev) <= 1n) return D;
    }
    throw new Error("getD did not converge");
  }

  getY(i: number, j: number, x: bigint, xp: bigint[], amp: bigint, D: bigint): bigint {
    const n = this.p.n;
    assert(i !== j, "getY: same coin");
    assert(i >= 0 && i < n && j >= 0 && j < n, "getY: index out of range");

    let S_ = 0n;
    let c = D;
    const Ann = amp * BigInt(n);

    for (let k = 0; k < n; k++) {
      let _x: bigint;
      if (k === i) _x = x;
      else if (k === j) continue;
      else _x = xp[k];

      S_ += _x;
      c = (c * D) / (_x * BigInt(n));
    }

    c = (c * D * Constants.A_PRECISION) / (Ann * BigInt(n));
    const b = S_ + (D * Constants.A_PRECISION) / Ann;
    let y = D;

    for (let iter = 0; iter < 255; iter++) {
      const yPrev = y;
      y = (y * y + c) / (2n * y + b - D);
      if (Helpers.abs(y - yPrev) <= 1n) return y;
    }
    throw new Error("getY did not converge");
  }

  getY_D(A: bigint, i: number, xp: bigint[], D: bigint): bigint {
    const n = this.p.n;
    assert(i >= 0 && i < n, "getY_D: index out of range");

    let S_ = 0n;
    let c = D;
    const Ann = A * BigInt(n);

    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const _x = xp[k];
      S_ += _x;
      c = (c * D) / (_x * BigInt(n));
    }

    c = (c * D * Constants.A_PRECISION) / (Ann * BigInt(n));
    const b = S_ + (D * Constants.A_PRECISION) / Ann;
    let y = D;

    for (let iter = 0; iter < 255; iter++) {
      const yPrev = y;
      y = (y * y + c) / (2n * y + b - D);
      if (Helpers.abs(y - yPrev) <= 1n) return y;
    }
    throw new Error("getY_D did not converge");
  }

  /**
   * Returns [dx0/dx1, dx0/dx2, ...] each scaled 1e18 (matches _get_p output semantics).
   */
  getPRelativeToCoin0(): bigint[] {
    const n = this.p.n;
    assert(n >= 2, "getPRelativeToCoin0 requires n>=2");

    const xp = this.xp();
    const D = this.getD(xp, this.p.amp);

    const ANN = this.p.amp * BigInt(n);
    const nPowN = BigInt(n) ** BigInt(n);

    let Dr = D / nPowN;
    for (let k = 0; k < n; k++) {
      Dr = (Dr * D) / xp[k];
    }

    const xp0_A = (ANN * xp[0]) / Constants.A_PRECISION;

    const out: bigint[] = [];
    for (let i = 1; i < n; i++) {
      const num = Constants.PRECISION * (xp0_A + (Dr * xp[0]) / xp[i]);
      const den = xp0_A + Dr;
      out.push(num / den);
    }
    return out;
  }

  /**
   * Returns (coin[k] per coin0) scaled 1e18, using inverse of dx0/dxk.
   */
  priceCoin0ToK_1e18(k: number): bigint {
    assert(k >= 1 && k < this.p.n, "priceCoin0ToK_1e18: k out of range");
    const coin0PerK = this.getPRelativeToCoin0()[k - 1]; // dx0/dxk
    return (Constants.PRECISION * Constants.PRECISION) / coin0PerK;
  }

  private simulateExchange(i: number, j: number, dx: bigint): {
    dyOut: bigint;
    adminFeeReal: bigint;
    newBalances: bigint[];
    newAdminBalances: bigint[];
  } {
    const n = this.p.n;
    assert(i >= 0 && i < n && j >= 0 && j < n && i !== j, "exchange: bad indices");
    assert(dx > 0n, "exchange: dx must be > 0");

    const rates = this.p.rates;
    const amp = this.p.amp;

    const oldBal = this.balances;
    const xp = this.xp(oldBal);
    const D = this.getD(xp, amp);

    const x = xp[i] + (dx * rates[i]) / Constants.PRECISION;
    const y = this.getY(i, j, x, xp, amp, D);

    let dy = xp[j] - y - 1n;
    const feeHere = this.dynamicFee((xp[i] + x) / 2n, (xp[j] + y) / 2n, this.p.fee);
    const dyFee = (dy * feeHere) / Constants.FEE_DENOMINATOR;

    const dyNetXp = dy - dyFee;
    const dyOut = (dyNetXp * Constants.PRECISION) / rates[j];

    const adminFeeXp = (dyFee * Constants.ADMIN_FEE) / Constants.FEE_DENOMINATOR;
    const adminFeeReal = (adminFeeXp * Constants.PRECISION) / rates[j];

    const newBal = oldBal.slice();
    const newAdmin = this.adminBalances.slice();

    newBal[i] += dx;
    newBal[j] -= (dyOut + adminFeeReal);
    if (newBal[j] < 0n) throw new Error("exchange underflow: dx too large");

    newAdmin[j] += adminFeeReal;

    return { dyOut, adminFeeReal, newBalances: newBal, newAdminBalances: newAdmin };
  }

  getDy(i: number, j: number, dx: bigint): bigint {
    return this.simulateExchange(i, j, dx).dyOut;
  }

  exchange(i: number, j: number, dx: bigint): bigint {
    const r = this.simulateExchange(i, j, dx);
    this.balances = r.newBalances;
    this.adminBalances = r.newAdminBalances;
    return r.dyOut;
  }

  getDx(i: number, j: number, dy: bigint, maxDx: bigint): bigint {
    assert(dy > 0n, "getDx: dy must be > 0");
    let lo = 1n;
    let hi = 1n;

    while (hi <= maxDx && this.getDy(i, j, hi) < dy) hi *= 2n;
    if (hi > maxDx) {
      if (this.getDy(i, j, maxDx) < dy) throw new Error("getDx: dy not reachable within maxDx");
      hi = maxDx;
    }

    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (this.getDy(i, j, mid) >= dy) hi = mid;
      else lo = mid + 1n;
    }
    return lo;
  }

  private addLiquidityQuote(amounts: bigint[]): {
    mintAmount: bigint;
    fees: bigint[];
    adminFees: bigint[];
  } {
    const n = this.p.n;
    assert(amounts.length === n, "addLiquidityQuote: bad amounts length");

    const amp = this.p.amp;
    const rates = this.p.rates;

    const oldBalances = this.balances;
    const D0 = this.getD(this.xp(oldBalances), amp);

    const totalSupply = this.totalSupply;
    const newBalances = oldBalances.slice();

    // initial deposit requires all coins
    for (let i = 0; i < n; i++) {
      if (amounts[i] > 0n) newBalances[i] += amounts[i];
      else {
        if (totalSupply === 0n) throw new Error("initial deposit requires all coins");
      }
    }

    const D1 = this.getD(this.xp(newBalances), amp);
    if (D1 <= D0) throw new Error("add_liquidity: D1 must be > D0");

    const fees = new Array<bigint>(n).fill(0n);
    const adminFees = new Array<bigint>(n).fill(0n);

    let mintAmount: bigint;

    if (totalSupply > 0n) {
      const baseFee = (this.p.fee * BigInt(n)) / (4n * BigInt(n - 1));
      const ys = (D0 + D1) / BigInt(n);

      for (let i = 0; i < n; i++) {
        const ideal = (D1 * oldBalances[i]) / D0;
        const nb = newBalances[i];
        const diff = ideal > nb ? ideal - nb : nb - ideal;

        const xs = (rates[i] * (oldBalances[i] + nb)) / Constants.PRECISION;
        const dynFee = this.dynamicFee(xs, ys, baseFee);

        const feeI = (dynFee * diff) / Constants.FEE_DENOMINATOR;
        fees[i] = feeI;

        const adminPart = (feeI * Constants.ADMIN_FEE) / Constants.FEE_DENOMINATOR;
        adminFees[i] = adminPart;

        newBalances[i] -= feeI;
      }

      const D1Adj = this.getD(this.xp(newBalances), amp);
      mintAmount = (totalSupply * (D1Adj - D0)) / D0;
    } else {
      mintAmount = D1; // first LP
    }

    return { mintAmount, fees, adminFees };
  }

  addLiquidity(amounts: bigint[]): bigint {
    const { mintAmount, adminFees } = this.addLiquidityQuote(amounts);

    // apply actual state changes
    for (let i = 0; i < this.p.n; i++) {
      if (amounts[i] > 0n) this.balances[i] += amounts[i];

      if (adminFees[i] > 0n) {
        this.balances[i] -= adminFees[i]; // balances excludes admin
        if (this.balances[i] < 0n) throw new Error("addLiquidity underflow");
        this.adminBalances[i] += adminFees[i];
      }
    }

    this.totalSupply += mintAmount;
    return mintAmount;
  }

  removeLiquidity(burnAmount: bigint, claimAdminFees = false): bigint[] {
    assert(burnAmount > 0n, "removeLiquidity: burnAmount must be > 0");
    assert(burnAmount <= this.totalSupply, "removeLiquidity: burnAmount > totalSupply");

    const outs: bigint[] = [];
    const ts = this.totalSupply;
    for (let i = 0; i < this.p.n; i++) {
      const value = (this.balances[i] * burnAmount) / ts;
      outs.push(value);
      this.balances[i] -= value;
    }

    this.totalSupply -= burnAmount;

    if (claimAdminFees) this.withdrawAdminFees();
    return outs;
  }

  withdrawAdminFees(): bigint[] {
    const out = this.adminBalances.slice();
    this.adminBalances = new Array(this.p.n).fill(0n);
    return out;
  }

  private calcWithdrawOneCoinQuote(burnAmount: bigint, i: number): { dy: bigint; fee: bigint } {
    assert(burnAmount > 0n, "calcWithdrawOneCoinQuote: burnAmount must be > 0");
    assert(i >= 0 && i < this.p.n, "calcWithdrawOneCoinQuote: i out of range");
    assert(burnAmount <= this.totalSupply, "calcWithdrawOneCoinQuote: burnAmount > totalSupply");

    const amp = this.p.amp;
    const rates = this.p.rates;

    const xp = this.xp(this.balances);
    const D0 = this.getD(xp, amp);

    const D1 = D0 - (burnAmount * D0) / this.totalSupply;
    const newY = this.getY_D(amp, i, xp, D1);

    const n = this.p.n;
    const baseFee = (this.p.fee * BigInt(n)) / (4n * BigInt(n - 1));
    const xpReduced = xp.slice();
    const ys = (D0 + D1) / (2n * BigInt(n));

    for (let j = 0; j < n; j++) {
      const xpJ = xp[j];

      let dxExpected: bigint;
      let xavg: bigint;

      if (j === i) {
        dxExpected = (xpJ * D1) / D0 - newY;
        xavg = (xpJ + newY) / 2n;
      } else {
        dxExpected = xpJ - (xpJ * D1) / D0;
        xavg = xpJ;
      }

      const dynFee = this.dynamicFee(xavg, ys, baseFee);
      xpReduced[j] = xpJ - (dynFee * dxExpected) / Constants.FEE_DENOMINATOR;
    }

    const dyXp = xpReduced[i] - this.getY_D(amp, i, xpReduced, D1);

    const dy0 = ((xp[i] - newY) * Constants.PRECISION) / rates[i];
    const dy = ((dyXp - 1n) * Constants.PRECISION) / rates[i];
    const fee = dy0 - dy;

    if (dy < 0n || fee < 0n) throw new Error("calcWithdrawOneCoinQuote: negative result");
    return { dy, fee };
  }

  calcWithdrawOneCoin(burnAmount: bigint, i: number): bigint {
    return this.calcWithdrawOneCoinQuote(burnAmount, i).dy;
  }

  removeLiquidityOneCoin(burnAmount: bigint, i: number): bigint {
    const { dy, fee } = this.calcWithdrawOneCoinQuote(burnAmount, i);

    const adminPart = (fee * Constants.ADMIN_FEE) / Constants.FEE_DENOMINATOR;

    this.totalSupply -= burnAmount;

    this.balances[i] -= (dy + adminPart);
    if (this.balances[i] < 0n) throw new Error("removeLiquidityOneCoin underflow");

    this.adminBalances[i] += adminPart;
    return dy;
  }

  private removeLiquidityImbalanceQuote(amounts: bigint[]): {
    burnAmount: bigint;
    fees: bigint[];
    adminFees: bigint[];
  } {
    const n = this.p.n;
    assert(amounts.length === n, "removeLiquidityImbalanceQuote: bad amounts length");

    const amp = this.p.amp;
    const rates = this.p.rates;

    const oldBalances = this.balances;
    const D0 = this.getD(this.xp(oldBalances), amp);

    const newBalances = oldBalances.slice();
    for (let i = 0; i < n; i++) {
      if (amounts[i] !== 0n) {
        if (newBalances[i] < amounts[i]) throw new Error("imbalance withdraw exceeds balance");
        newBalances[i] -= amounts[i];
      }
    }

    const D1 = this.getD(this.xp(newBalances), amp);
    const baseFee = (this.p.fee * BigInt(n)) / (4n * BigInt(n - 1));
    const ys = (D0 + D1) / BigInt(n);

    const fees = new Array<bigint>(n).fill(0n);
    const adminFees = new Array<bigint>(n).fill(0n);

    for (let i = 0; i < n; i++) {
      const ideal = (D1 * oldBalances[i]) / D0;
      const nb = newBalances[i];
      const diff = ideal > nb ? ideal - nb : nb - ideal;

      const xs = (rates[i] * (oldBalances[i] + nb)) / Constants.PRECISION;
      const dynFee = this.dynamicFee(xs, ys, baseFee);

      const feeI = (dynFee * diff) / Constants.FEE_DENOMINATOR;
      fees[i] = feeI;

      const adminPart = (feeI * Constants.ADMIN_FEE) / Constants.FEE_DENOMINATOR;
      adminFees[i] = adminPart;

      newBalances[i] -= feeI;
    }

    const D1Adj = this.getD(this.xp(newBalances), amp);

    const burnAmount = ((D0 - D1Adj) * this.totalSupply) / D0 + 1n;
    if (burnAmount <= 1n) throw new Error("removeLiquidityImbalanceQuote: burnAmount too small");

    return { burnAmount, fees, adminFees };
  }

  removeLiquidityImbalance(amounts: bigint[], maxBurnAmount?: bigint): bigint {
    const { burnAmount, adminFees } = this.removeLiquidityImbalanceQuote(amounts);

    if (maxBurnAmount !== undefined && burnAmount > maxBurnAmount) {
      throw new Error("Slippage: burnAmount > maxBurnAmount");
    }
    if (burnAmount > this.totalSupply) throw new Error("burnAmount > totalSupply");

    for (let i = 0; i < this.p.n; i++) {
      if (amounts[i] !== 0n) this.balances[i] -= amounts[i];
    }

    for (let i = 0; i < this.p.n; i++) {
      if (adminFees[i] > 0n) {
        this.balances[i] -= adminFees[i];
        if (this.balances[i] < 0n) throw new Error("removeLiquidityImbalance underflow");
        this.adminBalances[i] += adminFees[i];
      }
    }

    this.totalSupply -= burnAmount;
    return burnAmount;
  }

  calcTokenAmount(amounts: bigint[], isDeposit: boolean): bigint {
    if (isDeposit) return this.addLiquidityQuote(amounts).mintAmount;
    return this.removeLiquidityImbalanceQuote(amounts).burnAmount;
  }
}