import { Provider, JsonRpcProvider } from "ethers";
import { CurvePoolReader, FullPoolData } from "./readers/CurvePoolReader";
import CurveAMO from "./CurveAMO";
import { RPCUrls } from "./lib/RPCUrls";

/**
 * CurveState manages fetching and syncing on-chain Curve pool state
 * with the local CurveAMO simulation instance.
 */
export class CurveState {
  public readonly reader: CurvePoolReader;
  private _amo: CurveAMO | null = null;
  private _lastFetchedData: FullPoolData | null = null;

  constructor(poolAddress: string, provider: Provider) {
    this.reader = new CurvePoolReader(poolAddress, provider);
  }

  static fromRpcUrl(poolAddress: string, rpcUrl: string): CurveState {
    const provider = new JsonRpcProvider(rpcUrl);
    return new CurveState(poolAddress, provider);
  }

  static fromChainId(poolAddress: string, chainId: number): CurveState {
    const rpcUrl = RPCUrls.getRPCUrl(chainId);
    return CurveState.fromRpcUrl(poolAddress, rpcUrl);
  }

  /**
   * Fetch the latest pool state from chain and create a fresh CurveAMO instance
   */
  async sync(): Promise<CurveAMO> {
    const data = await this.reader.getFullPoolData();
    this._lastFetchedData = data;

    this._amo = new CurveAMO(
      data.params,
      data.state.balances,
      data.state.totalSupply,
    );

    return this._amo;
  }

  /**
   * Get the current CurveAMO instance (fetches if not yet initialized)
   */
  async getAMO(): Promise<CurveAMO> {
    if (!this._amo) {
      return this.sync();
    }
    return this._amo;
  }

  /**
   * Get the last fetched pool data
   */
  get lastFetchedData(): FullPoolData | null {
    return this._lastFetchedData;
  }

  /**
   * Get the current CurveAMO instance (may be null if not synced)
   */
  get amo(): CurveAMO | null {
    return this._amo;
  }
}
