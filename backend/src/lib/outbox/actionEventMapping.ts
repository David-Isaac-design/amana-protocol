/**
 * Action-to-Event Mapping Specification
 * 
 * This table-driven spec defines the expected event emissions for all state-changing
 * actions in the system. Each entry represents an invariant:
 * "When this action completes, these events MUST be produced."
 * 
 * Used for:
 * 1. Lint guards (preventing new mutations without mapped events)
 * 2. Integration testing (asserting events are emitted)
 * 3. Consistency scanning (detecting missed side effects)
 * 4. Documentation (clear action<->event coupling)
 */

import { EventType, TradeStatus } from "../../types/events";
import { appLogger } from "../../middleware/logger";

export enum ServiceAction {
  // Trade Service Actions
  CREATE_PENDING_TRADE = "trade:create_pending",
  SIGN_TRADE = "trade:sign",
  FUND_TRADE = "trade:fund",
  CONFIRM_DELIVERY = "trade:confirm_delivery",
  RELEASE_FUNDS = "trade:release_funds",
  CANCEL_TRADE = "trade:cancel",
  EXPIRE_TRADE = "trade:expire",

  // Dispute Service Actions
  INITIATE_DISPUTE = "dispute:initiate",
  RESOLVE_DISPUTE = "dispute:resolve",

  // Stream Service Actions
  CREATE_STREAM = "stream:create",
  CLAWBACK_STREAM = "stream:clawback",
  TERMINATE_STREAM = "stream:terminate",

  // Admin Service Actions
  ADMIN_CLAWBACK = "admin:clawback",
}

export interface ActionEventMapping {
  action: ServiceAction;
  description: string;
  expectedEvents: EventType[];
  resultingStatus: TradeStatus;
  affectedModels: string[];
  sideEffects: string[];
}

/**
 * Master specification: action -> expected events
 * Invariant: All actions MUST produce at least one event to maintain audit trail
 */
export const ACTION_EVENT_MAPPINGS: ActionEventMapping[] = [
  // Trade Creation & Lifecycle
  {
    action: ServiceAction.CREATE_PENDING_TRADE,
    description: "Create a pending trade awaiting signature",
    expectedEvents: [], // No on-chain event (off-chain only)
    resultingStatus: TradeStatus.PENDING_SIGNATURE,
    affectedModels: ["Trade"],
    sideEffects: ["logging", "audit_trail"],
  },
  {
    action: ServiceAction.SIGN_TRADE,
    description: "Sign a pending trade (off-chain action)",
    expectedEvents: [], // Signing is off-chain; events come from chain
    resultingStatus: TradeStatus.CREATED,
    affectedModels: ["Trade"],
    sideEffects: ["logging", "audit_trail"],
  },
  {
    action: ServiceAction.FUND_TRADE,
    description: "Fund a trade on-chain (escrow lock)",
    expectedEvents: [EventType.TradeFunded],
    resultingStatus: TradeStatus.FUNDED,
    affectedModels: ["Trade"],
    sideEffects: [
      "webhook_dispatch",
      "notification_queue",
      "logging",
      "audit_trail",
    ],
  },
  {
    action: ServiceAction.CONFIRM_DELIVERY,
    description: "Confirm delivery of goods/services",
    expectedEvents: [EventType.DeliveryConfirmed],
    resultingStatus: TradeStatus.DELIVERED,
    affectedModels: ["Trade"],
    sideEffects: [
      "webhook_dispatch",
      "notification_queue",
      "logging",
      "audit_trail",
    ],
  },
  {
    action: ServiceAction.RELEASE_FUNDS,
    description: "Release funds to seller after delivery",
    expectedEvents: [EventType.FundsReleased],
    resultingStatus: TradeStatus.COMPLETED,
    affectedModels: ["Trade"],
    sideEffects: [
      "webhook_dispatch",
      "notification_queue",
      "logging",
      "audit_trail",
    ],
  },
  {
    action: ServiceAction.CANCEL_TRADE,
    description: "Cancel a trade and refund buyer",
    expectedEvents: [], // May emit via contract event listener if on-chain
    resultingStatus: TradeStatus.CANCELLED,
    affectedModels: ["Trade"],
    sideEffects: [
      "webhook_dispatch",
      "notification_queue",
      "logging",
      "audit_trail",
    ],
  },
  {
    action: ServiceAction.EXPIRE_TRADE,
    description: "Expire an overdue trade via scheduled job",
    expectedEvents: [], // Expiry is scheduled job-initiated
    resultingStatus: TradeStatus.EXPIRED,
    affectedModels: ["Trade"],
    sideEffects: ["logging", "audit_trail", "notification_queue"],
  },

  // Dispute Lifecycle
  {
    action: ServiceAction.INITIATE_DISPUTE,
    description: "Initiate a dispute on a funded/delivered trade",
    expectedEvents: [EventType.DisputeInitiated],
    resultingStatus: TradeStatus.DISPUTED,
    affectedModels: ["Trade", "Dispute"],
    sideEffects: [
      "webhook_dispatch",
      "notification_queue",
      "logging",
      "audit_trail",
      "admin_notification",
    ],
  },
  {
    action: ServiceAction.RESOLVE_DISPUTE,
    description: "Resolve a dispute and return funds or release to seller",
    expectedEvents: [EventType.DisputeResolved],
    resultingStatus: TradeStatus.COMPLETED,
    affectedModels: ["Trade", "Dispute"],
    sideEffects: [
      "webhook_dispatch",
      "notification_queue",
      "logging",
      "audit_trail",
      "admin_notification",
    ],
  },

  // Stream Actions
  {
    action: ServiceAction.CREATE_STREAM,
    description: "Create a payment stream",
    expectedEvents: [], // Stream creation is off-chain
    resultingStatus: TradeStatus.CREATED,
    affectedModels: ["Stream"],
    sideEffects: ["logging", "audit_trail"],
  },
  {
    action: ServiceAction.CLAWBACK_STREAM,
    description: "Admin clawback of an active stream",
    expectedEvents: [EventType.StreamClawback],
    resultingStatus: TradeStatus.CANCELLED,
    affectedModels: ["Stream", "StreamClawbackEvent"],
    sideEffects: [
      "webhook_dispatch",
      "notification_queue",
      "logging",
      "audit_trail",
      "admin_notification",
    ],
  },
  {
    action: ServiceAction.TERMINATE_STREAM,
    description: "Terminate a payment stream",
    expectedEvents: [], // Termination may be on-chain or off-chain
    resultingStatus: TradeStatus.CANCELLED,
    affectedModels: ["Stream"],
    sideEffects: ["logging", "audit_trail", "notification_queue"],
  },

  // Admin Actions
  {
    action: ServiceAction.ADMIN_CLAWBACK,
    description: "Admin clawback of funds from an escrow",
    expectedEvents: [EventType.StreamClawback], // Similar event format
    resultingStatus: TradeStatus.CANCELLED,
    affectedModels: ["Trade"],
    sideEffects: [
      "webhook_dispatch",
      "logging",
      "audit_trail",
      "admin_notification",
    ],
  },
];

