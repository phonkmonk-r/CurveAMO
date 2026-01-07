import "dotenv/config";
import { ethers, parseUnits } from "ethers";
import { CurveState } from "./CurveState";
import { FxState } from "./FxState";

(async () => {
    const crvusd_pool_amo = CurveState.fromChainId("0xEcb0F0d68C19BdAaDAEbE24f6752A4Db34e2c2cb", 1);
    const time = Date.now()
    await crvusd_pool_amo.sync();
    const amo = crvusd_pool_amo.amo;

    const fxState = FxState.fromChainId({
        treasury: "0x51c4348af0c6066a2fd31bd968bc0c039fe27342", 
        fToken: "0xc0c17dd08263c16f6b64e772fb9b723bf1344ddf",
        xToken: "0x75939ceb9fba27a545fe27d1cbd228c29123687c"
    },  1);
    await fxState.sync();

    console.log(fxState.lastFetchedData?.baseNav);
    

    console.log(crvusd_pool_amo?.amo?.solveOneSidedRemoveToTargetPrice(ethers.parseEther("0.999"), ethers.parseEther("500000")));
    console.log(amo?.priceCoin0ToK_1e18(1))

    amo?.removeLiquidityOneCoin(28103989260682776152301n, 0)
    console.log(ethers.formatEther(28103989260682776152301n))
    console.log(amo?.priceCoin0ToK_1e18(1))
})()

// const fee = 2_000_000n;
// const offpeg = 50_000_000_000n;
// const A = 200n * Constants.A_PRECISION;
// const lpTotalSupply = parseUnits("631666.28", 18);


// const b0 = 314219208883114375239371n
// const b1 = 317499446466129411184508n

// const params: CurveStableSwapNGParams = {
//     n: 2,
//     amp: A,
//     fee,
//     offpegFeeMultiplier: offpeg,
//     rates: [Constants.PRECISION, Constants.PRECISION],
// };


// const sim = new CurveAMO(params, [b0, b1], lpTotalSupply);

// console.log("1", sim.getDy(0, 1, parseUnits("1", 18)))

// const time = Date.now()
// console.log("before", sim.priceCoin0ToK_1e18(1))
// sim.exchange(0, 1, ethers.parseEther("200000"))
// console.log("after dump", sim.priceCoin0ToK_1e18(1))


// console.log(sim.solveOneSidedRemoveToTargetPrice(ethers.parseEther("0.999")))
// sim.removeLiquidityOneCoin(359512647214547879879145n, 0);
// console.log("after removal", sim.priceCoin0ToK_1e18(1))

// console.log(Date.now() - time, "ms")







// // do swap
// const time = Date.now();
// console.log(sim.solveOneSidedAddToTargetPrice(ethers.parseEther("0.999"), ethers.parseEther("100000000")))
// console.log("2", sim.getDy(0, 1, parseUnits("1", 18)));
// console.log("3", sim.priceCoin0ToK_1e18(1))
// console.log("time", Date.now() - time, "ms")

// sim.removeLiquidityOneCoin(359512647214547879879145n, 0)
// console.log("4", sim.getDy(1, 0, 294975643719625126880525n));
// console.log("5", sim.priceCoin0ToK_1e18(1))

// // ============ Test all new methods ============
// console.log("\n--- Testing maxSwapWithinPeg ---");

// // Test 1: Unconstrained swap (within peg)
// const swapResult1 = sim.maxSwapWithinPeg(5000n * 10n**18n, 0, 1);
// console.log("maxSwapWithinPeg (unconstrained):", swapResult1);

// // Test 2: Constrained swap (would push outside peg)
// const swapResult2 = sim.maxSwapWithinPeg(500000n * 10n**18n, 0, 1);
// console.log("maxSwapWithinPeg (large amount, should be constrained):", swapResult2);

// // Test 3: Swap in opposite direction
// const swapResult3 = sim.maxSwapWithinPeg(5000n * 10n**18n, 1, 0);
// console.log("maxSwapWithinPeg (direction 1->0):", swapResult3);

// console.log("\n--- Testing maxAddLiquidityWithinPeg ---");

// // Test 4: Add liquidity coin 0 (unconstrained)
// const addResult1 = sim.maxAddLiquidityWithinPeg(1000n * 10n**18n, 0);
// console.log("maxAddLiquidityWithinPeg (coin 0, small):", addResult1);

// // Test 5: Add liquidity coin 1 (unconstrained)
// const addResult2 = sim.maxAddLiquidityWithinPeg(1000n * 10n**18n, 1);
// console.log("maxAddLiquidityWithinPeg (coin 1, small):", addResult2);

// // Test 6: Add liquidity (large, should be constrained)
// const addResult3 = sim.maxAddLiquidityWithinPeg(500000n * 10n**18n, 0);
// console.log("maxAddLiquidityWithinPeg (large, constrained):", addResult3);

// console.log("\n--- Testing maxRemoveLiquidityWithinPeg ---");

// // Test 7: Remove liquidity coin 0 (small)
// const removeResult1 = sim.maxRemoveLiquidityWithinPeg(1000n * 10n**18n, 0);
// console.log("maxRemoveLiquidityWithinPeg (coin 0, small):", removeResult1);

