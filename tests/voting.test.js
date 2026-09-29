import { describe, it, expect } from "vitest";
import { computeVoting } from "../src/orchestrator/voting.js";

function result(signal, status = "success") {
  return { status, signal };
}

describe("computeVoting", () => {
  it("computes majority BUY correctly", () => {
    const results = [result("BUY"), result("BUY"), result("SELL"), result("BUY"), result("NO_TRADE"), result("BUY")];
    const v = computeVoting(results);
    expect(v.buy).toBe(4);
    expect(v.sell).toBe(1);
    expect(v.no_trade).toBe(1);
    expect(v.majority_signal).toBe("BUY");
    expect(v.total_models).toBe(6);
    expect(v.success).toBe(6);
  });

  it("only counts SUCCESS results in voting", () => {
    const results = [
      result("BUY"),
      result("BUY"),
      { status: "timeout", signal: null },
      result("BUY"),
      result("SELL"),
      { status: "error", signal: null },
    ];
    const v = computeVoting(results);
    expect(v.total_models).toBe(6);
    expect(v.success).toBe(4);
    expect(v.error).toBe(2);
    expect(v.buy).toBe(3);
    expect(v.majority_signal).toBe("BUY");
  });

  it("resolves a BUY/SELL tie to NO_TRADE", () => {
    const results = [result("BUY"), result("BUY"), result("SELL"), result("SELL")];
    const v = computeVoting(results);
    expect(v.majority_signal).toBe("NO_TRADE");
  });

  it("treats NO_TRADE plurality as majority", () => {
    const results = [result("NO_TRADE"), result("NO_TRADE"), result("NO_TRADE"), result("BUY"), result("SELL")];
    const v = computeVoting(results);
    expect(v.majority_signal).toBe("NO_TRADE");
  });

  it("returns NO_TRADE when all providers fail", () => {
    const results = [
      { status: "error", signal: null },
      { status: "timeout", signal: null },
    ];
    const v = computeVoting(results);
    expect(v.majority_signal).toBe("NO_TRADE");
    expect(v.success).toBe(0);
  });

  it("never labels vote share as confidence and computes correct percentages", () => {
    const results = [result("BUY"), result("BUY"), result("SELL"), result("NO_TRADE")];
    const v = computeVoting(results);
    expect(v.buy_vote_share).toBe(50);
    expect(v.sell_vote_share).toBe(25);
    expect(v.no_trade_vote_share).toBe(25);
    expect(v).not.toHaveProperty("confidence");
  });
});
