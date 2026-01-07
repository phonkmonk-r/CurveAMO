import { Contract, Provider, JsonRpcProvider } from "ethers";
import { CurveStableSwapNGParams } from "../logic/CurveStableSwapNG";
import CurveStableSwapNGAbi from "../abi/CurveStableSwapNG.json";

export interface PoolState {
  balances: bigint[];
  totalSupply: bigint;
  // virtualPrice: bigint;
}

export interface PoolMetadata {
  name: string;
  symbol: string;
  decimals: number;
  coins: string[];
  nCoins: number;
}

export interface FullPoolData {
  params: CurveStableSwapNGParams;
  state: PoolState;
  // metadata: PoolMetadata;
}

export class CurvePoolReader {
  private contract: Contract;
  public readonly provider: Provider;
  public readonly address: string;

  constructor(poolAddress: string, provider: Provider) {
    this.address = poolAddress;
    this.provider = provider;
    this.contract = new Contract(poolAddress, CurveStableSwapNGAbi, provider);
  }

  static fromRpcUrl(poolAddress: string, rpcUrl: string): CurvePoolReader {
    const provider = new JsonRpcProvider(rpcUrl);
    return new CurvePoolReader(poolAddress, provider);
  }

  /**
   * Get the number of coins in the pool
   */
  async getNCons(): Promise<number> {
    const n = await this.contract.N_COINS();
    return Number(n);
  }

  /**
   * Get the amplification coefficient (A_precise)
   */
  async getAmplificationCoefficient(): Promise<bigint> {
    return await this.contract.A_precise();
  }

  /**
   * Get the swap fee (1e10 precision)
   */
  async getFee(): Promise<bigint> {
    return await this.contract.fee();
  }

  /**
   * Get the offpeg fee multiplier (1e10 precision)
   */
  async getOffpegFeeMultiplier(): Promise<bigint> {
    return await this.contract.offpeg_fee_multiplier();
  }

  /**
   * Get stored rates for each coin (1e18 precision)
   */
  async getStoredRates(): Promise<bigint[]> {
    const rates = await this.contract.stored_rates();
    return rates.map((r: bigint) => BigInt(r));
  }

  /**
   * Get all pool balances (excluding admin fees)
   */
  async getBalances(): Promise<bigint[]> {
    const balances = await this.contract.get_balances();
    return balances.map((b: bigint) => BigInt(b));
  }

  /**
   * Get balance for a specific coin index
   */
  async getBalance(i: number): Promise<bigint> {
    return await this.contract.balances(i);
  }

  /**
   * Get admin balance for a specific coin index
   */
  async getAdminBalance(i: number): Promise<bigint> {
    return await this.contract.admin_balances(i);
  }

  /**
   * Get all admin balances
   */
  async getAdminBalances(): Promise<bigint[]> {
    const n = await this.getNCons();
    const adminBalances: bigint[] = [];
    for (let i = 0; i < n; i++) {
      adminBalances.push(await this.getAdminBalance(i));
    }
    return adminBalances;
  }

  /**
   * Get total LP token supply
   */
  async getTotalSupply(): Promise<bigint> {
    return await this.contract.totalSupply();
  }

  /**
   * Get the virtual price of the LP token (1e18 precision)
   */
  async getVirtualPrice(): Promise<bigint> {
    return await this.contract.get_virtual_price();
  }

  /**
   * Get the current invariant D
   */
  async getD(): Promise<bigint> {
    return await this.contract.D();
  }

  /**
   * Get coin addresses
   */
  async getCoins(): Promise<string[]> {
    const n = await this.getNCons();
    const coins: string[] = [];
    for (let i = 0; i < n; i++) {
      coins.push(await this.contract.coins(i));
    }
    return coins;
  }

  /**
   * Get pool name
   */
  async getName(): Promise<string> {
    return await this.contract.name();
  }

  /**
   * Get pool symbol
   */
  async getSymbol(): Promise<string> {
    return await this.contract.symbol();
  }

  /**
   * Get LP token decimals
   */
  async getDecimals(): Promise<number> {
    return await this.contract.decimals();
  }

  /**
   * Get dy (output amount) for a swap
   */
  async getDy(i: number, j: number, dx: bigint): Promise<bigint> {
    return await this.contract.get_dy(i, j, dx);
  }

  /**
   * Calculate LP tokens for deposit/withdrawal
   */
  async calcTokenAmount(amounts: bigint[], isDeposit: boolean): Promise<bigint> {
    return await this.contract.calc_token_amount(amounts, isDeposit);
  }

  /**
   * Calculate token output for single-coin withdrawal
   */
  async calcWithdrawOneCoin(burnAmount: bigint, i: number): Promise<bigint> {
    return await this.contract.calc_withdraw_one_coin(burnAmount, i);
  }

  /**
   * Get pool parameters needed for CurveStableSwapNG simulation
   */
  async getParams(): Promise<CurveStableSwapNGParams> {
    const [n, amp, fee, offpeg, rates] = await Promise.all([
      this.getNCons(),
      this.getAmplificationCoefficient(),
      this.getFee(),
      this.getOffpegFeeMultiplier(),
      this.getStoredRates(),
    ]);

    return {
      n,
      amp,
      fee,
      offpegFeeMultiplier: offpeg,
      rates,
    };
  }

  /**
   * Get current pool state (balances, supply, etc.)
   */
  async getState(): Promise<PoolState> {
    const [balances, totalSupply] = await Promise.all([
      this.getBalances(),
      this.getTotalSupply(),
    ]);

    return {
      balances,
      totalSupply,
      // virtualPrice,
    };
  }

  /**
   * Get pool metadata (name, symbol, coins, etc.)
   */
  async getMetadata(): Promise<PoolMetadata> {
    const [name, symbol, decimals, coins, nCoins] = await Promise.all([
      this.getName(),
      this.getSymbol(),
      this.getDecimals(),
      this.getCoins(),
      this.getNCons(),
    ]);

    return {
      name,
      symbol,
      decimals,
      coins,
      nCoins,
    };
  }

  /**
   * Get all pool data needed to initialize a CurveStableSwapNG/CurveAMO instance
   */
  async getFullPoolData(): Promise<FullPoolData> {
    const [params, state] = await Promise.all([
      this.getParams(),
      this.getState(),
    ]);

    return { params, state };
  }

  /**
   * Get relative prices (dx0/dxk for k=1..n-1) from the on-chain get_p()
   */
  async getP(): Promise<bigint[]> {
    const p = await this.contract.get_p();
    return p.map((v: bigint) => BigInt(v));
  }
}
