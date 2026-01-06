import { ethers } from "ethers";

export type Bigish = bigint;

export const PRECISION = 10n ** 18n;
export const FEE_DENOMINATOR = 10n ** 10n;
export const A_PRECISION = 100n;
export const ADMIN_FEE = 5_000_000_000n; // fixed in the contract
export const DEFAULT_PEG_MIN = ethers.parseEther("0.998");
export const DEFAULT_PEG_MAX = ethers.parseEther("1.005");


export function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
