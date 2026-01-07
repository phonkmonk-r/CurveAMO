import { assert } from "node:console";
import { CurveStableSwapNG, CurveStableSwapNGParams } from "./CurveStableSwapNG"
import Constants from "./lib/Constants";

type PriceOutput = {
  currentPrice: bigint
  targetPrice: bigint
  achievablePrice: bigint // if achievable = target -> solved, if not, partially solved
}

export default class CurveAMO extends CurveStableSwapNG {
  /**
   * Solves for the amount of tokens to swap to bring price to target.
   * Automatically determines direction based on current vs target price.
   *
   * @param targetCoinKPerCoin0 - target price as "coinK per coin0" (1e18 scaled)
   * @param maxDx - maximum swap amount to search within (required for binary search)
   * @param coinKIndex - which coin to measure price against (default 1)
   * @returns dx - amount to swap (maxDx if target unreachable)
   * @returns iIn - input coin index for the swap
   * @returns jOut - output coin index for the swap
   * @returns canFulfill - true if target price is achievable within maxDx
   * @returns priceOutput - { currentPrice, targetPrice, achievablePrice } for analyzing partial solutions
   */
  solveDxToTargetPrice(
    targetCoinKPerCoin0: bigint,
    maxDx: bigint,
    coinKIndex = 1,
  ): { dx: bigint; iIn: number; jOut: number , canFulfill: boolean, priceOutput: PriceOutput} {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");
    const target = targetCoinKPerCoin0;

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);
    const price = currentPrice();

    // Already at target
    if (price === target) {
      return { dx: 0n, iIn: 0, jOut: coinKIndex, canFulfill: true,  priceOutput: {currentPrice: price, targetPrice: price, achievablePrice: target}};
    }

    // Determine direction:
    // - If price > target: coin0 is overvalued, need to add coin0 to pool (swap coin0 -> coinK)
    // - If price < target: coin0 is undervalued, need to remove coin0 from pool (swap coinK -> coin0)
    const needToLowerPrice = price > target;
    const iIn = needToLowerPrice ? 0 : coinKIndex;
    const jOut = needToLowerPrice ? coinKIndex : 0;

    const postPrice = (dx: bigint): bigint => {
      const snap = this.snapshot();
      try {
        this.exchange(iIn, jOut, dx);
        return currentPrice();
      } finally {
        this.restore(snap);
      }
    };

    // Binary search for dx
    let lo = 1n;
    let hi = 1n;

    // Expand hi until we overshoot the target
    if (needToLowerPrice) {
      // Looking for price to go DOWN to target
      while (hi <= maxDx && postPrice(hi) > target) hi *= 2n;
    } else {
      // Looking for price to go UP to target
      while (hi <= maxDx && postPrice(hi) < target) hi *= 2n;
    }

    if (hi > maxDx) {
      const maxPrice = postPrice(maxDx);
      // uppeg cannot be fixed with the current LP max
      if (needToLowerPrice && maxPrice > target) {
        return {iIn, jOut, dx: maxDx, canFulfill: false, priceOutput: {currentPrice: price, targetPrice: target, achievablePrice: maxPrice, }};
      }
      // depeg cannot be fixed with the current LP max
      if (!needToLowerPrice && maxPrice < target) {
        return {iIn, jOut, dx: maxDx, canFulfill: false, priceOutput: {currentPrice: price, targetPrice: target, achievablePrice: maxPrice, }};
      }
      hi = maxDx;
    }

    // Binary search
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const midPrice = postPrice(mid);