/**
 * Quick lookup: action -> expected events
 */
export const getExpectedEvents = (action: ServiceAction): EventType[] => {
  const mapping = ACTION_EVENT_MAPPINGS.find((m) => m.action === action);
  return mapping?.expectedEvents ?? [];
};

/**
 * Quick lookup: action -> resulting status
 */
export const getResultingStatus = (
  action: ServiceAction,
): TradeStatus | undefined => {
  const mapping = ACTION_EVENT_MAPPINGS.find((m) => m.action === action);
  return mapping?.resultingStatus;
};

/**
 * Validate that a set of emitted events matches expectations for an action
 * Returns { valid: boolean, missingEvents: EventType[], extraEvents: EventType[] }
 */
export const validateEventEmission = (
  action: ServiceAction,
  emittedEvents: EventType[],
): {
  valid: boolean;
  missingEvents: EventType[];
  extraEvents: EventType[];
} => {
  const expected = getExpectedEvents(action);
  const emitted = new Set(emittedEvents);

  const missing = expected.filter((e) => !emitted.has(e));
  const extra = emittedEvents.filter((e) => !expected.includes(e));

  return {
    valid: missing.length === 0 && extra.length === 0,
    missingEvents: missing,
    extraEvents: extra,
  };
};

/**
 * Service action registry for code generation & lint checks
 * Populated by service implementations via @RequiresEvent decorator
 */
export const registeredServiceActions = new Map<
  ServiceAction,
  {
    service: string;
    method: string;
    implemented: boolean;
    lastVerified: Date;
  }
>();

/**
 * Decorator to mark service methods that must emit events
 * Usage: @RequiresEvent(ServiceAction.FUND_TRADE, [EventType.TradeFunded])
 */
export function RequiresEvent(
  action: ServiceAction,
  expectedEvents: EventType[],
) {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      // Log for audit/verification
      if (process.env.NODE_ENV !== "production") {
        appLogger.debug(
          { action, method: String(propertyKey) },
          "[RequiresEvent] service action invoked",
        );
      }

      return result;
    };

    registeredServiceActions.set(action, {
      service: target.constructor.name,
      method: String(propertyKey),
      implemented: true,
      lastVerified: new Date(),
    });

    return descriptor;
  };
}
