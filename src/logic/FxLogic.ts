
export interface FxLogicParams {
    fNav: bigint;
    xNav: bigint;
    baseNav: bigint;
    baseTotalSupply: bigint;
    fTotalSupply: bigint;
    xTotalSupply: bigint;
    collateralRatio: bigint;
}

/**
 * Logic for FX Protocol collateral ratio management.
 * Provides methods to calculate the amount of fToken that needs to be burned
 * to achieve a target collateral ratio based on NAV values and token supplies.
 */
export default class FxLogic {
    public readonly p: FxLogicParams;

    constructor(params: FxLogicParams) {
        this.p = params;
    }

    calculateBurnAmount(targetCollateralRatio: bigint): bigint {
        const denominator = this.p.fNav * targetCollateralRatio;

        if (denominator === 0n) {
            throw new Error("FxLogic: invalid fNav or target CR");
        }

        const numerator = this.p.baseTotalSupply * this.p.baseNav * (10n ** 18n);
        const targetFSupply = numerator / denominator;

        if (this.p.fTotalSupply <= targetFSupply) {
            return 0n;
        }

        return this.p.fTotalSupply - targetFSupply;
    }
}