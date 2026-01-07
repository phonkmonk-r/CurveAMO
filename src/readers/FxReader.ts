import { Contract, Provider, JsonRpcProvider } from "ethers";
import { FxLogicParams } from "../logic/FxLogic";

const FX_TREASURY_ABI = [
    "function getCurrentNav() view returns (uint256 baseNav, uint256 fNav, uint256 xNav)",
    "function totalBaseToken() view returns (uint256)",
    "function collateralRatio() view returns (uint256)",
    "function maxMintableFTokenWithoutBaseToken(uint256 targetCollateralRatio) view returns (uint256)",
];

const ERC20_ABI = [
    "function totalSupply() view returns (uint256)",
];

export interface FxReaderAddressesParams {
    treasury: string,
    fToken: string,
    xToken: string
}

/**
 * Reader for interacting with FX Protocol contracts.
 * Provides methods to read treasury state, NAV values, collateral ratios,
 * and token supplies for fToken and xToken.
 */
export class FxReader {
    private treasury: Contract;
    public readonly provider: Provider;
    public readonly treasuryAddress: string;
    public readonly fTokenAddress: string;
    public readonly xTokenAddress: string;

    constructor(addresses: FxReaderAddressesParams,  provider: Provider) {
        this.treasuryAddress = addresses.treasury;
        this.provider = provider;
        this.treasury = new Contract(addresses.treasury, FX_TREASURY_ABI, provider);
        this.fTokenAddress = addresses.fToken;
        this.xTokenAddress = addresses.xToken;
    }

    static fromRpcUrl(addresses: FxReaderAddressesParams, rpcUrl: string): FxReader {
        const provider = new JsonRpcProvider(rpcUrl);
        return new FxReader(addresses, provider);
    }

    async getCurrentNav(): Promise<{ baseNav: bigint; fNav: bigint; xNav: bigint }> {
        const [baseNav, fNav, xNav] = await this.treasury.getCurrentNav();
        return { baseNav, fNav, xNav };
    }

    async getTotalBaseToken(): Promise<bigint> {
        return await this.treasury.totalBaseToken();
    }

    async getCollateralRatio(): Promise<bigint> {
        return await this.treasury.collateralRatio();
    }

    async getMaxMintableFToken(targetCollateralRatio: bigint): Promise<bigint> {
        return await this.treasury.maxMintableFTokenWithoutBaseToken(targetCollateralRatio);
    }

    async getFTotalSupply(): Promise<bigint> {
        const fToken = new Contract(this.fTokenAddress, ERC20_ABI, this.provider);
        return await fToken.totalSupply();
    }

    async getXTotalSupply(): Promise<bigint> {
        const xToken = new Contract(this.xTokenAddress, ERC20_ABI, this.provider);
        return await xToken.totalSupply();
    }

    async getParams(): Promise<FxLogicParams> {
        const [nav, baseTotalSupply, collateralRatio, fTotalSupply, xTotalSupply] = await Promise.all([
            this.getCurrentNav(),
            this.getTotalBaseToken(),
            this.getCollateralRatio(),
            this.getFTotalSupply(),
            this.getXTotalSupply(),
        ]);

        return {
            fNav: nav.fNav,
            xNav: nav.xNav,
            baseNav: nav.baseNav,
            baseTotalSupply,
            fTotalSupply,
            xTotalSupply,
            collateralRatio,
        };
    }
}
