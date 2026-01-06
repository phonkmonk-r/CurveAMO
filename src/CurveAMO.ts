import { assert } from "node:console";
import { CurveStableSwapNG } from "./CurveStableSwapNG"
import { DEFAULT_PEG_MAX, DEFAULT_PEG_MIN } from "./helpers";

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
   * @returns { maxDx, constrained, priceAfter } - max swappable amount, whether it was constrained, resulting price
   */
  maxSwapWithinPeg(
    desiredDx: bigint,
    iIn: number,
    jOut: number,
    pegMin: bigint = DEFAULT_PEG_MIN,
    pegMax: bigint = DEFAULT_PEG_MAX,
    coinKIndex = 1,
  ): { maxDx: bigint; constrained: boolean; priceAfter: bigint } {
    assert(coinKIndex !== 0, "coinKIndex must not be 0");

    const currentPrice = (): bigint => this.priceCoin0ToK_1e18(coinKIndex);

    const postPrice = (dx: bigint): bigint => {
      const snap = this.snapshot();
      try {
        this.exchange(iIn, jOut, dx);
        return currentPrice();
      } finally {
        this.restore(snap);
      }
    };

    // Check if desired amount is within peg
    const priceAtDesired = postPrice(desiredDx);
    if (priceAtDesired >= pegMin && priceAtDesired <= pegMax) {
      return { maxDx: desiredDx, constrained: false, priceAfter: priceAtDesired };
    }

    // Binary search for max dx that keeps price within bounds
    let lo = 0n;
    let hi = desiredDx;

    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n; // Bias high to find maximum
      const midPrice = postPrice(mid);

      const withinPeg = midPrice >= pegMin && midPrice <= pegMax;
      if (withinPeg) {
        lo = mid; // Can go higher
      } else {
        hi = mid - 1n; // Too much
      }
    }

    const finalPrice = lo > 0n ? postPrice(lo) : currentPrice();
    return { maxDx: lo, constrained: true, priceAfter: finalPrice };
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
    pegMin: bigint = DEFAULT_PEG_MIN,
    pegMax: bigint = DEFAULT_PEG_MAX,
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
    pegMin: bigint = DEFAULT_PEG_MIN,
    pegMax: bigint = DEFAULT_PEG_MAX,
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
}