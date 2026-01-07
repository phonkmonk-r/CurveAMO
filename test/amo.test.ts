import { expect } from "chai";
import CurveLogic from "../src/logic/CurveLogic";
import { ethers } from "ethers";
import { CurveStableSwapNGParams } from "../src/logic/CurveStableSwapNG";
import Constants from "../src/lib/Constants";

describe("Curve AMO", () => {
  let amo: CurveLogic
  beforeEach(() => {
    const fee = 2_000_000n;
    const offpeg = 50_000_000_000n;
    const A = 200n * Constants.A_PRECISION;
    const lpTotalSupply = ethers.parseEther("600000");


    const balance0 = ethers.parseEther("300000");
    const balance1 = ethers.parseEther("300000");
    const params: CurveStableSwapNGParams = {
      n: 2,
      amp: A,
      fee,
      offpegFeeMultiplier: offpeg,
      rates: [Constants.PRECISION, Constants.PRECISION],
    };
    amo = new CurveLogic(params, [balance0, balance1], lpTotalSupply);
  })

  describe("De-peg", () => {
    beforeEach(() => {
      // we will exchange a large amount such that it causes a depeg
      amo.exchange(0, 1, ethers.parseEther("200000"));
      let price = Number(ethers.formatEther(amo.priceCoin0ToK_1e18(1)));
      expect(price).to.be.lessThan(0.98);
    })
    it("should should stabilize the market if depegged through swap", () => {
      const result = amo.solveDxToTargetPrice(ethers.parseEther("0.995"), ethers.parseEther("2000000"))
      expect(result.iIn).to.equal(1);
      expect(result.jOut).to.equal(0);

      // execute the state
      amo.exchange(result.iIn, result.jOut, result.dx);
      let price = Number(ethers.formatEther(amo.priceCoin0ToK_1e18(1)));
      expect(price).to.be.greaterThanOrEqual(0.995);
    })
    it("should should stabilize the market if depegged through removal of liquidity", () => {
      const result = amo.solveOneSidedRemoveToTargetPrice(ethers.parseEther("0.995"))
      expect(result.coinIndex).to.equal(0);

      // execute the state
      amo.removeLiquidityOneCoin(result.burnAmount, result.coinIndex);
      let price = Number(ethers.formatEther(amo.priceCoin0ToK_1e18(1)));
      expect(price).to.be.greaterThanOrEqual(0.995);
    })
    it("should stabilize the market if depegged through removal or liquidity AND swap", () => {
      const target = ethers.parseEther("0.999")
      const liquiditySolution = amo.solveOneSidedRemoveToTargetPrice(target, ethers.parseEther("1000"))
      if (liquiditySolution.canFulfill) {
        if (liquiditySolution.burnAmount > 0) {
          amo.removeLiquidityOneCoin(liquiditySolution.burnAmount, liquiditySolution.coinIndex);
          expect(Number(amo.priceCoin0ToK_1e18(1))).to.be.greaterThanOrEqual(Number(target))
        }
      } else {
        // partial fulfillment
        amo.removeLiquidityOneCoin(liquiditySolution.burnAmount, liquiditySolution.coinIndex);
        const updatedPrice = amo.priceCoin0ToK_1e18(1);
        expect(Number(updatedPrice)).to.be.lessThan(Number(target))

        // swap remaining amount
        const swapResult = amo.solveDxToTargetPrice(target, ethers.parseEther("170000"));
        if (!swapResult.canFulfill) {
          // we cannot balance the system.
          throw new Error("Cannot rebalance the system. Max achievable price is " + Number(swapResult.priceOutput.achievablePrice) / 1e18);
        }
        if (swapResult.dx > 0) {
          amo.exchange(swapResult.iIn, swapResult.jOut, swapResult.dx)
        }
      }
    })
  })
  it("should stabilize when the system is under-collateralized", () => {
      // basically call the swap etc all of them, and then see at the end if the state fixes it.
      // calculate how much pmUSD is required
      const pmUSDRequired = ethers.parseEther("150000");
      // price was depegged, so now the opposite is better.

      const time = Date.now()
      const swapOutput = amo.solveSwapForOutput(pmUSDRequired, 1, 0, ethers.parseEther("0.995"), ethers.parseEther("1.005"), 1, ethers.parseEther("100000"));
      console.log(Date.now() - time)
      // console.log(swapOutput)

      amo.exchange(1, 0, swapOutput.dx);

      const remainingpmUSDRequired = pmUSDRequired - swapOutput.dy;
      if (remainingpmUSDRequired > 0) {
        // remove from the lp maybe?
        const removeOutput = amo.solveRemoveLiquidityForTokenOut(remainingpmUSDRequired, 0, ethers.parseEther("0.995"), ethers.parseEther("1.005"), 1, ethers.parseEther("200000"));
        console.log(Date.now() - time)
        // console.log(removeOutput)

        // console.log("remaining", ethers.formatEther(remainingpmUSDRequired - removeOutput.maxTokenOutWithinPeg))
      }
      console.log(Date.now() - time)
    })
})