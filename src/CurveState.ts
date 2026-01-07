import { Provider, JsonRpcProvider } from "ethers";
import { CurvePoolReader, FullPoolData } from "./readers/CurvePoolReader";
import CurveLogic from "./logic/CurveLogic";
import { RPCUrls } from "./lib/RPCUrls";

/**
 * CurveState manages fetching and syncing on-chain Curve pool state
 * with the local CurveLogic simulation instance.
 */
export class CurveState {
  public readonly reader: CurvePoolReader;
  private _logic: CurveLogic | null = null;
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
   * Fetch the latest pool state from chain and create a fresh CurveLogic instance
   */
  async sync(): Promise<CurveLogic> {
    const data = await this.reader.getFullPoolData();
    this._lastFetchedData = data;

    this._logic = new CurveLogic(
      data.params,
      data.state.balances,
      data.state.totalSupply,
    );

    return this._logic;
  }

  /**
   * Get the current CurveLogic instance (fetches if not yet initialized)
   */
  async getLogic(): Promise<CurveLogic> {
    if (!this._logic) {
      return this.sync();
    }
    return this._logic;
  }

  /**
   * Get the last fetched pool data
   */
  get lastFetchedData(): FullPoolData | null {
    return this._lastFetchedData;
  }

  /**
   * Get the current CurveLogic instance (may be null if not synced)
   */
  get logic(): CurveLogic | null {
    return this._logic;
  }
}
