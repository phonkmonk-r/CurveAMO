import { expect } from "chai";

describe("Example Test Suite", () => {
  it("should pass a basic test", () => {
    expect(1 + 1).to.equal(2);
  });

  it("should handle arrays", () => {
    const arr = [1, 2, 3];
    expect(arr).to.have.lengthOf(3);
    expect(arr).to.include(2);
  });
});