      if (needToLowerPrice) {
        // We want price <= target, find minimum dx where this holds
        if (midPrice <= target) hi = mid;
        else lo = mid + 1n;
      } else {
        // We want price >= target, find minimum dx where this holds
        if (midPrice >= target) hi = mid;
        else lo = mid + 1n;
      }
    }

    return { dx: lo, iIn, jOut, canFulfill: true, priceOutput: {currentPrice: price, targetPrice: target, achievablePrice: target}};
  }

  /**
   * Solves for the amount of a single token to ADD as liquidity to bring price to target.
   * Automatically determines which coin to add based on current vs target price.
   *
   * @param targetCoinKPerCoin0 - target price as "coinK per coin0" (1e18 scaled)
   * @param maxAmount - maximum amount to search within
   * @param coinKIndex - which coin to measure price against (default 1)
   * @returns amount - amount to add (maxAmount if target unreachable)
   * @returns coinIndex - which coin to add
   * @returns canFulfill - true if target price is achievable within maxAmount
   * @returns priceOutput - { currentPrice, targetPrice, achievablePrice } for analyzing partial solutions
   */
  solveOneSidedAddToTargetPrice(
    targetCoinKPerCoin0: bigint,
    maxAmount: bigint,
    coinKIndex = 1,
  ): { amount: bigint; coinIndex: number, canFulfill: boolean, priceOutput: {currentPrice: bigint, targetPrice: bigint, achievablePrice: bigint}} {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");
    const target = targetCoinKPerCoin0;

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);
    const price = currentPrice();

    // Already at target
    if (price === target) {
      return { amount: 0n, coinIndex: 0, canFulfill: true, priceOutput: {currentPrice: price, targetPrice: target, achievablePrice: target} };
    }

    // Determine which coin to add:
    // - If price > target (coinK per coin0 too high, coin0 overvalued):
    //   Add coin0 to increase its supply -> price goes DOWN
    // - If price < target (coinK per coin0 too low, coin0 undervalued):
    //   Add coinK to increase its supply -> price goes UP
    const needToLowerPrice = price > target;
    const coinIndex = needToLowerPrice ? 0 : coinKIndex;

    const postPrice = (amount: bigint): bigint => {
      const snap = this.snapshot();
      try {
        const amounts = new Array(this.p.n).fill(0n);
        amounts[coinIndex] = amount;
        this.addLiquidity(amounts);
        return currentPrice();
      } finally {
        this.restore(snap);
      }
    };

    // Binary search for amount
    let lo = 1n;
    let hi = 1n;

    // Expand hi until we overshoot the target
    if (needToLowerPrice) {
      while (hi <= maxAmount && postPrice(hi) > target) hi *= 2n;
    } else {
      while (hi <= maxAmount && postPrice(hi) < target) hi *= 2n;
    }

    if (hi > maxAmount) {
      const maxPrice = postPrice(maxAmount);
      if (needToLowerPrice && maxPrice > target) {
        return {amount: maxAmount, coinIndex, canFulfill: false, priceOutput: {achievablePrice: maxPrice, currentPrice: price, targetPrice: target}}
      }
      if (!needToLowerPrice && maxPrice < target) {
        return {amount: maxAmount, coinIndex, canFulfill: false, priceOutput: {achievablePrice: maxPrice, currentPrice: price, targetPrice: target}}
      }
      hi = maxAmount;
    }

    // Binary search
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const midPrice = postPrice(mid);

      if (needToLowerPrice) {
        if (midPrice <= target) hi = mid;
        else lo = mid + 1n;
      } else {
        if (midPrice >= target) hi = mid;
        else lo = mid + 1n;
      }
    }

    return { amount: lo, coinIndex, canFulfill: true, priceOutput: {currentPrice: price, targetPrice: target, achievablePrice: target}};
  }

  /**
   * Solves for the amount of LP tokens to burn (removing one coin) to bring price to target.
   * Automatically determines which coin to remove based on current vs target price.
   *
   * @param targetCoinKPerCoin0 - target price as "coinK per coin0" (1e18 scaled)
   * @param maxBurnAmount - maximum LP tokens to burn (defaults to total supply)
   * @param coinKIndex - which coin to measure price against (default 1)
   * @returns burnAmount - LP tokens to burn (maxBurnAmount if target unreachable)
   * @returns coinIndex - which coin to withdraw
   * @returns tokenOut - expected tokens received
   * @returns canFulfill - true if target price is achievable within maxBurnAmount
   * @returns priceOutput - { currentPrice, targetPrice, achievablePrice } for analyzing partial solutions
   */
  solveOneSidedRemoveToTargetPrice(
    targetCoinKPerCoin0: bigint,
    maxBurnAmount?: bigint,
    coinKIndex = 1,
  ): { burnAmount: bigint; coinIndex: number; tokenOut: bigint, canFulfill: boolean, priceOutput: PriceOutput } {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");
    const target = targetCoinKPerCoin0;
    const maxBurn = maxBurnAmount ?? this.totalSupply;

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);
    const price = currentPrice();

    // Already at target
    if (price === target) {
      return { burnAmount: 0n, coinIndex: 0, tokenOut: 0n, canFulfill: true, priceOutput: { currentPrice: price,  targetPrice: target, achievablePrice: price }};
    }

    // Determine which coin to remove:
    // - If price > target (coinK per coin0 too high, coin0 overvalued):
    //   Remove coinK to decrease its supply -> price goes DOWN
    // - If price < target (coinK per coin0 too low, coin0 undervalued):
    //   Remove coin0 to decrease its supply -> price goes UP
    const needToLowerPrice = price > target;
    const coinIndex = needToLowerPrice ? coinKIndex : 0;

    const postPrice = (burnAmount: bigint): bigint => {
      const snap = this.snapshot();
      try {
        this.removeLiquidityOneCoin(burnAmount, coinIndex);
        return currentPrice();
      } finally {
        this.restore(snap);
      }
    };

    // Binary search for burnAmount
    let lo = 1n;
    let hi = 1n;

    // Expand hi until we overshoot the target
    if (needToLowerPrice) {
      while (hi <= maxBurn && postPrice(hi) > target) hi *= 2n;
    } else {
      while (hi <= maxBurn && postPrice(hi) < target) hi *= 2n;
    }

    if (hi > maxBurn) {
      const maxPrice = postPrice(maxBurn);
      if (needToLowerPrice && maxPrice > target) {
        const tokenOut = this.calcWithdrawOneCoin(maxBurn, coinIndex);
        return {burnAmount: maxBurn, coinIndex, tokenOut, canFulfill: false, priceOutput: {currentPrice: price, targetPrice: target, achievablePrice: maxPrice}}
      }
      if (!needToLowerPrice && maxPrice < target) {
        const tokenOut = this.calcWithdrawOneCoin(maxBurn, coinIndex);
        return {burnAmount: maxBurn, coinIndex, tokenOut, canFulfill: false, priceOutput: {currentPrice: price, targetPrice: target, achievablePrice: maxPrice}}
      }
      hi = maxBurn;
    }

    // Binary search
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const midPrice = postPrice(mid);

      if (needToLowerPrice) {
        if (midPrice <= target) hi = mid;
        else lo = mid + 1n;
      } else {
        if (midPrice >= target) hi = mid;
        else lo = mid + 1n;
      }
    }

    // Calculate expected token output
    const tokenOut = this.calcWithdrawOneCoin(lo, coinIndex);

    return { burnAmount: lo, coinIndex, tokenOut, canFulfill: true, priceOutput: {currentPrice: price, targetPrice: target, achievablePrice: target} };
  }


  /**
   * Returns the maximum amount that can be swapped while keeping price within peg range.
   * If the desired amount would push price outside the range, returns the constrained max.
   *
   * @param desiredDx - the amount you want to swap (max)
   * @param iIn - input coin index
   * @param jOut - output coin index
   * @param pegMin - minimum acceptable price (1e18 scaled), default 0.998
   * @param pegMax - maximum acceptable price (1e18 scaled), default 1.005
   * @param coinKIndex - which coin to measure price against (default 1)
   * @returns { maxDx, dy, constrained, priceAfter } - max swappable amount, amount out, whether it was constrained, resulting price
   */
  maxSwapWithinPeg(
    desiredDx: bigint,
    iIn: number,
    jOut: number,
    pegMin: bigint = Constants.DEFAULT_PEG_MIN,
    pegMax: bigint = Constants.DEFAULT_PEG_MAX,
    coinKIndex = 1,
  ): { maxDx: bigint; dy: bigint; constrained: boolean; priceAfter: bigint } {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);

    const postPriceAndDy = (dx: bigint): { price: bigint; dy: bigint } => {
      const snap = this.snapshot();
      try {
        const dy = this.exchange(iIn, jOut, dx);
        return { price: currentPrice(), dy };
      } finally {
        this.restore(snap);
      }
    };

    // Check if desired amount is within peg
    const resultAtDesired = postPriceAndDy(desiredDx);
    if (resultAtDesired.price >= pegMin && resultAtDesired.price <= pegMax) {
      return { maxDx: desiredDx, dy: resultAtDesired.dy, constrained: false, priceAfter: resultAtDesired.price };
    }

    // Binary search for max dx that keeps price within bounds
    let lo = 0n;
    let hi = desiredDx;

    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n; // Bias high to find maximum
      const midResult = postPriceAndDy(mid);

      const withinPeg = midResult.price >= pegMin && midResult.price <= pegMax;
      if (withinPeg) {
        lo = mid; // Can go higher
      } else {
        hi = mid - 1n; // Too much
      }
    }

    const finalResult = lo > 0n ? postPriceAndDy(lo) : { price: currentPrice(), dy: 0n };
    return { maxDx: lo, dy: finalResult.dy, constrained: true, priceAfter: finalResult.price };
  }

  /**
   * Returns the maximum amount that can be added as one-sided liquidity while keeping price within peg range.
   *
   * @param desiredAmount - the amount you want to add (max)
   * @param coinIndex - which coin to add
   * @param pegMin - minimum acceptable price (1e18 scaled), default 0.998
   * @param pegMax - maximum acceptable price (1e18 scaled), default 1.005
   * @param coinKIndex - which coin to measure price against (default 1)
   * @returns { maxAmount, constrained, priceAfter, lpTokens } - max addable amount, whether constrained, resulting price, LP tokens received
   */
  maxAddLiquidityWithinPeg(
    desiredAmount: bigint,
    coinIndex: number,
    pegMin: bigint = Constants.DEFAULT_PEG_MIN,
    pegMax: bigint = Constants.DEFAULT_PEG_MAX,
    coinKIndex = 1,
  ): { maxAmount: bigint; constrained: boolean; priceAfter: bigint; lpTokens: bigint } {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);

    const postPriceAndLp = (amount: bigint): { price: bigint; lp: bigint } => {
      const snap = this.snapshot();
      try {
        const amounts = new Array(this.p.n).fill(0n);
        amounts[coinIndex] = amount;
        const lp = this.addLiquidity(amounts);
        return { price: currentPrice(), lp };
      } finally {
        this.restore(snap);
      }
    };

    // Check if desired amount is within peg
    const resultAtDesired = postPriceAndLp(desiredAmount);
    if (resultAtDesired.price >= pegMin && resultAtDesired.price <= pegMax) {
      return { maxAmount: desiredAmount, constrained: false, priceAfter: resultAtDesired.price, lpTokens: resultAtDesired.lp };
    }

    // Binary search for max amount that keeps price within bounds
    let lo = 0n;
    let hi = desiredAmount;

    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      const midResult = postPriceAndLp(mid);

      const withinPeg = midResult.price >= pegMin && midResult.price <= pegMax;
      if (withinPeg) {
        lo = mid;
      } else {
        hi = mid - 1n;
      }
    }

    const finalResult = lo > 0n ? postPriceAndLp(lo) : { price: currentPrice(), lp: 0n };
    return { maxAmount: lo, constrained: true, priceAfter: finalResult.price, lpTokens: finalResult.lp };
  }

  /**
   * Returns the maximum LP tokens that can be burned (removing one coin) while keeping price within peg range.
   *
   * @param desiredBurnAmount - the LP amount you want to burn (max)
   * @param coinIndex - which coin to withdraw
   * @param pegMin - minimum acceptable price (1e18 scaled), default 0.998
   * @param pegMax - maximum acceptable price (1e18 scaled), default 1.005
   * @param coinKIndex - which coin to measure price against (default 1)
   * @returns { maxBurnAmount, constrained, priceAfter, tokenOut } - max burnable LP, whether constrained, resulting price, tokens received
   */
  maxRemoveLiquidityWithinPeg(
    desiredBurnAmount: bigint,
    coinIndex: number,
    pegMin: bigint = Constants.DEFAULT_PEG_MIN,
    pegMax: bigint = Constants.DEFAULT_PEG_MAX,
    coinKIndex = 1,
  ): { maxBurnAmount: bigint; constrained: boolean; priceAfter: bigint; tokenOut: bigint } {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);

    const postPriceAndOut = (burnAmount: bigint): { price: bigint; out: bigint } => {
      const snap = this.snapshot();
      try {
        const out = this.removeLiquidityOneCoin(burnAmount, coinIndex);
        return { price: currentPrice(), out };
      } finally {
        this.restore(snap);
      }
    };

    // Check if desired burn is within peg
    const resultAtDesired = postPriceAndOut(desiredBurnAmount);
    if (resultAtDesired.price >= pegMin && resultAtDesired.price <= pegMax) {
      return { maxBurnAmount: desiredBurnAmount, constrained: false, priceAfter: resultAtDesired.price, tokenOut: resultAtDesired.out };
    }

    // Binary search for max burn that keeps price within bounds
    let lo = 0n;
    let hi = desiredBurnAmount;

    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      const midResult = postPriceAndOut(mid);

      const withinPeg = midResult.price >= pegMin && midResult.price <= pegMax;
      if (withinPeg) {
        lo = mid;
      } else {
        hi = mid - 1n;
      }
    }

    const finalResult = lo > 0n ? postPriceAndOut(lo) : { price: currentPrice(), out: 0n };
    return { maxBurnAmount: lo, constrained: true, priceAfter: finalResult.price, tokenOut: finalResult.out };
  }

  /**
   * Given a desired output amount (dy), returns the required input (dx) and whether
   * price constraints can be satisfied. If the desired output would push price outside
   * the peg range, returns the maximum achievable output within constraints.
   *
   * @param desiredDy - the output amount you want to receive
   * @param iIn - input coin index
   * @param jOut - output coin index
   * @param pegMin - minimum acceptable price (1e18 scaled), default 0.998
   * @param pegMax - maximum acceptable price (1e18 scaled), default 1.005
   * @param coinKIndex - which coin to measure price against (default 1)
   * @param maxDx - optional maximum input amount available (speeds up search)
   * @returns dx - input required for the achievable output
   * @returns dy - actual output you'll get (desiredDy if achievable, otherwise max within peg)
   * @returns canFulfill - true if desiredDy is fully achievable within peg constraints
   * @returns maxDyWithinPeg - maximum output achievable while staying within peg range
   * @returns priceAfter - resulting price after the swap
   */
  solveSwapForOutput(
    desiredDy: bigint,
    iIn: number,
    jOut: number,
    pegMin: bigint = Constants.DEFAULT_PEG_MIN,
    pegMax: bigint = Constants.DEFAULT_PEG_MAX,
    coinKIndex = 1,
    maxDx?: bigint,
  ): { dx: bigint; dy: bigint; canFulfill: boolean; maxDyWithinPeg: bigint; priceAfter: bigint } {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");
    assert(desiredDy > 0n, "desiredDy must be > 0");

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);
    const maxInput = maxDx ?? 10n ** 30n;

    // Helper to get price and dx for a given dy
    const getPriceAndDxForDy = (dy: bigint): { price: bigint; dx: bigint } | null => {
      const snap = this.snapshot();
      try {
        // Binary search for dx that gives us dy
        let lo = 1n;
        let hi = 1n;

        // Expand hi until we get enough output
        while (hi <= maxInput && this.getDy(iIn, jOut, hi) < dy) {
          hi *= 2n;
        }

        // Check if we exceeded maxInput
        if (hi > maxInput) {
          if (this.getDy(iIn, jOut, maxInput) < dy) return null;
          hi = maxInput;
        }

        // Binary search for minimum dx that gives dy
        while (lo < hi) {
          const mid = (lo + hi) / 2n;
          if (this.getDy(iIn, jOut, mid) >= dy) hi = mid;
          else lo = mid + 1n;
        }

        const dx = lo;
        this.exchange(iIn, jOut, dx);
        return { price: currentPrice(), dx };
      } catch {
        return null;
      } finally {
        this.restore(snap);
      }
    };

    // Check if desired dy is achievable and within peg
    const resultAtDesired = getPriceAndDxForDy(desiredDy);

    if (resultAtDesired && resultAtDesired.price >= pegMin && resultAtDesired.price <= pegMax) {
      // Fully achievable within peg
      return {
        dx: resultAtDesired.dx,
        dy: desiredDy,
        canFulfill: true,
        maxDyWithinPeg: desiredDy,
        priceAfter: resultAtDesired.price,
      };
    }

    // Binary search for max dy within peg constraints
    let lo = 1n;
    let hi = desiredDy;

    // First check if even the smallest dy is within peg
    const minResult = getPriceAndDxForDy(lo);
    if (!minResult || minResult.price < pegMin || minResult.price > pegMax) {
      // Even minimal swap breaks peg or is not possible
      return {
        dx: 0n,
        dy: 0n,
        canFulfill: false,
        maxDyWithinPeg: 0n,
        priceAfter: currentPrice(),
      };
    }

    // Binary search for maximum dy within peg
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n; // Bias high to find maximum
      const midResult = getPriceAndDxForDy(mid);

      if (midResult && midResult.price >= pegMin && midResult.price <= pegMax) {
        lo = mid; // Can go higher
      } else {
        hi = mid - 1n; // Too much
      }
    }

    const finalResult = getPriceAndDxForDy(lo);
    if (!finalResult) {
      return {
        dx: 0n,
        dy: 0n,
        canFulfill: false,
        maxDyWithinPeg: 0n,
        priceAfter: currentPrice(),
      };
    }

    return {
      dx: finalResult.dx,
      dy: lo,
      canFulfill: false,
      maxDyWithinPeg: lo,
      priceAfter: finalResult.price,
    };
  }

  /**
   * Given a desired LP token output, returns the required single-sided deposit amount
   * and whether price constraints can be satisfied.
   *
   * @param desiredLpTokens - the LP tokens you want to receive
   * @param coinIndex - which coin to add
   * @param pegMin - minimum acceptable price (1e18 scaled), default 0.998
   * @param pegMax - maximum acceptable price (1e18 scaled), default 1.005
   * @param coinKIndex - which coin to measure price against (default 1)
   * @param maxAmount - optional maximum amount available to deposit (speeds up search)
   * @returns amount - input amount required for the achievable LP tokens
   * @returns lpTokens - actual LP tokens you'll get
   * @returns canFulfill - true if desiredLpTokens is fully achievable within peg constraints
   * @returns maxLpWithinPeg - maximum LP tokens achievable while staying within peg range
   * @returns priceAfter - resulting price after adding liquidity
   */
  solveAddLiquidityForLpTokens(
    desiredLpTokens: bigint,
    coinIndex: number,
    pegMin: bigint = Constants.DEFAULT_PEG_MIN,
    pegMax: bigint = Constants.DEFAULT_PEG_MAX,
    coinKIndex = 1,
    maxAmount?: bigint,
  ): { amount: bigint; lpTokens: bigint; canFulfill: boolean; maxLpWithinPeg: bigint; priceAfter: bigint } {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");
    assert(desiredLpTokens > 0n, "desiredLpTokens must be > 0");

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);
    const maxInput = maxAmount ?? 10n ** 30n;

    // Helper to get price and amount for desired LP tokens
    const getPriceAndAmountForLp = (targetLp: bigint): { price: bigint; amount: bigint; actualLp: bigint } | null => {
      const snap = this.snapshot();
      try {
        // Binary search for amount that gives us targetLp
        let lo = 1n;
        let hi = 1n;

        const getLpForAmount = (amt: bigint): bigint => {
          const amounts = new Array(this.p.n).fill(0n);
          amounts[coinIndex] = amt;
          const s = this.snapshot();
          try {
            return this.addLiquidity(amounts);
          } finally {
            this.restore(s);
          }
        };

        // Expand hi until we get enough LP
        while (hi <= maxInput && getLpForAmount(hi) < targetLp) {
          hi *= 2n;
        }

        // Check if we exceeded maxInput
        if (hi > maxInput) {
          if (getLpForAmount(maxInput) < targetLp) return null;
          hi = maxInput;
        }

        // Binary search for minimum amount that gives targetLp
        while (lo < hi) {
          const mid = (lo + hi) / 2n;
          if (getLpForAmount(mid) >= targetLp) hi = mid;
          else lo = mid + 1n;
        }

        const amount = lo;
        const amounts = new Array(this.p.n).fill(0n);
        amounts[coinIndex] = amount;
        const actualLp = this.addLiquidity(amounts);
        return { price: currentPrice(), amount, actualLp };
      } catch {
        return null;
      } finally {
        this.restore(snap);
      }
    };

    // Check if desired LP is achievable and within peg
    const resultAtDesired = getPriceAndAmountForLp(desiredLpTokens);

    if (resultAtDesired && resultAtDesired.price >= pegMin && resultAtDesired.price <= pegMax) {
      return {
        amount: resultAtDesired.amount,
        lpTokens: resultAtDesired.actualLp,
        canFulfill: true,
        maxLpWithinPeg: resultAtDesired.actualLp,
        priceAfter: resultAtDesired.price,
      };
    }

    // Binary search for max LP within peg constraints
    let lo = 1n;
    let hi = desiredLpTokens;

    const minResult = getPriceAndAmountForLp(lo);
    if (!minResult || minResult.price < pegMin || minResult.price > pegMax) {
      return {
        amount: 0n,
        lpTokens: 0n,
        canFulfill: false,
        maxLpWithinPeg: 0n,
        priceAfter: currentPrice(),
      };
    }

    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      const midResult = getPriceAndAmountForLp(mid);

      if (midResult && midResult.price >= pegMin && midResult.price <= pegMax) {
        lo = mid;
      } else {
        hi = mid - 1n;
      }
    }

    const finalResult = getPriceAndAmountForLp(lo);
    if (!finalResult) {
      return {
        amount: 0n,
        lpTokens: 0n,
        canFulfill: false,
        maxLpWithinPeg: 0n,
        priceAfter: currentPrice(),
      };
    }

    return {
      amount: finalResult.amount,
      lpTokens: finalResult.actualLp,
      canFulfill: false,
      maxLpWithinPeg: finalResult.actualLp,
      priceAfter: finalResult.price,
    };
  }

  /**
   * Given a desired token output from removing liquidity, returns the required LP burn amount
   * and whether price constraints can be satisfied.
   *
   * @param desiredTokenOut - the token amount you want to receive
   * @param coinIndex - which coin to withdraw
   * @param pegMin - minimum acceptable price (1e18 scaled), default 0.998
   * @param pegMax - maximum acceptable price (1e18 scaled), default 1.005
   * @param coinKIndex - which coin to measure price against (default 1)
   * @param maxBurnAmount - optional maximum LP tokens available to burn (speeds up search, defaults to totalSupply)
   * @returns burnAmount - LP tokens to burn for the achievable output
   * @returns tokenOut - actual tokens you'll get
   * @returns canFulfill - true if desiredTokenOut is fully achievable within peg constraints
   * @returns maxTokenOutWithinPeg - maximum tokens achievable while staying within peg range
   * @returns priceAfter - resulting price after removing liquidity
   */
  solveRemoveLiquidityForTokenOut(
    desiredTokenOut: bigint,
    coinIndex: number,
    pegMin: bigint = Constants.DEFAULT_PEG_MIN,
    pegMax: bigint = Constants.DEFAULT_PEG_MAX,
    coinKIndex = 1,
    maxBurnAmount?: bigint,
  ): { burnAmount: bigint; tokenOut: bigint; canFulfill: boolean; maxTokenOutWithinPeg: bigint; priceAfter: bigint } {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");
    assert(desiredTokenOut > 0n, "desiredTokenOut must be > 0");

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);
    const maxBurn = maxBurnAmount ?? this.totalSupply;

    // Helper to get price and burn amount for desired token output
    const getPriceAndBurnForTokenOut = (targetOut: bigint): { price: bigint; burnAmount: bigint; actualOut: bigint } | null => {
      const snap = this.snapshot();
      try {
        // Binary search for burn amount that gives us targetOut
        let lo = 1n;
        let hi = 1n;

        const getOutForBurn = (burn: bigint): bigint => {
          if (burn > maxBurn) return 0n;
          return this.calcWithdrawOneCoin(burn, coinIndex);
        };

        // Expand hi until we get enough output
        while (hi <= maxBurn && getOutForBurn(hi) < targetOut) {
          hi *= 2n;
        }

        if (hi > maxBurn) {
          if (getOutForBurn(maxBurn) < targetOut) return null;
          hi = maxBurn;
        }

        // Binary search for minimum burn that gives targetOut
        while (lo < hi) {
          const mid = (lo + hi) / 2n;
          if (getOutForBurn(mid) >= targetOut) hi = mid;
          else lo = mid + 1n;
        }

        const burnAmount = lo;
        const actualOut = this.removeLiquidityOneCoin(burnAmount, coinIndex);
        return { price: currentPrice(), burnAmount, actualOut };
      } catch {
        return null;
      } finally {
        this.restore(snap);
      }
    };

    // Check if desired output is achievable and within peg
    const resultAtDesired = getPriceAndBurnForTokenOut(desiredTokenOut);

    if (resultAtDesired && resultAtDesired.price >= pegMin && resultAtDesired.price <= pegMax) {
      return {
        burnAmount: resultAtDesired.burnAmount,
        tokenOut: resultAtDesired.actualOut,
        canFulfill: true,
        maxTokenOutWithinPeg: resultAtDesired.actualOut,
        priceAfter: resultAtDesired.price,
      };
    }

    // Binary search for max token out within peg constraints
    let lo = 1n;
    let hi = desiredTokenOut;

    const minResult = getPriceAndBurnForTokenOut(lo);
    if (!minResult || minResult.price < pegMin || minResult.price > pegMax) {
      return {
        burnAmount: 0n,
        tokenOut: 0n,
        canFulfill: false,
        maxTokenOutWithinPeg: 0n,
        priceAfter: currentPrice(),
      };
    }

    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      const midResult = getPriceAndBurnForTokenOut(mid);

      if (midResult && midResult.price >= pegMin && midResult.price <= pegMax) {
        lo = mid;
      } else {
        hi = mid - 1n;
      }
    }

    const finalResult = getPriceAndBurnForTokenOut(lo);
    if (!finalResult) {
      return {
        burnAmount: 0n,
        tokenOut: 0n,
        canFulfill: false,
        maxTokenOutWithinPeg: 0n,
        priceAfter: currentPrice(),
      };
    }

    return {
      burnAmount: finalResult.burnAmount,
      tokenOut: finalResult.actualOut,
      canFulfill: false,
      maxTokenOutWithinPeg: finalResult.actualOut,
      priceAfter: finalResult.price,
    };
  }
}