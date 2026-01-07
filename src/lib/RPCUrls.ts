export class RPCUrls {
    static getRPCUrl(chainId: number): string {
        const rpc = process.env["RPC_" + chainId];
        if (!rpc) {
            throw new Error(`RPC not set in env. Add one as RPC_${chainId}=<url>`);
        }
        return rpc;
    }

    static getOptionalRPCUrl(chainId: number): string | undefined {
        return process.env["RPC_" + chainId];
    }
}