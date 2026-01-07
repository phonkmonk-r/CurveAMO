export type Bigish = bigint;

export default class Helpers {
  static abs(x: bigint): bigint {
    return x < 0n ? -x : x;
  }
  static assert(cond: boolean, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
  }
}
