import {
  authorize,
  nextState,
  normalize,
  requestHash,
} from "../src/orders/policy";
describe("order invariants", () => {
  test("canonical payload hash ignores line order but detects changed quantity", () => {
    const a = [
      { sku: "B", quantity: 1 },
      { sku: "A", quantity: 2 },
    ];
    expect(requestHash(a)).toBe(requestHash([...a].reverse()));
    expect(requestHash(a)).not.toBe(
      requestHash([
        { sku: "B", quantity: 2 },
        { sku: "A", quantity: 2 },
      ]),
    );
  });
  test("duplicate SKU and invalid stock quantities are rejected", () => {
    expect(() =>
      normalize([
        { sku: "A", quantity: 1 },
        { sku: "A", quantity: 2 },
      ]),
    ).toThrow();
    expect(() => normalize([{ sku: "A", quantity: 0 }])).toThrow();
  });
  test("other owners cannot read or mutate an order", () => {
    expect(() =>
      authorize("owner-1", { id: "owner-2", role: "owner" }),
    ).toThrow();
    expect(() =>
      authorize("owner-1", { id: "admin", role: "admin" }),
    ).not.toThrow();
  });
  test("duplicate cancellation never releases stock twice", () => {
    expect(
      nextState("cancelled", "cancelled", new Date(100), new Date(0)),
    ).toEqual({ state: "cancelled", release: false });
  });
  test("confirmed order cannot expire or cancel", () => {
    expect(() =>
      nextState("confirmed", "cancelled", new Date(100), new Date(0)),
    ).toThrow();
    expect(
      nextState("confirmed", "expired", new Date(100), new Date(200)),
    ).toEqual({ state: "confirmed", release: false });
  });
  test("confirmation does not release reserved inventory", () => {
    expect(
      nextState("pending", "confirmed", new Date(100), new Date(0)),
    ).toEqual({ state: "confirmed", release: false });
  });
  test("confirmation after deadline is rejected and early expiry is rejected", () => {
    expect(() =>
      nextState("pending", "confirmed", new Date(100), new Date(100)),
    ).toThrow();
    expect(() =>
      nextState("pending", "expired", new Date(100), new Date(0)),
    ).toThrow();
  });
});
