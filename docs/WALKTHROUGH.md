# 100-second walkthrough outline

This is a recording script for the public demo video. Recording and publishing remain pending a public demo URL.

| Time | Screen | Narration |
|---|---|---|
| 0–15s | Operator, double-count trap | “A 100-seat cabin has several sales channels. The online parent says 65 seats are free, but 35 are already promised to partners, so only 30 can be sold.” |
| 15–32s | Plan allocations, preview | “An operator can propose a sailing, physical capacity, and channel rules. The preview shows raw versus sellable seats and flags invalid allocations before submission.” |
| 32–43s | Administrator approval | “An administrator approves the proposal. That decision is audited and creates the live configuration in one transaction.” |
| 43–62s | Booking inspector | “Here a temporary hold takes seats. Confirming turns it into a sale; releasing or expiring gives those exact seats back.” |
| 62–77s | Competing requests | “Two requests for the same remaining seats arrive together. One wins under a database lock; the other gets a precise shortfall, with no oversell.” |
| 77–90s | Cutoff, ledger, report | “At cutoff, flexible inventory returns to the counter. The ledger explains each movement, while the report shows sellable inventory and prevented oversell attempts.” |
| 90–100s | Partner view | “Partners see only their own allocation and booking activity. A confirmed sale can also notify a CRM through a signed, retried webhook.” |
