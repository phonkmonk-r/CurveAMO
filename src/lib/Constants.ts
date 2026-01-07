import { ethers } from "ethers";

export default class Constants {
  static PRECISION = 10n ** 18n;
  static FEE_DENOMINATOR = 10n ** 10n;
  static A_PRECISION = 100n;
  static ADMIN_FEE = 5_000_000_000n; // fixed in the contract
  static DEFAULT_PEG_MIN = ethers.parseEther("0.998");
  static DEFAULT_PEG_MAX = ethers.parseEther("1.005");
}