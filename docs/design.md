# Design contract

Pending → confirmed or cancelled or expired. Terminal states do not transition. Confirmation consumes the reservation; cancellation/expiry releases it once. Expired reservations cannot confirm, even before the expiry worker executes.

Creation transaction: owner/key advisory lock → replay check → sorted inventory row locks → validate all stock → reserve → insert order and due expiry outbox event. Payload hash uses normalized sorted SKU/quantity pairs. Duplicate SKU lines are rejected. Reads and mutation queries include owner scope unless the actor is an administrator.

Transition transaction: order row lock → owner check → state/deadline check → terminal update → sorted inventory row locks and release, when applicable → acknowledge expiry event when applicable. Outbox publication is at least once; the expiry worker and database transitions are idempotent. Dispatcher leaves the event pending until worker commits, so queue acknowledgement alone cannot lose it.

Feature modules separate HTTP/auth, inventory, orders, health and background orchestration. PostgreSQL constraints supplement DTO validation. No payment gateway or payment simulation is included.
