import { Provider, JsonRpcProvider } from "ethers";
import { FxReader, FxReaderAddressesParams } from "./readers/FxReader";
import FxLogic, { FxLogicParams } from "./logic/FxLogic";
import { RPCUrls } from "./lib/RPCUrls";

/**
 * FxState manages fetching and syncing on-chain F(x) Protocol state
 * with the local FxLogic simulation instance.
 */
export class FxState {
    public readonly reader: FxReader;
    private _logic: FxLogic | null = null;
    private _lastFetchedData: FxLogicParams | null = null;

    constructor(addresses: FxReaderAddressesParams, provider: Provider) {
        this.reader = new FxReader(addresses, provider);
    }

    static fromRpcUrl(addresses: FxReaderAddressesParams, rpcUrl: string): FxState {
        const provider = new JsonRpcProvider(rpcUrl);
        return new FxState(addresses, provider);
    }

    static fromChainId(addresses: FxReaderAddressesParams, chainId: number): FxState {
        const rpcUrl = RPCUrls.getRPCUrl(chainId);
        return FxState.fromRpcUrl(addresses, rpcUrl);
    }

    /**
     * Fetch the latest state from chain and create a fresh FxLogic instance
     */
    async sync(): Promise<FxLogic> {
        const data = await this.reader.getParams();
        this._lastFetchedData = data;

        this._logic = new FxLogic(data);

        return this._logic;
    }

    /**
     * Get the current FxLogic instance (fetches if not yet initialized)
     */
    async getLogic(): Promise<FxLogic> {
        if (!this._logic) {
            return this.sync();
        }
        return this._logic;
    }

    /**
     * Get the last fetched data
     */
    get lastFetchedData(): FxLogicParams | null {
        return this._lastFetchedData;
    }

    /**
     * Get the current FxLogic instance (may be null if not synced)
     */
    get logic(): FxLogic | null {
        return this._logic;
    }
}