// // Test 8: Remove liquidity coin 1 (small)
// const removeResult2 = sim.maxRemoveLiquidityWithinPeg(1000n * 10n**18n, 1);
// console.log("maxRemoveLiquidityWithinPeg (coin 1, small):", removeResult2);

// // Test 9: Remove liquidity (large, should be constrained)
// const removeResult3 = sim.maxRemoveLiquidityWithinPeg(100000n * 10n**18n, 1);
// console.log("maxRemoveLiquidityWithinPeg (large, constrained):", removeResult3);

// console.log("\n--- Testing solveDxToTargetPrice ---");

// // Fresh sim for target price tests
// const sim2 = new CurveAMO(params, [b0, b1], lpTotalSupply);
// sim2.exchange(0, 1, parseUnits("50000", 18)); // Push price off-peg
// console.log("Price after initial swap:", sim2.priceCoin0ToK_1e18(1));

// // Test 10: Solve to reach target price
// const targetResult = sim2.solveDxToTargetPrice(
//   ethers.parseEther("0.999"),
//   parseUnits("10000000", 18),
//   1
// );
// console.log("solveDxToTargetPrice result:", targetResult);

// // Verify by applying the swap
// sim2.exchange(targetResult.iIn, targetResult.jOut, targetResult.dx);
// console.log("Price after correction:", sim2.priceCoin0ToK_1e18(1));

// console.log("\n--- Testing solveOneSidedRemoveToTargetPrice ---");

// // Fresh sim for remove liquidity test
// const sim3 = new CurveAMO(params, [b0, b1], lpTotalSupply);
// sim3.exchange(1, 0, parseUnits("50000", 18)); // Push price in other direction
// console.log("Price before remove:", sim3.priceCoin0ToK_1e18(1));

// // Test 11: Solve one-sided remove to target
// const removeTargetResult = sim3.solveOneSidedRemoveToTargetPrice(
//   ethers.parseEther("0.999"),
//   parseUnits("500000", 18),
//   1
// );
// console.log("solveOneSidedRemoveToTargetPrice result:", removeTargetResult);

// // Verify by applying the remove
// sim3.removeLiquidityOneCoin(removeTargetResult.burnAmount, removeTargetResult.coinIndex);
// console.log("Price after remove:", sim3.priceCoin0ToK_1e18(1));

// console.log("\n--- All tests completed ---");

// // add liquidity
// // const minted = sim.addLiquidity([parseUnits("1000", 18), parseUnits("1000", 18)]);

// // remove liq proportional
// // const outs = sim.removeLiquidity(minted / 2n);

// // solve dx to bring price back to 0.999 (auto-detects direction)
// // const result = sim.solveDxToTargetPrice(
// //   ethers.parseEther("0.999"),
// //   parseUnits("10000000", 18),
// //   1
// // );
// // console.log("dxNeeded:", result.dx.toString());
// // console.log("direction: swap coin", result.iIn, "->", result.jOut);

// // // verify: apply the swap and check the price
// // sim.exchange(result.iIn, result.jOut, result.dx);
// // console.log("4 (price after correction):", sim.priceCoin0ToK_1e18(1));
// // console.log(sim.getDy(0, 1, ethers.parseEther("1")))

// // ============ One-sided liquidity examples ============

// // Reset state for one-sided liquidity demo
// // const sim2 = new CurveStableSwapNG(params, [b0, b1], lpTotalSupply);
// // sim2.exchange(1, 0, parseUnits("200000", 18)); // push price off-peg
// // console.log("\n--- One-sided Liquidity Demo ---");
// // console.log("Price after swap:", PRECISION * PRECISION / sim2.priceCoin0ToK_1e18(1));

// // // Solve: add one-sided liquidity to reach target price
// // const addResult = sim2.solveOneSidedAddToTargetPrice(
// //   ethers.parseEther("0.999"),
// //   parseUnits("10000000", 18),
// //   1
// // );
// // console.log("\nOne-sided ADD liquidity:");
// // console.log("  Amount needed:", addResult.amount.toString());
// // console.log("  Coin to add:", addResult.coinIndex);

// // Apply and verify
// // const amounts = [0n, 0n];
// // amounts[addResult.coinIndex] = addResult.amount;
// // sim2.addLiquidity(amounts);
// // console.log("  Price after add:", sim2.priceCoin0ToK_1e18(1));

// // // Reset for remove example
// // const sim3 = new CurveStableSwapNG(params, [b0, b1], lpTotalSupply);
// // sim3.exchange(1, 0, parseUnits("200000", 18)); // push price off-peg
// // console.log("\nPrice before remove:", sim3.priceCoin0ToK_1e18(1));

// // // Solve: remove one-sided liquidity to reach target price
// // const removeResult = sim3.solveOneSidedRemoveToTargetPrice(
//   ethers.parseEther("0.999"),
//   parseUnits("500000", 18), // max LP to burn
//   1
// );
// console.log("\nOne-sided REMOVE liquidity:");
// console.log("  LP to burn:", removeResult.burnAmount.toString());
// console.log("  Coin to withdraw:", removeResult.coinIndex);
// console.log("  Expected tokens out:", removeResult.tokenOut.toString());

// // Apply and verify
// sim3.removeLiquidityOneCoin(removeResult.burnAmount, removeResult.coinIndex);
// console.log("  Price after remove:", sim3.priceCoin0ToK_1e18(1));
